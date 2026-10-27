import type { AttachmentInfo, MailDetail, MailQuery, MailScope, MailSummary, MarkAllReadResult, PageResult, Provider } from '../../../shared/types'
import type { AppDatabase } from '../db/database'
import type { ImapService } from './imap'
import type { SyncService } from './sync'
import type { AppLogger } from './logger'
import { PartialMarkReadError } from './errors'

interface MailRow {
  id: string; account_id: string; account_name: string; provider: Provider; folder_path: string; uid_validity: string; imap_uid: number
  sender_name: string; sender_address: string; recipients: string; subject: string; preview: string; received_at: string
  is_read: number; has_attachments: number; operation_pending: number
}

function summary(row: MailRow): MailSummary {
  return { id: row.id, accountId: row.account_id, accountName: row.account_name, provider: row.provider, folderPath: row.folder_path, uidValidity: row.uid_validity, imapUid: row.imap_uid, senderName: row.sender_name, senderAddress: row.sender_address, subject: row.subject, preview: row.preview, receivedAt: row.received_at, isRead: Boolean(row.is_read), hasAttachments: Boolean(row.has_attachments), operationPending: Boolean(row.operation_pending) }
}

export class MailService {
  private readonly attachmentCache = new Map<string, { expires: number; bytes: number; items: Array<AttachmentInfo & { content: Buffer }> }>()
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
    this.cacheAttachments(id, remote.attachments, now)
    const attachments = remote.attachments.map(({ content: _content, ...item }) => item)
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('DELETE FROM attachments WHERE mail_id=?').run(id)
      const insert = this.database.sqlite.prepare('INSERT INTO attachments(id,mail_id,part_index,filename,content_type,size,content_id) VALUES(?,?,?,?,?,?,?)')
      attachments.forEach((item, index) => insert.run(`${id}:${item.id}`, id, index, item.filename, item.contentType, item.size, item.contentId))
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

  async markAllRead(scope: MailScope): Promise<MarkAllReadResult> {
    const where = ['m.is_read=0', 'm.operation_pending=0']
    const params: string[] = []
    if (scope.accountId) { where.push('m.account_id=?'); params.push(scope.accountId) }
    if (scope.provider) { where.push('a.provider=?'); params.push(scope.provider) }
    const rows = this.database.sqlite.prepare(`SELECT m.id,m.account_id,m.uid_validity,m.imap_uid FROM mails m JOIN accounts a ON a.id=m.account_id WHERE ${where.join(' AND ')} ORDER BY m.account_id,m.imap_uid`).all(...params) as Array<{ id: string; account_id: string; uid_validity: string; imap_uid: number }>
    const groups = new Map<string, typeof rows>()
    for (const row of rows) {
      const group = groups.get(row.account_id) ?? []
      group.push(row)
      groups.set(row.account_id, group)
    }
    let marked = 0
    let succeeded = 0
    let failed = 0
    await Promise.all([...groups.entries()].map(async ([accountId, items]) => {
      await this.sync.mutex.run(accountId, async () => {
        const ids = items.map((item) => item.id)
        const now = new Date().toISOString()
        const placeholders = ids.map(() => '?').join(',')
        this.database.sqlite.prepare(`UPDATE mails SET operation_pending=1,sync_status='pending_seen',updated_at=? WHERE id IN (${placeholders})`).run(now, ...ids)
        this.changed()
        const confirmedIds = new Set<string>()
        let writeError: unknown
        const byValidity = new Map<string, typeof items>()
        for (const item of items) byValidity.set(item.uid_validity, [...(byValidity.get(item.uid_validity) ?? []), item])
        for (const [uidValidity, validityItems] of byValidity) {
          try {
            const confirmedUids = await this.imap.markAllRead(accountId, validityItems.map((item) => item.imap_uid), uidValidity)
            const confirmedSet = new Set(confirmedUids)
            for (const item of validityItems) if (confirmedSet.has(item.imap_uid)) confirmedIds.add(item.id)
          } catch (error) {
            if (error instanceof PartialMarkReadError) {
              const confirmedSet = new Set(error.confirmedUids)
              for (const item of validityItems) if (confirmedSet.has(item.imap_uid)) confirmedIds.add(item.id)
            }
            writeError = error
            break
          }
        }
        const confirmed = items.filter((item) => confirmedIds.has(item.id)).map((item) => item.id)
        const unconfirmed = items.filter((item) => !confirmedIds.has(item.id)).map((item) => item.id)
        this.database.sqlite.transaction(() => {
          const completedAt = new Date().toISOString()
          if (confirmed.length) {
            const marks = confirmed.map(() => '?').join(',')
            this.database.sqlite.prepare(`UPDATE mails SET is_read=1,operation_pending=0,sync_status='synced',updated_at=? WHERE id IN (${marks})`).run(completedAt, ...confirmed)
          }
          if (unconfirmed.length) {
            const marks = unconfirmed.map(() => '?').join(',')
            this.database.sqlite.prepare(`UPDATE mails SET operation_pending=0,sync_status='write_failed',updated_at=? WHERE id IN (${marks})`).run(completedAt, ...unconfirmed)
          }
        })()
        marked += confirmed.length
        if (unconfirmed.length) {
          failed++
          this.logger.warn({ accountId, confirmed: confirmed.length, unconfirmed: unconfirmed.length, error: writeError instanceof Error ? writeError.message : String(writeError) }, '批量已读部分或全部回写失败')
        } else {
          succeeded++
          this.logger.info({ accountId, count: confirmed.length }, '邮件已批量标记为已读')
        }
        this.changed()
      })
    }))
    return { marked, succeeded, failed }
  }

  async attachment(mailId: string, attachmentId: string): Promise<{ filename: string; content: Buffer }> {
    let cached = this.attachmentCache.get(mailId)
    if (cached?.expires && cached.expires < Date.now()) { this.attachmentCache.delete(mailId); cached = undefined }
    if (!cached) { await this.detail(mailId); cached = this.attachmentCache.get(mailId) }
    if (cached) { this.attachmentCache.delete(mailId); this.attachmentCache.set(mailId, cached) }
    const item = cached?.items.find((entry) => entry.id === attachmentId)
    if (!item) throw new Error('附件不存在或缓存已失效')
    return { filename: item.filename, content: item.content }
  }

  private cacheAttachments(mailId: string, items: Array<AttachmentInfo & { content: Buffer }>, now: number): void {
    for (const [id, entry] of this.attachmentCache) if (entry.expires < now) this.attachmentCache.delete(id)
    const bytes = items.reduce((sum, item) => sum + item.content.byteLength, 0)
    this.attachmentCache.delete(mailId)
    this.attachmentCache.set(mailId, { expires: now + 10 * 60_000, bytes, items })
    let totalBytes = [...this.attachmentCache.values()].reduce((sum, entry) => sum + entry.bytes, 0)
    while (this.attachmentCache.size > 5 || totalBytes > 50 * 1024 * 1024) {
      const oldest = this.attachmentCache.entries().next().value as [string, { bytes: number }] | undefined
      if (!oldest) break
      this.attachmentCache.delete(oldest[0])
      totalBytes -= oldest[1].bytes
    }
  }

  clearCache(): void {
    this.attachmentCache.clear()
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('DELETE FROM attachments').run()
      this.database.sqlite.prepare('UPDATE mails SET preview=?').run('')
    })()
  }
}
