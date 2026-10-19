import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron'
import { join } from 'node:path'

export const appIcon = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="5" fill="#2563eb"/><path d="M6 9h20v15H6z" fill="white"/><path d="m7 10 9 7 9-7" fill="none" stroke="#2563eb" stroke-width="2"/></svg>`).toString('base64')).resize({ width: 16, height: 16 })

interface WindowOptions {
  currentDir: string
  shouldMinimizeToTray(): boolean
  isQuitting(): boolean
  onClosed(): void
}

export function createMainWindow(options: WindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1360, height: 840, minWidth: 960, minHeight: 620, show: false,
    title: '多邮箱统一管理', icon: appIcon, autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#f8fafc', symbolColor: '#536176', height: 44 },
    webPreferences: {
      preload: join(options.currentDir, 'index.mjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      webSecurity: true, allowRunningInsecureContent: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (!options.isQuitting() && options.shouldMinimizeToTray()) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('closed', options.onClosed)
  if (process.env.VITE_DEV_SERVER_URL) void window.loadURL(process.env.VITE_DEV_SERVER_URL)
  else void window.loadFile(join(options.currentDir, '../dist/index.html'))
  return window
}

interface TrayOptions {
  onShow(): void
  onSync(): void
  onQuit(): void
}

export function createAppTray(options: TrayOptions): Tray {
  const tray = new Tray(appIcon)
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
