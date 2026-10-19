import { BrowserWindow, Notification } from 'electron'
import type { RendererEventMap, SyncSummary } from '../../shared/types'
import { AppDatabase } from './db/database'
import { SyncScheduler } from './scheduler'
import { AccountService } from './services/accounts'
import { CredentialService } from './services/credentials'
import { ImapService } from './services/imap'
import { createLogger, type AppLogger } from './services/logger'
import { MailService } from './services/mails'
import { SettingsService } from './services/settings'
import { SyncService } from './services/sync'

export interface ApplicationContext {
  database: AppDatabase
  accounts: AccountService
  imap: ImapService
  mails: MailService
  settings: SettingsService
  sync: SyncService
  scheduler: SyncScheduler
}

function broadcast<K extends keyof RendererEventMap>(channel: K, payload?: RendererEventMap[K]): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
}

export function createApplicationContext(logger: AppLogger = createLogger()): ApplicationContext {
  const database = new AppDatabase()
  const credentials = new CredentialService(database)
  const accounts = new AccountService(database, credentials)
  const settings = new SettingsService(database)
  const imap = new ImapService(accounts, credentials, logger)
  const events = {
    changed: () => {
      broadcast('accounts:changed')
      broadcast('mails:changed')
    },
    state: (running: boolean, summary?: SyncSummary) => {
      broadcast('sync:state', { running, summary })
      if (!running && summary && settings.get().notificationsEnabled && summary.added > 0 && Notification.isSupported()) {
        new Notification({ title: '多邮箱统一管理', body: `同步完成，发现 ${summary.added} 封未读邮件` }).show()
      }
    }
  }
  const sync = new SyncService(database, accounts, imap, logger, events)
  const mails = new MailService(database, imap, sync, logger, events.changed)
  const scheduler = new SyncScheduler(sync, settings)
  return { database, accounts, imap, mails, settings, sync, scheduler }
}
