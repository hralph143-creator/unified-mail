import { app, BrowserWindow, dialog, Menu, type Tray } from 'electron'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLogger } from './services/logger'
import { registerIpc, unregisterIpc, waitForIpcIdle } from './ipc'
import { createApplicationContext, type ApplicationContext } from './application'
import { appIcon, createAppTray, createMainWindow } from './desktop'

const currentDir = dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
let shutdownStarted = false
let shutdownComplete = false
let context: ApplicationContext | null = null
let startupTimer: NodeJS.Timeout | null = null

function showWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function openWindow(showOnReady = true): BrowserWindow {
  if (!context) throw new Error('应用尚未初始化')
  return createMainWindow({
    currentDir,
    shouldMinimizeToTray: () => context?.settings.get().minimizeToTray ?? false,
    isQuitting: () => quitting,
    showOnReady,
    onSessionEnd: beginShutdown,
    onClosed: () => { mainWindow = null }
  })
}

async function bootstrap(): Promise<void> {
  Menu.setApplicationMenu(null)
  const logger = createLogger()
  logger.info({ version: app.getVersion() }, '应用启动')
  context = createApplicationContext(logger)
  const { accounts, imap, mails, settings, sync, scheduler } = context
  if (appIcon.isEmpty()) throw new Error('应用图标资源缺失，请重新安装应用')
  registerIpc({ accounts, imap, mails, settings, sync, onSettingsChanged: () => scheduler.restart() })
  mainWindow = openWindow(!process.argv.includes('--hidden'))
  tray = createAppTray({ onShow: showWindow, onSync: () => { void sync.syncAll('manual').catch(() => undefined) }, onQuit: () => { quitting = true } })
  scheduler.start()
  if (settings.get().autoSyncEnabled) startupTimer = setTimeout(() => { startupTimer = null; if (!quitting) void sync.syncAll('startup').catch(() => undefined) }, 1500)
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
app.on('window-all-closed', () => { if (!quitting) app.quit() })
app.on('before-quit', (event) => {
  if (shutdownComplete) return
  event.preventDefault()
  beginShutdown()
})

function beginShutdown(): void {
  if (shutdownStarted) return
  shutdownStarted = true
  quitting = true
  if (startupTimer) clearTimeout(startupTimer)
  startupTimer = null
  mainWindow?.setClosable(true)
  mainWindow?.setMinimizable(true)
  mainWindow?.setMaximizable(true)
  context?.scheduler.stop()
  unregisterIpc()
  void (async () => {
    if (context) {
      await Promise.all([context.imap.shutdown(), context.sync.waitForIdle(), waitForIpcIdle()])
      context.database.close()
    }
    tray?.destroy()
    shutdownComplete = true
    app.quit()
  })().catch((error: unknown) => {
    console.error('应用退出清理失败', error)
    shutdownComplete = true
    app.exit(1)
  })
}
