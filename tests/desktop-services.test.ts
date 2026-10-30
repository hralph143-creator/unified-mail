import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ setLoginItemSettings: vi.fn(), isPackaged: true, save: vi.fn(), confirm: vi.fn(), write: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    app: { getPath: () => '', get isPackaged() { return mocks.isPackaged }, setLoginItemSettings: mocks.setLoginItemSettings },
    powerMonitor: new EventEmitter(),
    BrowserWindow: { getFocusedWindow: () => null },
    dialog: { showSaveDialog: mocks.save, showMessageBox: mocks.confirm }
  }
})
vi.mock('node:fs/promises', () => ({ writeFile: mocks.write }))

import { powerMonitor } from 'electron'
import { SyncScheduler } from '../electron/main/scheduler'
import { SettingsService } from '../electron/main/services/settings'
import type { SyncService } from '../electron/main/services/sync'
import { DEFAULT_SETTINGS, type AppDatabase } from '../electron/main/db/database'
import { registerMailHandlers } from '../electron/main/ipc/mails'
import type { IpcHandler } from '../electron/main/ipc/contracts'
import type { MailService } from '../electron/main/services/mails'

describe('桌面后台与用户文件保护', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mocks.isPackaged = true })
  afterEach(() => { vi.useRealTimers(); (powerMonitor as unknown as EventEmitter).removeAllListeners() })

  it('休眠暂停调度，唤醒补一次且重新计时；重复start不创建多个监听', async () => {
    const syncAll = vi.fn(async () => ({}))
    const scheduler = new SyncScheduler({ syncAll } as unknown as SyncService, { get: () => ({ ...DEFAULT_SETTINGS, syncIntervalMinutes: 15 }) } as SettingsService)
    scheduler.start(); scheduler.start()
    expect(powerMonitor.listenerCount('resume')).toBe(1)
    powerMonitor.emit('suspend')
    scheduler.restart()
    await vi.advanceTimersByTimeAsync(16 * 60_000)
    expect(syncAll).not.toHaveBeenCalled()
    powerMonitor.emit('resume')
    expect(syncAll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(14 * 60_000)
    expect(syncAll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(syncAll).toHaveBeenCalledTimes(2)
    scheduler.stop()
    powerMonitor.emit('resume')
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(syncAll).toHaveBeenCalledTimes(2)
    expect(powerMonitor.listenerCount('suspend')).toBe(0)
  })

  function settingsService() {
    const values = new Map<string, string>(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [key, JSON.stringify(value)]))
    return new SettingsService({ sqlite: {
      prepare: () => ({ all: () => [...values].map(([key, value]) => ({ key, value })), run: (key: string, value: string) => values.set(key, value) }),
      transaction: (action: () => void) => action
    } } as unknown as AppDatabase)
  }

  it('普通设置不触碰登录启动项，只有用户明确修改开关才注册后台启动', () => {
    const settings = settingsService()
    settings.get()
    settings.update({ tutorialCompleted: true })
    expect(mocks.setLoginItemSettings).not.toHaveBeenCalled()
    settings.update({ launchAtLogin: true })
    expect(mocks.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: true, path: process.execPath, args: ['--hidden'], name: 'UnifiedMail' })
    settings.update({ launchAtLogin: false })
    expect(mocks.setLoginItemSettings).toHaveBeenLastCalledWith({ openAtLogin: false, path: process.execPath, args: ['--hidden'], name: 'UnifiedMail' })
  })

  it('开发/响应式测试实例不能修改安装应用的登录启动项', () => {
    mocks.isPackaged = false
    const settings = settingsService()
    expect(() => settings.update({ launchAtLogin: true })).toThrow('安装版')
    expect(settings.get().launchAtLogin).toBe(false)
    expect(mocks.setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('取消覆盖附件返回null并保留原文件，不会误提示保存成功', async () => {
    let download: IpcHandler | undefined
    registerMailHandlers((channel, handler) => { if (channel === 'mails:download-attachment') download = handler }, {
      attachment: async () => ({ filename: '报告.txt', content: Buffer.from('test') })
    } as unknown as MailService)
    mocks.save.mockResolvedValue({ canceled: false, filePath: 'C:/test/报告.txt' })
    mocks.write.mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 'EEXIST' }))
    mocks.confirm.mockResolvedValue({ response: 0 })
    await expect(download!('mail-1', '0')).resolves.toBeNull()
    expect(mocks.write).toHaveBeenCalledTimes(1)
    expect(mocks.write).toHaveBeenCalledWith('C:/test/报告.txt', expect.any(Buffer), { flag: 'wx' })
  })
})
