import { ipcMain } from 'electron'
import { registerAccountHandlers } from './accounts'
import { IPC_CHANNELS } from './channels'
import type { IpcServices, RegisterHandler } from './contracts'
import { registerMailHandlers } from './mails'
import { registerSettingsHandlers } from './settings'
import { registerShellHandlers } from './shell'
import { registerSyncHandlers } from './sync'

export type { IpcServices } from './contracts'

export function registerIpc(services: IpcServices): void {
  const register: RegisterHandler = (channel, handler) => {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => handler(...args))
  }
  registerAccountHandlers(register, services.accounts, services.imap)
  registerMailHandlers(register, services.mails)
  registerSyncHandlers(register, services.sync)
  registerSettingsHandlers(register, services.settings, services.mails, services.onSettingsChanged)
  registerShellHandlers(register)
}

export function unregisterIpc(): void {
  for (const channel of IPC_CHANNELS) ipcMain.removeHandler(channel)
}
