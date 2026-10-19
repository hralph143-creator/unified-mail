import type { MailService } from '../services/mails'
import type { SettingsService } from '../services/settings'
import type { RegisterHandler } from './contracts'
import { parseSettingsPatch } from './validation'

export function registerSettingsHandlers(register: RegisterHandler, settings: SettingsService, mails: MailService, onSettingsChanged: () => void): void {
  register('settings:get', () => settings.get())
  register('settings:update', (raw) => {
    const updated = settings.update(parseSettingsPatch(raw))
    onSettingsChanged()
    return updated
  })
  register('settings:data-path', () => settings.dataPath)
  register('settings:clear-cache', () => mails.clearCache())
}
