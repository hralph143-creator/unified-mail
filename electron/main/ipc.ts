import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { AccountInput, AppSettings, MailQuery, SyncTrigger } from '../../shared/types'
import { PROVIDERS } from '../../shared/providers'
import type { AccountService } from './services/accounts'
import type { ImapService } from './services/imap'
import type { MailService } from './services/mails'
import type { SettingsService } from './services/settings'
import type { SyncService } from './services/sync'
import type { AppDatabase } from './db/database'

export interface IpcServices { accounts: AccountService; imap: ImapService; mails: MailService; settings: SettingsService; sync: SyncService; database: AppDatabase; onSettingsChanged(): void }

function text(value: unknown, name: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name}格式不正确`)
  return value.trim()
}

function id(value: unknown): string { return text(value, '标识', 100) }

function accountInput(raw: unknown): AccountInput {
  if (!raw || typeof raw !== 'object') throw new Error('账户信息格式不正确')
  const value = raw as Record<string, unknown>
  const provider = value.provider
  if (typeof provider !== 'string' || !(provider in PROVIDERS)) throw new Error('邮箱服务商无效')
  const email = text(value.email, '邮箱地址', 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请输入有效的完整邮箱地址')
  const port = Number(value.imapPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('IMAP 端口无效')
  return { id: typeof value.id === 'string' ? value.id : undefined, email, provider: provider as AccountInput['provider'], displayName: typeof value.displayName === 'string' ? value.displayName.slice(0, 100) : '', imapHost: text(value.imapHost, 'IMAP 服务器', 253), imapPort: port, imapSecure: value.imapSecure !== false, authorizationCode: text(value.authorizationCode, '客户端授权码', 500) }
}

export function registerIpc(services: IpcServices): void {
  const handle = (channel: string, listener: (...args: unknown[]) => unknown) => ipcMain.handle(channel, (_event, ...args) => listener(...args))
  handle('accounts:list', () => services.accounts.list())
  handle('accounts:test', (raw) => services.imap.test(accountInput(raw)))
  handle('accounts:save', async (raw) => {
    const input = accountInput(raw)
    const result = await services.imap.test(input)
    if (!result.ok) throw new Error(result.message)
    return services.accounts.save(input)
  })
  handle('accounts:set-enabled', (rawId, rawEnabled) => services.accounts.setEnabled(id(rawId), Boolean(rawEnabled)))
  handle('accounts:remove', (rawId) => services.accounts.remove(id(rawId)))
  handle('mails:list', (raw) => {
    const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<MailQuery>
    const query: MailQuery = { page: Math.max(1, Number(value.page) || 1), pageSize: Math.min(100, Math.max(10, Number(value.pageSize) || 50)), sort: value.sort === 'asc' ? 'asc' : 'desc', accountId: typeof value.accountId === 'string' ? value.accountId : undefined, provider: value.provider, search: typeof value.search === 'string' ? value.search.slice(0, 200) : undefined }
    return services.mails.list(query)
  })
  handle('mails:detail', (rawId) => services.mails.detail(id(rawId)))
  handle('mails:mark-read', (rawId) => services.mails.markRead(id(rawId)))
  handle('mails:download-attachment', async (rawMailId, rawAttachmentId) => {
    const item = await services.mails.attachment(id(rawMailId), id(rawAttachmentId))
    const window = BrowserWindow.getFocusedWindow() ?? undefined
    const saveOptions = { title: '保存附件', defaultPath: item.filename }
    const result = window ? await dialog.showSaveDialog(window, saveOptions) : await dialog.showSaveDialog(saveOptions)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, item.content, { flag: 'wx' }).catch(async (error: unknown) => {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
      if (code !== 'EEXIST') throw error
      const boxOptions = { type: 'question' as const, buttons: ['取消', '覆盖'], defaultId: 0, cancelId: 0, message: '文件已存在，是否覆盖？' }
      const overwrite = window ? await dialog.showMessageBox(window, boxOptions) : await dialog.showMessageBox(boxOptions)
      if (overwrite.response === 1) await writeFile(result.filePath!, item.content)
    })
    return result.filePath
  })
  handle('sync:all', (rawTrigger) => services.sync.syncAll((typeof rawTrigger === 'string' ? rawTrigger : 'manual') as SyncTrigger))
  handle('sync:account', async (rawId) => {
    const result = await services.sync.syncAccount(id(rawId), 'account')
    return { status: 'success', succeeded: 1, failed: 0, added: result.added, updated: result.updated }
  })
  handle('sync:state', () => ({ running: services.sync.isRunning() }))
  handle('sync:history', (rawLimit) => services.database.sqlite.prepare(`SELECT s.*,a.display_name account_name FROM sync_runs s LEFT JOIN accounts a ON a.id=s.account_id ORDER BY s.started_at DESC LIMIT ?`).all(Math.min(200, Math.max(1, Number(rawLimit) || 50))).map((row: unknown) => {
    const r = row as Record<string, unknown>
    return { id: r.id, accountId: r.account_id, accountName: r.account_name, trigger: r.trigger, startedAt: r.started_at, endedAt: r.ended_at, status: r.status, addedCount: r.added_count, updatedCount: r.updated_count, errorCode: r.error_code, errorMessage: r.error_message }
  }))
  handle('settings:get', () => services.settings.get())
  handle('settings:update', (raw) => {
    const patch = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppSettings>
    if (patch.syncIntervalMinutes !== undefined) patch.syncIntervalMinutes = Math.min(10080, Math.max(15, Number(patch.syncIntervalMinutes) || 360))
    if (patch.pageSize !== undefined) patch.pageSize = Math.min(100, Math.max(10, Number(patch.pageSize) || 50))
    const updated = services.settings.update(patch)
    services.onSettingsChanged()
    return updated
  })
  handle('settings:data-path', () => services.database.directory)
  handle('settings:clear-cache', () => services.mails.clearCache())
  handle('shell:open-external', async (rawUrl) => {
    const url = new URL(text(rawUrl, '链接', 2048))
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('已阻止不安全的链接')
    await shell.openExternal(url.toString())
  })
}

export function unregisterIpc(): void {
  for (const channel of ['accounts:list','accounts:test','accounts:save','accounts:set-enabled','accounts:remove','mails:list','mails:detail','mails:mark-read','mails:download-attachment','sync:all','sync:account','sync:state','sync:history','settings:get','settings:update','settings:data-path','settings:clear-cache','shell:open-external']) ipcMain.removeHandler(channel)
}
