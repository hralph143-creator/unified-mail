import { powerMonitor } from 'electron'
import type { SettingsService } from './services/settings'
import type { SyncService } from './services/sync'

export class SyncScheduler {
  private timer: NodeJS.Timeout | null = null
  private lastCheck = 0
  private started = false
  private suspended = false
  constructor(private readonly sync: SyncService, private readonly settings: SettingsService) {}

  start(): void {
    if (this.started) return
    this.started = true
    this.lastCheck = Date.now()
    this.restart()
    powerMonitor.on('resume', this.onResume)
    powerMonitor.on('suspend', this.onSuspend)
  }

  restart(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const settings = this.settings.get()
    if (!this.started || this.suspended || !settings.autoSyncEnabled) return
    const interval = Math.max(15, settings.syncIntervalMinutes) * 60_000
    this.timer = setInterval(() => { this.lastCheck = Date.now(); void this.sync.syncAll('scheduled').catch(() => undefined) }, interval)
  }

  private readonly onResume = (): void => {
    if (!this.started) return
    this.suspended = false
    const settings = this.settings.get()
    const interval = Math.max(15, settings.syncIntervalMinutes) * 60_000
    if (settings.autoSyncEnabled && Date.now() - this.lastCheck >= interval) { this.lastCheck = Date.now(); void this.sync.syncAll('scheduled').catch(() => undefined) }
    this.restart()
  }

  private readonly onSuspend = (): void => {
    this.suspended = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  stop(): void {
    this.started = false
    this.suspended = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    powerMonitor.removeListener('resume', this.onResume)
    powerMonitor.removeListener('suspend', this.onSuspend)
  }
}
