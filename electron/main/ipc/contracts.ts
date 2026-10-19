import type { AccountService } from '../services/accounts'
import type { ImapService } from '../services/imap'
import type { MailService } from '../services/mails'
import type { SettingsService } from '../services/settings'
import type { SyncService } from '../services/sync'
import type { IpcChannel } from './channels'

export interface IpcServices {
  accounts: AccountService
  imap: ImapService
  mails: MailService
  settings: SettingsService
  sync: SyncService
  onSettingsChanged(): void
}

export type IpcHandler = (...args: unknown[]) => unknown
export type RegisterHandler = (channel: IpcChannel, handler: IpcHandler) => void
