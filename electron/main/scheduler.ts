import { powerMonitor } from 'electron'
import type { SettingsService } from './services/settings'
import type { SyncService } from './services/sync'

export class SyncScheduler {
  private timer: NodeJS.Timeout | null = null
  private lastCheck = 0
  constructor(private readonly sync: SyncService, private readonly settings: SettingsService) {}

  start(): void {
    this.restart()
    powerMonitor.on('resume', this.onResume)
  }

  restart(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const settings = this.settings.get()
    if (!settings.autoSyncEnabled) return
    const interval = Math.max(15, settings.syncIntervalMinutes) * 60_000
    this.timer = setInterval(() => { this.lastCheck = Date.now(); void this.sync.syncAll('scheduled') }, interval)
  }

  private readonly onResume = (): void => {
    const settings = this.settings.get()
    const interval = Math.max(15, settings.syncIntervalMinutes) * 60_000
    if (settings.autoSyncEnabled && Date.now() - this.lastCheck >= interval) { this.lastCheck = Date.now(); void this.sync.syncAll('scheduled') }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    powerMonitor.removeListener('resume', this.onResume)
  }
}
