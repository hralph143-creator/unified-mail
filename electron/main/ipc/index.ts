import { BrowserWindow, ipcMain } from 'electron'
import { registerAccountHandlers } from './accounts'
import { IPC_CHANNELS } from './channels'
import type { IpcServices, RegisterHandler } from './contracts'
import { registerMailHandlers } from './mails'
import { registerSettingsHandlers } from './settings'
import { registerShellHandlers } from './shell'
import { registerSyncHandlers } from './sync'
import { parseBoolean } from './validation'

export type { IpcServices } from './contracts'

const pendingHandlers = new Set<Promise<unknown>>()

export async function waitForIpcIdle(): Promise<void> {
  while (pendingHandlers.size) await Promise.allSettled([...pendingHandlers])
}

export function registerIpc(services: IpcServices): void {
  const register: RegisterHandler = (channel, handler) => {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => {
      const task = Promise.resolve().then(() => handler(...args))
      pendingHandlers.add(task)
      task.then(() => pendingHandlers.delete(task), () => pendingHandlers.delete(task))
      return task
    })
  }
  registerAccountHandlers(register, services.accounts, services.imap)
  registerMailHandlers(register, services.mails)
  registerSyncHandlers(register, services.sync)
  registerSettingsHandlers(register, services.settings, services.mails, services.onSettingsChanged)
  registerShellHandlers(register)
  ipcMain.handle('window:set-tour-overlay', (event, raw: unknown) => {
    const active = parseBoolean(raw, '引导遮罩状态')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    window.setMinimizable(!active)
    window.setMaximizable(!active)
    window.setClosable(!active)
    return {
      minimizable: window.isMinimizable(),
      maximizable: window.isMaximizable(),
      closable: window.isClosable()
    }
  })
  ipcMain.handle('window:control', (event, raw: unknown) => {
    if (raw !== 'minimize' && raw !== 'maximize' && raw !== 'close') throw new Error('窗口操作无效')
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (raw === 'minimize') window.minimize()
    else if (raw === 'maximize') {
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
    }
    else window.close()
  })
}

export function unregisterIpc(): void {
  for (const channel of IPC_CHANNELS) ipcMain.removeHandler(channel)
}
