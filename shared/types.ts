export type Provider = 'qq' | '163' | '126' | 'custom'
export type ConnectionStatus = 'idle' | 'connected' | 'syncing' | 'success' | 'failed' | 'auth_required' | 'disabled'
export type SyncTrigger = 'startup' | 'scheduled' | 'manual' | 'account'
export type SyncResultStatus = 'running' | 'success' | 'partial' | 'failed'

export interface Account {
  id: string
  email: string
  provider: Provider
  displayName: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  isEnabled: boolean
  connectionStatus: ConnectionStatus
  lastSyncAt: string | null
  lastSuccessfulSyncAt: string | null
  unreadCount: number
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface AccountInput {
  id?: string
  email: string
  provider: Provider
  displayName: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  authorizationCode: string
}

export interface MailSummary {
  id: string
  accountId: string
  accountName: string
  provider: Provider
  folderPath: string
  uidValidity: string
  imapUid: number
  senderName: string
  senderAddress: string
  subject: string
  preview: string
  receivedAt: string
  isRead: boolean
  hasAttachments: boolean
  operationPending: boolean
}

export interface AttachmentInfo {
  id: string
  filename: string
  contentType: string
  size: number
  contentId: string | null
}

export interface MailDetail extends MailSummary {
  recipients: string[]
  textBody: string | null
  htmlBody: string | null
  attachments: AttachmentInfo[]
}

export interface MailQuery {
  accountId?: string
  provider?: Provider
  search?: string
  page: number
  pageSize: number
  sort: 'desc' | 'asc'
}

export interface PageResult<T> { items: T[]; total: number }

export interface AppSettings {
  autoSyncEnabled: boolean
  syncIntervalMinutes: number
  launchAtLogin: boolean
  minimizeToTray: boolean
  notificationsEnabled: boolean
  pageSize: number
  defaultAccountScope: string
  tutorialCompleted: boolean
}

export interface SyncRun {
  id: string
  accountId: string | null
  accountName: string | null
  trigger: SyncTrigger
  startedAt: string
  endedAt: string | null
  status: SyncResultStatus
  addedCount: number
  updatedCount: number
  errorCode: string | null
  errorMessage: string | null
}

export interface SyncSummary {
  status: Exclude<SyncResultStatus, 'running'>
  succeeded: number
  failed: number
  added: number
  updated: number
}

export interface TestConnectionResult { ok: boolean; code?: string; message: string }

export interface RendererEventMap {
  'sync:state': { running: boolean; summary?: SyncSummary }
  'accounts:changed': undefined
  'mails:changed': undefined
}

export interface UnifiedMailApi {
  accounts: {
    list(): Promise<Account[]>
    test(input: AccountInput): Promise<TestConnectionResult>
    save(input: AccountInput): Promise<Account>
    setEnabled(id: string, enabled: boolean): Promise<void>
    remove(id: string): Promise<void>
  }
  mails: {
    list(query: MailQuery): Promise<PageResult<MailSummary>>
    detail(id: string): Promise<MailDetail>
    markRead(id: string): Promise<void>
    downloadAttachment(mailId: string, attachmentId: string): Promise<string | null>
  }
  sync: {
    all(trigger?: SyncTrigger): Promise<SyncSummary>
    account(id: string): Promise<SyncSummary>
    state(): Promise<{ running: boolean }>
    history(limit?: number): Promise<SyncRun[]>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
    dataPath(): Promise<string>
    clearMailCache(): Promise<void>
  }
  shell: { openExternal(url: string): Promise<void> }
  events: { on<K extends keyof RendererEventMap>(event: K, callback: (payload: RendererEventMap[K]) => void): () => void }
}
