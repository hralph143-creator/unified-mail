import type { SyncService } from '../services/sync'
import type { RegisterHandler } from './contracts'
import { parseId, parseLimit, parseSyncTrigger } from './validation'

export function registerSyncHandlers(register: RegisterHandler, sync: SyncService): void {
  register('sync:all', (rawTrigger) => sync.syncAll(parseSyncTrigger(rawTrigger)))
  register('sync:account', async (rawId) => {
    const result = await sync.syncAccount(parseId(rawId), 'account')
    return { status: 'success', succeeded: 1, failed: 0, added: result.added, updated: result.updated }
  })
  register('sync:state', () => ({ running: sync.isRunning() }))
  register('sync:history', (rawLimit) => sync.history(parseLimit(rawLimit)))
}
