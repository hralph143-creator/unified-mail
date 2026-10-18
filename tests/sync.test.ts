import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

import { AppDatabase } from '../electron/main/db/database'
import { SyncService } from '../electron/main/services/sync'
import { MailService } from '../electron/main/services/mails'
import { MailServiceError } from '../electron/main/services/errors'
import type { AccountService } from '../electron/main/services/accounts'
import type { ImapService, RemoteMail } from '../electron/main/services/imap'
import type { AppLogger } from '../electron/main/services/logger'

function remote(uid: number, subject = `邮件 ${uid}`): RemoteMail {
  return { uid, messageId: `<${uid}@test>`, senderName: '测试发件人', senderAddress: 'sender@test.local', recipients: ['me@test.local'], subject, preview: '测试摘要', receivedAt: new Date(1_700_000_000_000 + uid * 1000).toISOString(), hasAttachments: false }
}

describe('同步与已读核心流程', () => {
  let directory: string
  let database: AppDatabase
  const logger = { info: vi.fn(), warn: vi.fn() } as unknown as AppLogger
  const events = { changed: vi.fn(), state: vi.fn() }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'unified-mail-test-'))
    database = new AppDatabase(directory)
  })
  afterEach(() => { database.close(); rmSync(directory, { recursive: true, force: true }); vi.clearAllMocks() })

  function seedAccount(id: string, email: string): void {
    const now = new Date().toISOString()
    database.sqlite.prepare(`INSERT INTO credentials(id,encrypted_value,created_at,updated_at) VALUES(?,?,?,?)`).run(`cred-${id}`, 'encrypted', now, now)
    database.sqlite.prepare(`INSERT INTO accounts(id,email,provider,display_name,imap_host,imap_port,imap_secure,credential_reference,is_enabled,connection_status,created_at,updated_at) VALUES(?,?,?,?,?,993,1,?,1,'idle',?,?)`).run(id, email, email.endsWith('qq.com') ? 'qq' : '163', email, 'imap.test.local', `cred-${id}`, now, now)
  }

  function createSync(results: Record<string, { uidValidity: string; uidNext: number; mails: RemoteMail[] } | Error>, ids: string[]): SyncService {
    const accounts = { list: () => ids.map((id) => ({ id, isEnabled: true })) } as unknown as AccountService
    const imap = { listUnread: vi.fn(async (id: string) => { const value = results[id]; if (!value) throw new Error('missing result'); if (value instanceof Error) throw value; return value }) } as unknown as ImapService
    return new SyncService(database, accounts, imap, logger, events)
  }

  it('聚合两个账户并按 UID 身份去重', async () => {
    seedAccount('qq', 'a@qq.com'); seedAccount('163', 'b@163.com')
    const sync = createSync({ qq: { uidValidity: '10', uidNext: 6, mails: [1,2,3,4,5].map((uid) => remote(uid)) }, '163': { uidValidity: '20', uidNext: 4, mails: [1,2,3].map((uid) => remote(uid)) } }, ['qq', '163'])
    const first = await sync.syncAll('manual')
    expect(first).toMatchObject({ status: 'success', succeeded: 2, added: 8 })
    const second = await sync.syncAll('manual')
    expect(second.added).toBe(0)
    expect((database.sqlite.prepare('SELECT COUNT(*) count FROM mails WHERE is_read=0').get() as { count: number }).count).toBe(8)
  })

  it('单个账户失败不阻止其他账户完成', async () => {
    seedAccount('qq', 'a@qq.com'); seedAccount('163', 'b@163.com')
    const sync = createSync({ qq: { uidValidity: '10', uidNext: 2, mails: [remote(1)] }, '163': new MailServiceError('AUTH_FAILED', '授权码错误') }, ['qq', '163'])
    const result = await sync.syncAll('manual')
    expect(result).toMatchObject({ status: 'partial', succeeded: 1, failed: 1, added: 1 })
    expect((database.sqlite.prepare(`SELECT connection_status status FROM accounts WHERE id='163'`).get() as { status: string }).status).toBe('auth_required')
  })

  it('连续触发全局同步复用同一个任务', async () => {
    seedAccount('qq', 'a@qq.com')
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const accounts = { list: () => [{ id: 'qq', isEnabled: true }] } as unknown as AccountService
    const listUnread = vi.fn(async () => { await wait; return { uidValidity: '10', uidNext: 2, mails: [remote(1)] } })
    const sync = new SyncService(database, accounts, { listUnread } as unknown as ImapService, logger, events)
    const first = sync.syncAll('manual'); const second = sync.syncAll('manual')
    expect(first).toBe(second)
    release(); await first
    expect(listUnread).toHaveBeenCalledTimes(1)
  })

  it('服务器未读集合减少时同步为本地已读', async () => {
    seedAccount('qq', 'a@qq.com')
    const state = { uidValidity: '10', uidNext: 3, mails: [remote(1), remote(2)] }
    const sync = createSync({ qq: state }, ['qq'])
    await sync.syncAll('manual')
    state.mails = [remote(2)]
    await sync.syncAll('manual')
    expect((database.sqlite.prepare('SELECT is_read value FROM mails WHERE imap_uid=1').get() as { value: number }).value).toBe(1)
  })

  it('UIDVALIDITY 变化时废弃旧索引并建立新身份', async () => {
    seedAccount('qq', 'a@qq.com')
    const state = { uidValidity: '10', uidNext: 2, mails: [remote(1, '旧邮件')] }
    const sync = createSync({ qq: state }, ['qq'])
    await sync.syncAll('manual')
    state.uidValidity = '11'; state.mails = [remote(1, '新邮件')]
    await sync.syncAll('manual')
    const rows = database.sqlite.prepare('SELECT uid_validity,is_read,subject FROM mails ORDER BY created_at').all() as Array<{ uid_validity: string; is_read: number; subject: string }>
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.uid_validity === '10')?.is_read).toBe(1)
    expect(rows.find((row) => row.uid_validity === '11')?.subject).toBe('新邮件')
  })

  it('服务器回写失败时恢复本地未读状态', async () => {
    seedAccount('qq', 'a@qq.com')
    const sync = createSync({ qq: { uidValidity: '10', uidNext: 2, mails: [remote(1)] } }, ['qq'])
    await sync.syncAll('manual')
    const imap = { markRead: vi.fn(async () => { throw new MailServiceError('NETWORK_FAILED', '网络不可用') }) } as unknown as ImapService
    const mails = new MailService(database, imap, sync, logger, events.changed)
    const mailId = (database.sqlite.prepare('SELECT id FROM mails').get() as { id: string }).id
    await expect(mails.markRead(mailId)).rejects.toThrow('网络不可用')
    expect(database.sqlite.prepare('SELECT is_read,operation_pending,sync_status FROM mails WHERE id=?').get(mailId)).toMatchObject({ is_read: 0, operation_pending: 0, sync_status: 'write_failed' })
  })
})
