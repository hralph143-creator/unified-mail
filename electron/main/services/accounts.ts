import { randomUUID } from 'node:crypto'
import type { Account, AccountInput, Provider } from '../../../shared/types'
import type { AppDatabase } from '../db/database'
import type { CredentialService } from './credentials'

interface AccountRow {
  id: string; email: string; provider: Provider; display_name: string; imap_host: string; imap_port: number; imap_secure: number
  credential_reference: string; is_enabled: number; connection_status: Account['connectionStatus']; last_sync_at: string | null
  last_successful_sync_at: string | null; last_error: string | null; created_at: string; updated_at: string; unread_count: number
}

export function accountFromRow(row: AccountRow): Account {
  return {
    id: row.id, email: row.email, provider: row.provider, displayName: row.display_name, imapHost: row.imap_host,
    imapPort: row.imap_port, imapSecure: Boolean(row.imap_secure), isEnabled: Boolean(row.is_enabled),
    connectionStatus: row.connection_status, lastSyncAt: row.last_sync_at, lastSuccessfulSyncAt: row.last_successful_sync_at,
    unreadCount: row.unread_count, lastError: row.last_error, createdAt: row.created_at, updatedAt: row.updated_at
  }
}

export class AccountService {
  constructor(private readonly database: AppDatabase, private readonly credentials: CredentialService) {}

  list(): Account[] {
    const rows = this.database.sqlite.prepare(`SELECT a.*, COUNT(CASE WHEN m.is_read=0 THEN 1 END) unread_count FROM accounts a LEFT JOIN mails m ON m.account_id=a.id GROUP BY a.id ORDER BY a.created_at`).all() as AccountRow[]
    return rows.map(accountFromRow)
  }

  get(id: string): (Account & { credentialReference: string }) | undefined {
    const row = this.database.sqlite.prepare(`SELECT a.*, COUNT(CASE WHEN m.is_read=0 THEN 1 END) unread_count FROM accounts a LEFT JOIN mails m ON m.account_id=a.id WHERE a.id=? GROUP BY a.id`).get(id) as AccountRow | undefined
    if (!row) return undefined
    const credential = this.database.sqlite.prepare('SELECT credential_reference FROM accounts WHERE id=?').get(id) as { credential_reference: string }
    return { ...accountFromRow(row), credentialReference: credential.credential_reference }
  }

  save(input: AccountInput): Account {
    const now = new Date().toISOString()
    const existing = input.id ? this.get(input.id) : undefined
    const duplicate = this.database.sqlite.prepare('SELECT id FROM accounts WHERE lower(email)=lower(?) AND id<>?').get(input.email.trim(), input.id ?? '')
    if (duplicate) throw new Error('该邮箱账户已存在')
    const id = existing?.id ?? randomUUID()
    this.database.sqlite.transaction(() => {
      const credentialReference = this.credentials.save(input.authorizationCode, existing?.credentialReference)
      this.database.sqlite.prepare(`INSERT INTO accounts(id,email,provider,display_name,imap_host,imap_port,imap_secure,credential_reference,is_enabled,connection_status,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,1,'idle',?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,provider=excluded.provider,display_name=excluded.display_name,imap_host=excluded.imap_host,imap_port=excluded.imap_port,imap_secure=excluded.imap_secure,credential_reference=excluded.credential_reference,connection_status='idle',last_error=NULL,updated_at=excluded.updated_at`)
        .run(id, input.email.trim().toLowerCase(), input.provider, input.displayName.trim() || input.email.trim(), input.imapHost.trim(), input.imapPort, input.imapSecure ? 1 : 0, credentialReference, now, now)
    })()
    return this.get(id)!
  }

  setEnabled(id: string, enabled: boolean): void {
    const result = this.database.sqlite.prepare('UPDATE accounts SET is_enabled=?, connection_status=?, updated_at=? WHERE id=?').run(enabled ? 1 : 0, enabled ? 'idle' : 'disabled', new Date().toISOString(), id)
    if (!result.changes) throw new Error('邮箱账户不存在')
  }

  remove(id: string): void {
    const row = this.get(id)
    if (!row) return
    this.database.sqlite.transaction(() => {
      this.database.sqlite.prepare('DELETE FROM accounts WHERE id=?').run(id)
      this.credentials.remove(row.credentialReference)
    })()
  }
}
