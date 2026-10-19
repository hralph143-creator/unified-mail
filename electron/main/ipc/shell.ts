import { shell } from 'electron'
import type { RegisterHandler } from './contracts'
import { parseExternalUrl } from './validation'

export function registerShellHandlers(register: RegisterHandler): void {
  register('shell:open-external', async (rawUrl) => {
    await shell.openExternal(parseExternalUrl(rawUrl).toString())
  })
}
