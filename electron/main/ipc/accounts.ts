import type { AccountService } from '../services/accounts'
import type { ImapService } from '../services/imap'
import type { RegisterHandler } from './contracts'
import { parseAccountInput, parseId } from './validation'

export function registerAccountHandlers(register: RegisterHandler, accounts: AccountService, imap: ImapService): void {
  register('accounts:list', () => accounts.list())
  register('accounts:test', (raw) => imap.test(parseAccountInput(raw)))
  register('accounts:save', async (raw) => {
    const input = parseAccountInput(raw)
    const result = await imap.test(input)
    if (!result.ok) throw new Error(result.message)
    return accounts.save(input)
  })
  register('accounts:set-enabled', (rawId, rawEnabled) => accounts.setEnabled(parseId(rawId), Boolean(rawEnabled)))
  register('accounts:remove', (rawId) => accounts.remove(parseId(rawId)))
}
