import type { AppSettings } from '../../../shared/types'
import { app } from 'electron'
import type { AppDatabase } from '../db/database'
import { DEFAULT_SETTINGS } from '../db/database'

export class SettingsService {
  constructor(private readonly database: AppDatabase) {}

  get dataPath(): string { return this.database.directory }

  get(): AppSettings {
    const result = { ...DEFAULT_SETTINGS }
    const rows = this.database.sqlite.prepare('SELECT key,value FROM settings').all() as Array<{ key: keyof AppSettings; value: string }>
    for (const row of rows) if (row.key in result) Object.assign(result, { [row.key]: JSON.parse(row.value) })
    return result
  }

  update(patch: Partial<AppSettings>): AppSettings {
    if (patch.launchAtLogin !== undefined && !app.isPackaged) throw new Error('请在安装版应用中设置开机启动')
    const allowed = new Set<keyof AppSettings>(['autoSyncEnabled', 'syncIntervalMinutes', 'launchAtLogin', 'minimizeToTray', 'notificationsEnabled', 'pageSize', 'defaultAccountScope', 'tutorialCompleted'])
    const now = new Date().toISOString()
    const statement = this.database.sqlite.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
    this.database.sqlite.transaction(() => {
      for (const [key, value] of Object.entries(patch)) if (allowed.has(key as keyof AppSettings) && value !== undefined) statement.run(key, JSON.stringify(value), now)
    })()
    const settings = this.get()
    if (patch.launchAtLogin !== undefined) {
      app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, path: process.execPath, args: ['--hidden'], name: 'UnifiedMail' })
    }
    return settings
  }
}
