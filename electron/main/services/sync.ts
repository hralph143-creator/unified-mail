import { randomUUID } from 'node:crypto'
import type { SyncSummary, SyncTrigger } from '../../../shared/types'
import type { AppDatabase } from '../db/database'
import type { AccountService } from './accounts'
import type { ImapService, RemoteMail } from './imap'
import type { AppLogger } from './logger'
import { MailServiceError } from './errors'
import { KeyedMutex } from './mutex'

export interface SyncEvents { changed(): void; state(running: boolean, summary?: SyncSummary): void }

export class SyncService {
  private allPromise: Promise<SyncSummary> | null = null
  readonly mutex = new KeyedMutex()

  constructor(private readonly database: AppDatabase, private readonly accounts: AccountService, private readonly imap: ImapService, private readonly logger: AppLogger, private readonly events: SyncEvents) {}

  isRunning(): boolean { return this.allPromise !== null }

  syncAll(trigger: SyncTrigger = 'manual'): Promise<SyncSummary> {
    if (this.allPromise) return this.allPromise
    this.events.state(true)
    const enabled = this.accounts.list().filter((item) => item.isEnabled)
    this.allPromise = Promise.all(enabled.map((account) => this.syncAccount(account.id, trigger).then((value) => ({ ok: true, value })).catch((error: unknown) => ({ ok: false, error })))).then((results) => {
      const succeeded = results.filter((item) => item.ok).length
      const failed = results.length - succeeded
      const values = results.filter((item): item is { ok: true; value: { added: number; updated: number } } => item.ok)
      const summary: SyncSummary = { status: failed === 0 ? 'success' : succeeded === 0 ? 'failed' : 'partial', succeeded, failed, added: values.reduce((sum, item) => sum + item.value.added, 0), updated: values.reduce((sum, item) => sum + item.value.updated, 0) }
      this.events.state(false, summary)
      this.events.changed()
      return summary
    }).finally(() => { this.allPromise = null })
    return this.allPromise
  }

  syncAccount(accountId: string, trigger: SyncTrigger = 'account'): Promise<{ added: number; updated: number }> {
    return this.mutex.run(accountId, () => this.performAccountSync(accountId, trigger))
  }

  private async performAccountSync(accountId: string, trigger: SyncTrigger): Promise<{ added: number; updated: number }> {
    const runId = randomUUID()
    const startedAt = new Date().toISOString()
    this.database.sqlite.prepare(`INSERT INTO sync_runs(id,account_id,trigger,started_at,status,added_count,updated_count) VALUES(?,?,?,?, 'running',0,0)`).run(runId, accountId, trigger, startedAt)
    this.database.sqlite.prepare(`UPDATE accounts SET connection_status='syncing',last_sync_at=?,last_error=NULL WHERE id=?`).run(startedAt, accountId)
    this.events.changed()
    try {
      const result = await this.imap.listUnread(accountId)
      const counts = this.applyRemoteState(accountId, result.uidValidity, result.uidNext, result.mails)
      const endedAt = new Date().toISOString()
      this.database.sqlite.transaction(() => {
        this.database.sqlite.prepare(`UPDATE accounts SET connection_status='success',last_successful_sync_at=?,last_error=NULL,updated_at=? WHERE id=?`).run(endedAt, endedAt, accountId)
        this.database.sqlite.prepare(`UPDATE sync_runs SET ended_at=?,status='success',added_count=?,updated_count=? WHERE id=?`).run(endedAt, counts.added, counts.updated, runId)
      })()
      this.logger.info({ accountId, durationMs: Date.now() - Date.parse(startedAt), ...counts }, '账户同步完成')
      this.events.changed()
      return counts
    } catch (error) {
      const endedAt = new Date().toISOString()
      const known = error instanceof MailServiceError ? error : new MailServiceError('SYNC_FAILED', '同步失败，请稍后重试', error instanceof Error ? error.message : String(error))
      const state = known.code === 'AUTH_FAILED' ? 'auth_required' : 'failed'
      this.database.sqlite.transaction(() => {
        this.database.sqlite.prepare('UPDATE accounts SET connection_status=?,last_error=?,updated_at=? WHERE id=?').run(state, known.message, endedAt, accountId)
        this.database.sqlite.prepare(`UPDATE sync_runs SET ended_at=?,status='failed',error_code=?,error_message=? WHERE id=?`).run(endedAt, known.code, known.message, runId)
      })()
      this.logger.warn({ accountId, code: known.code, technical: known.technical }, '账户同步失败')
      this.events.changed()
      throw known
    }
  }

