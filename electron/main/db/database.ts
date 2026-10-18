import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import * as schema from './schema'

const DEFAULT_SETTINGS = {
  autoSyncEnabled: true,
  syncIntervalMinutes: 360,
  launchAtLogin: false,
  minimizeToTray: true,
  notificationsEnabled: true,
  pageSize: 50,
  defaultAccountScope: 'all',
  tutorialCompleted: false
}

export class AppDatabase {
  readonly sqlite: Database.Database
  readonly orm: ReturnType<typeof drizzle<typeof schema>>
  readonly directory: string

  constructor(directory = join(app.getPath('userData'), 'data')) {
    this.directory = directory
    mkdirSync(directory, { recursive: true })
    this.sqlite = new Database(join(directory, 'unified-mail.db'))
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('foreign_keys = ON')
    this.sqlite.pragma('busy_timeout = 5000')
    this.orm = drizzle(this.sqlite, { schema })
    this.migrate()
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, encrypted_value TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, display_name TEXT NOT NULL, imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL, imap_secure INTEGER NOT NULL, credential_reference TEXT NOT NULL, is_enabled INTEGER NOT NULL DEFAULT 1, connection_status TEXT NOT NULL DEFAULT 'idle', last_sync_at TEXT, last_successful_sync_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(credential_reference) REFERENCES credentials(id));
      CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, path TEXT NOT NULL, uid_validity TEXT NOT NULL, uid_next INTEGER, last_synced_at TEXT NOT NULL, UNIQUE(account_id,path), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS mails (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, folder_path TEXT NOT NULL, uid_validity TEXT NOT NULL, imap_uid INTEGER NOT NULL, message_id TEXT, sender_name TEXT NOT NULL DEFAULT '', sender_address TEXT NOT NULL DEFAULT '', recipients TEXT NOT NULL DEFAULT '[]', subject TEXT NOT NULL DEFAULT '(无主题)', preview TEXT NOT NULL DEFAULT '', received_at TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, has_attachments INTEGER NOT NULL DEFAULT 0, operation_pending INTEGER NOT NULL DEFAULT 0, sync_status TEXT NOT NULL DEFAULT 'synced', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(account_id,folder_path,uid_validity,imap_uid), FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE);
      CREATE INDEX IF NOT EXISTS mails_unread_received_idx ON mails(is_read,received_at DESC);
      CREATE INDEX IF NOT EXISTS mails_account_idx ON mails(account_id);
      CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, mail_id TEXT NOT NULL, part_index INTEGER NOT NULL, filename TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, content_id TEXT, UNIQUE(mail_id,part_index), FOREIGN KEY(mail_id) REFERENCES mails(id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS sync_runs (id TEXT PRIMARY KEY, account_id TEXT, trigger TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, status TEXT NOT NULL, added_count INTEGER NOT NULL DEFAULT 0, updated_count INTEGER NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT, FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL);
      CREATE INDEX IF NOT EXISTS sync_runs_started_idx ON sync_runs(started_at DESC);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,datetime('now'));
    `)
    const insert = this.sqlite.prepare('INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES(?,?,?)')
    const now = new Date().toISOString()
    this.sqlite.transaction(() => {
      for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, JSON.stringify(value), now)
    })()
  }

  close(): void {
    this.sqlite.pragma('wal_checkpoint(TRUNCATE)')
    this.sqlite.close()
  }
}

export { DEFAULT_SETTINGS }
