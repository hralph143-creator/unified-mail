import { app, BrowserWindow, dialog, Menu, nativeImage, Notification, Tray } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppDatabase } from './db/database'
import { AccountService } from './services/accounts'
import { CredentialService } from './services/credentials'
import { ImapService } from './services/imap'
import { createLogger } from './services/logger'
import { MailService } from './services/mails'
import { SettingsService } from './services/settings'
import { SyncService } from './services/sync'
import { registerIpc, unregisterIpc } from './ipc'
import { SyncScheduler } from './scheduler'

const currentDir = dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let database: AppDatabase | null = null
let scheduler: SyncScheduler | null = null

const trayIcon = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="5" fill="#2563eb"/><path d="M6 9h20v15H6z" fill="white"/><path d="m7 10 9 7 9-7" fill="none" stroke="#2563eb" stroke-width="2"/></svg>`).toString('base64')).resize({ width: 16, height: 16 })

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360, height: 840, minWidth: 960, minHeight: 620, show: false,
    title: '多邮箱统一管理', icon: trayIcon, autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f8fafc', symbolColor: '#536176', height: 44 },
    webPreferences: {
      preload: join(currentDir, 'index.mjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (!quitting && new SettingsService(database!).get().minimizeToTray) { event.preventDefault(); window.hide() }
  })
  window.on('closed', () => { mainWindow = null })
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL)
  else void window.loadFile(join(currentDir, '../dist/index.html'))
  return window
}

function createTray(sync: SyncService): void {
  tray = new Tray(trayIcon)
  tray.setToolTip('多邮箱统一管理')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主窗口', click: showWindow },
    { label: '立即同步', click: () => { void sync.syncAll('manual') } },
    { type: 'separator' },
    { label: '退出程序', click: () => { quitting = true; app.quit() } }
  ]))
  tray.on('click', showWindow)
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null)
  const logger = createLogger()
  logger.info({ version: app.getVersion() }, '应用启动')
  database = new AppDatabase()
  const credentials = new CredentialService(database)
  const accounts = new AccountService(database, credentials)
  const settings = new SettingsService(database)
  const broadcast = (channel: string, payload?: unknown) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
  }
  const imap = new ImapService(accounts, credentials, logger)
  const events = {
    changed: () => { broadcast('accounts:changed'); broadcast('mails:changed') },
    state: (running: boolean, summary?: import('../../shared/types').SyncSummary) => {
      broadcast('sync:state', { running, summary })
      if (!running && summary && settings.get().notificationsEnabled && summary.added > 0 && Notification.isSupported()) new Notification({ title: '多邮箱统一管理', body: `同步完成，发现 ${summary.added} 封未读邮件` }).show()
    }
  }
  const sync = new SyncService(database, accounts, imap, logger, events)
  const mails = new MailService(database, imap, sync, logger, events.changed)
  scheduler = new SyncScheduler(sync, settings)
  registerIpc({ accounts, imap, mails, settings, sync, database, onSettingsChanged: () => scheduler?.restart() })
  mainWindow = createWindow()
  createTray(sync)
  scheduler.start()
  if (settings.get().autoSyncEnabled) setTimeout(() => { void sync.syncAll('startup') }, 1500)
}

const hasLock = process.env.UNIFIEDMAIL_ALLOW_MULTIPLE === '1' || app.requestSingleInstanceLock()
if (!hasLock) app.quit()
else {
  app.on('second-instance', showWindow)
  app.whenReady().then(bootstrap).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    console.error(error)
    dialog.showErrorBox('多邮箱统一管理启动失败', message)
    app.quit()
  })
}

app.on('activate', () => { if (mainWindow) showWindow(); else if (app.isReady() && database) mainWindow = createWindow() })
app.on('window-all-closed', () => { /* Windows 下由托盘菜单决定何时退出。 */ })
app.on('before-quit', () => { quitting = true; scheduler?.stop(); unregisterIpc(); tray?.destroy(); database?.close() })
