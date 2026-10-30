import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'

export const appIcon = nativeImage.createFromPath(join(app.getAppPath(), 'build/icon.png'))

interface WindowOptions {
  currentDir: string
  shouldMinimizeToTray(): boolean
  isQuitting(): boolean
  showOnReady: boolean
  onSessionEnd(): void
  onClosed(): void
}

export function createMainWindow(options: WindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360, height: 840, minWidth: 720, minHeight: 540, show: false,
    title: '多邮箱统一管理', icon: appIcon, autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(options.currentDir, 'index.mjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  if (options.showOnReady) window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (!options.isQuitting() && options.shouldMinimizeToTray()) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('closed', options.onClosed)
  window.on('session-end', options.onSessionEnd)
  const loading = process.env.VITE_DEV_SERVER_URL ? window.loadURL(process.env.VITE_DEV_SERVER_URL) : window.loadFile(join(options.currentDir, '../dist/index.html'))
  void loading.catch((error: unknown) => { console.error('主界面加载失败', error) })
  return window
}

interface TrayOptions {
  onShow(): void
  onSync(): void
  onQuit(): void
}

export function createAppTray(options: TrayOptions): Tray {
  const tray = new Tray(appIcon.resize({ width: 16, height: 16 }))
  tray.setToolTip('多邮箱统一管理')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主窗口', click: options.onShow },
    { label: '立即同步', click: options.onSync },
    { type: 'separator' },
    { label: '退出程序', click: () => { options.onQuit(); app.quit() } }
  ]))
  tray.on('click', options.onShow)
  return tray
}
