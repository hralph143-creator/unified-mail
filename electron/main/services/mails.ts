import type { AttachmentInfo, MailDetail, MailQuery, MailSummary, PageResult, Provider } from '../../../shared/types'
import type { AppDatabase } from '../db/database'
import type { ImapService } from './imap'
import type { SyncService } from './sync'
import type { AppLogger } from './logger'

interface MailRow {
  id: string; account_id: string; account_name: string; provider: Provider; folder_path: string; uid_validity: string; imap_uid: number
  sender_name: string; sender_address: string; recipients: string; subject: string; preview: string; received_at: string
  is_read: number; has_attachments: number; operation_pending: number
}

function summary(row: MailRow): MailSummary {
  return { id: row.id, accountId: row.account_id, accountName: row.account_name, provider: row.provider, folderPath: row.folder_path, uidValidity: row.uid_validity, imapUid: row.imap_uid, senderName: row.sender_name, senderAddress: row.sender_address, subject: row.subject, preview: row.preview, receivedAt: row.received_at, isRead: Boolean(row.is_read), hasAttachments: Boolean(row.has_attachments), operationPending: Boolean(row.operation_pending) }
}

export class MailService {
  private readonly attachmentCache = new Map<string, { expires: number; items: Array<AttachmentInfo & { content: Buffer }> }>()
  constructor(private readonly database: AppDatabase, private readonly imap: ImapService, private readonly sync: SyncService, private readonly logger: AppLogger, private readonly changed: () => void) {}

  list(query: MailQuery): PageResult<MailSummary> {
    const where = ['m.is_read=0']
    const params: Array<string | number> = []
    if (query.accountId) { where.push('m.account_id=?'); params.push(query.accountId) }
    if (query.provider) { where.push('a.provider=?'); params.push(query.provider) }
    if (query.search?.trim()) {
      const term = `%${query.search.trim().replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
      where.push(`(m.sender_name LIKE ? ESCAPE '\\' OR m.sender_address LIKE ? ESCAPE '\\' OR m.subject LIKE ? ESCAPE '\\' OR a.email LIKE ? ESCAPE '\\' OR a.display_name LIKE ? ESCAPE '\\')`)
      params.push(term, term, term, term, term)
    }
    const clause = where.join(' AND ')
    const total = (this.database.sqlite.prepare(`SELECT COUNT(*) count FROM mails m JOIN accounts a ON a.id=m.account_id WHERE ${clause}`).get(...params) as { count: number }).count
    const offset = Math.max(0, query.page - 1) * query.pageSize
    const rows = this.database.sqlite.prepare(`SELECT m.*,a.display_name account_name,a.provider FROM mails m JOIN accounts a ON a.id=m.account_id WHERE ${clause} ORDER BY m.received_at ${query.sort === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`).all(...params, query.pageSize, offset) as MailRow[]
    return { items: rows.map(summary), total }
  }

  private row(id: string): MailRow {
    const row = this.database.sqlite.prepare(`SELECT m.*,a.display_name account_name,a.provider FROM mails m JOIN accounts a ON a.id=m.account_id WHERE m.id=?`).get(id) as MailRow | undefined
    if (!row) throw new Error('邮件不存在')
    return row
  }

  async detail(id: string): Promise<MailDetail> {
    const row = this.row(id)
    const remote = await this.imap.fetchDetail(row.account_id, row.imap_uid, row.uid_validity)
    const now = Date.now()
    this.attachmentCache.set(id, { expires: now + 10 * 60_000, items: remote.attachments })
    const attachments = remote.attachments.map(({ content: _content, ...item }) => item)
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('DELETE FROM attachments WHERE mail_id=?').run(id)
      const insert = this.database.sqlite.prepare('INSERT INTO attachments(id,mail_id,part_index,filename,content_type,size,content_id) VALUES(?,?,?,?,?,?,?)')
      attachments.forEach((item, index) => insert.run(item.id, id, index, item.filename, item.contentType, item.size, item.contentId))
    })()
    return { ...summary(row), recipients: remote.recipients.length ? remote.recipients : JSON.parse(row.recipients) as string[], textBody: remote.textBody, htmlBody: remote.htmlBody, attachments }
  }

  async markRead(id: string): Promise<void> {
    const row = this.row(id)
    if (row.is_read) return
    await this.sync.mutex.run(row.account_id, async () => {
      const current = this.row(id)
      if (current.is_read || current.operation_pending) return
      this.database.sqlite.prepare(`UPDATE mails SET operation_pending=1,sync_status='pending_seen',updated_at=? WHERE id=?`).run(new Date().toISOString(), id)
      this.changed()
      try {
        await this.imap.markRead(current.account_id, current.imap_uid, current.uid_validity)
        this.database.sqlite.prepare(`UPDATE mails SET is_read=1,operation_pending=0,sync_status='synced',updated_at=? WHERE id=?`).run(new Date().toISOString(), id)
        this.logger.info({ accountId: current.account_id, mailId: id }, '邮件已读状态已回写')
      } catch (error) {
        this.database.sqlite.prepare(`UPDATE mails SET operation_pending=0,sync_status='write_failed',updated_at=? WHERE id=?`).run(new Date().toISOString(), id)
        throw error
      } finally { this.changed() }
    })
  }

  async attachment(mailId: string, attachmentId: string): Promise<{ filename: string; content: Buffer }> {
    let cached = this.attachmentCache.get(mailId)
    if (!cached || cached.expires < Date.now()) { await this.detail(mailId); cached = this.attachmentCache.get(mailId) }
    const item = cached?.items.find((entry) => entry.id === attachmentId)
    if (!item) throw new Error('附件不存在或缓存已失效')
    return { filename: item.filename, content: item.content }
  }

  clearCache(): void {
    this.attachmentCache.clear()
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('DELETE FROM attachments').run()
      this.database.sqlite.prepare('UPDATE mails SET preview=?').run('')
    })()
  }
}
