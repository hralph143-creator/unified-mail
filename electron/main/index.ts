import { app, BrowserWindow, dialog, Menu, type Tray } from 'electron'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from './services/logger'
import { registerIpc, unregisterIpc } from './ipc'
import { createApplicationContext, type ApplicationContext } from './application'
import { createAppTray, createMainWindow } from './desktop'

const currentDir = dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let context: ApplicationContext | null = null

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function openWindow(): BrowserWindow {
  if (!context) throw new Error('应用尚未初始化')
  return createMainWindow({
    currentDir,
    shouldMinimizeToTray: () => context?.settings.get().minimizeToTray ?? false,
    isQuitting: () => quitting,
    onClosed: () => { mainWindow = null }
  })
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null)
  const logger = createLogger()
  logger.info({ version: app.getVersion() }, '应用启动')
  context = createApplicationContext(logger)
  const { accounts, imap, mails, settings, sync, scheduler } = context
  registerIpc({ accounts, imap, mails, settings, sync, onSettingsChanged: () => scheduler.restart() })
  mainWindow = openWindow()
  tray = createAppTray({ onShow: showWindow, onSync: () => { void sync.syncAll('manual') }, onQuit: () => { quitting = true } })
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

app.on('activate', () => { if (mainWindow) showWindow(); else if (app.isReady() && context) mainWindow = openWindow() })
app.on('window-all-closed', () => { /* Windows 下由托盘菜单决定何时退出。 */ })
app.on('before-quit', () => { quitting = true; context?.scheduler.stop(); unregisterIpc(); tray?.destroy(); context?.database.close() })