  private applyRemoteState(accountId: string, uidValidity: string, uidNext: number | null, remote: RemoteMail[]): { added: number; updated: number } {
    const now = new Date().toISOString()
    const folder = this.database.sqlite.prepare('SELECT uid_validity FROM folders WHERE account_id=? AND path=?').get(accountId, 'INBOX') as { uid_validity: string } | undefined
    const validityChanged = Boolean(folder && folder.uid_validity !== uidValidity)
    const remoteUids = new Set(remote.map((item) => item.uid))
    let added = 0
    let updated = 0
    this.database.sqlite.transaction(() => {
      if (validityChanged) {
        const changed = this.database.sqlite.prepare(`UPDATE mails SET is_read=1,sync_status='uidvalidity_expired',updated_at=? WHERE account_id=? AND folder_path='INBOX' AND is_read=0`).run(now, accountId)
        updated += changed.changes
      } else {
        const localUnread = this.database.sqlite.prepare(`SELECT id,imap_uid FROM mails WHERE account_id=? AND folder_path='INBOX' AND uid_validity=? AND is_read=0 AND operation_pending=0`).all(accountId, uidValidity) as Array<{ id: string; imap_uid: number }>
        const markRead = this.database.sqlite.prepare(`UPDATE mails SET is_read=1,sync_status='synced',updated_at=? WHERE id=?`)
        for (const item of localUnread) if (!remoteUids.has(item.imap_uid)) { markRead.run(now, item.id); updated++ }
      }
      const insert = this.database.sqlite.prepare(`INSERT INTO mails(id,account_id,folder_path,uid_validity,imap_uid,message_id,sender_name,sender_address,recipients,subject,preview,received_at,is_read,has_attachments,operation_pending,sync_status,created_at,updated_at)
        VALUES(?,?, 'INBOX',?,?,?,?,?,?,?,?,?,0,?,0,'synced',?,?) ON CONFLICT(account_id,folder_path,uid_validity,imap_uid) DO UPDATE SET message_id=excluded.message_id,sender_name=excluded.sender_name,sender_address=excluded.sender_address,recipients=excluded.recipients,subject=excluded.subject,preview=CASE WHEN excluded.preview<>'' THEN excluded.preview ELSE mails.preview END,received_at=excluded.received_at,is_read=CASE WHEN mails.operation_pending=1 THEN mails.is_read ELSE 0 END,has_attachments=excluded.has_attachments,updated_at=excluded.updated_at`)
      for (const item of remote) {
        const exists = this.database.sqlite.prepare(`SELECT id,is_read FROM mails WHERE account_id=? AND folder_path='INBOX' AND uid_validity=? AND imap_uid=?`).get(accountId, uidValidity, item.uid) as { id: string; is_read: number } | undefined
        insert.run(exists?.id ?? randomUUID(), accountId, uidValidity, item.uid, item.messageId, item.senderName, item.senderAddress, JSON.stringify(item.recipients), item.subject, item.preview, item.receivedAt, item.hasAttachments ? 1 : 0, now, now)
        if (!exists) added++
        else if (exists.is_read) updated++
      }
      this.database.sqlite.prepare(`INSERT INTO folders(id,account_id,path,uid_validity,uid_next,last_synced_at) VALUES(?,?, 'INBOX',?,?,?) ON CONFLICT(account_id,path) DO UPDATE SET uid_validity=excluded.uid_validity,uid_next=excluded.uid_next,last_synced_at=excluded.last_synced_at`).run(randomUUID(), accountId, uidValidity, uidNext, now)
    })()
    return { added, updated }
  }
}
