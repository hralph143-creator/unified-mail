import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../db/database'

export class CredentialService {
  constructor(private readonly database: AppDatabase) {}

  ensureAvailable(): void {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法使用 Windows 安全凭据加密，请检查系统登录环境')
  }

  save(value: string, existingId?: string): string {
    this.ensureAvailable()
    const id = existingId ?? randomUUID()
    const encrypted = safeStorage.encryptString(value).toString('base64')
    const now = new Date().toISOString()
    this.database.sqlite.prepare(`INSERT INTO credentials(id,encrypted_value,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET encrypted_value=excluded.encrypted_value,updated_at=excluded.updated_at`).run(id, encrypted, now, now)
    return id
  }

  read(id: string): string {
    this.ensureAvailable()
    const row = this.database.sqlite.prepare('SELECT encrypted_value FROM credentials WHERE id=?').get(id) as { encrypted_value: string } | undefined
    if (!row) throw new Error('未找到该账户的本地授权信息，请重新授权')
    return safeStorage.decryptString(Buffer.from(row.encrypted_value, 'base64'))
  }

  remove(id: string): void { this.database.sqlite.prepare('DELETE FROM credentials WHERE id=?').run(id) }
}
