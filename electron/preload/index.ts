import { contextBridge, ipcRenderer } from 'electron'
import type { RendererEventMap, UnifiedMailApi } from '../../shared/types'

const api: UnifiedMailApi = {
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    test: (input) => ipcRenderer.invoke('accounts:test', input),
    save: (input) => ipcRenderer.invoke('accounts:save', input),
    setEnabled: (id, enabled) => ipcRenderer.invoke('accounts:set-enabled', id, enabled),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id)
  },
  mails: {
    list: (query) => ipcRenderer.invoke('mails:list', query),
    detail: (id) => ipcRenderer.invoke('mails:detail', id),
    markRead: (id) => ipcRenderer.invoke('mails:mark-read', id),
    markAllRead: (scope) => ipcRenderer.invoke('mails:mark-all-read', scope),
    downloadAttachment: (mailId, attachmentId) => ipcRenderer.invoke('mails:download-attachment', mailId, attachmentId)
  },
  sync: {
    all: (trigger = 'manual') => ipcRenderer.invoke('sync:all', trigger),
    account: (id) => ipcRenderer.invoke('sync:account', id),
    state: () => ipcRenderer.invoke('sync:state'),
    history: (limit = 50) => ipcRenderer.invoke('sync:history', limit)
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
    dataPath: () => ipcRenderer.invoke('settings:data-path'),
    clearMailCache: () => ipcRenderer.invoke('settings:clear-cache')
  },
  appearance: {
    setTourOverlay: (active) => ipcRenderer.invoke('window:set-tour-overlay', active),
    controlWindow: (action) => ipcRenderer.invoke('window:control', action)
  },
  shell: { openExternal: (url) => ipcRenderer.invoke('shell:open-external', url) },
  events: {
    on: <K extends keyof RendererEventMap>(event: K, callback: (payload: RendererEventMap[K]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: RendererEventMap[K]) => callback(payload)
      ipcRenderer.on(event, listener)
      return () => ipcRenderer.removeListener(event, listener)
    }
  }
}

contextBridge.exposeInMainWorld('unifiedMail', api)
