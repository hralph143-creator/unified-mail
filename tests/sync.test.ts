import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, '')
  }
}))

import { AppDatabase } from '../electron/main/db/database'
import { SyncService } from '../electron/main/services/sync'
import { MailService } from '../electron/main/services/mails'
import { MailServiceError, PartialMarkReadError, classifyImapError } from '../electron/main/services/errors'
import { AccountService } from '../electron/main/services/accounts'
import { CredentialService } from '../electron/main/services/credentials'
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

  it('同步失败不会把已有未读邮件解释为空集合', async () => {
    seedAccount('qq', 'a@qq.com')
    const results: Record<string, { uidValidity: string; uidNext: number; mails: RemoteMail[] } | Error> = { qq: { uidValidity: '10', uidNext: 2, mails: [remote(1)] } }
    const sync = createSync(results, ['qq'])
    await sync.syncAll('manual')
    results.qq = new MailServiceError('NETWORK_FAILED', '网络不可用')
    await expect(sync.syncAll('manual')).resolves.toMatchObject({ status: 'failed', failed: 1 })
    expect(database.sqlite.prepare('SELECT COUNT(*) count FROM mails WHERE is_read=0').get()).toMatchObject({ count: 1 })
  })

  it('后台同步遇到临时网络错误时自动重试一次', async () => {
    vi.useFakeTimers()
    try {
      seedAccount('qq', 'a@qq.com')
      const accounts = { list: () => [{ id: 'qq', isEnabled: true }] } as unknown as AccountService
      const listUnread = vi.fn()
        .mockRejectedValueOnce(new MailServiceError('NETWORK_FAILED', '网络不可用'))
        .mockResolvedValueOnce({ uidValidity: '10', uidNext: 2, unreadUids: [1], mails: [remote(1)], remaining: 0 })
      const sync = new SyncService(database, accounts, { listUnread } as unknown as ImapService, logger, events)
      const running = sync.syncAll('scheduled')
      await vi.advanceTimersByTimeAsync(1_500)
      await expect(running).resolves.toMatchObject({ status: 'success', added: 1 })
      expect(listUnread).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
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

  it('连续触发同一账户同步复用同一个任务', async () => {
    seedAccount('qq', 'a@qq.com')
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const accounts = { list: () => [{ id: 'qq', isEnabled: true }] } as unknown as AccountService
    const listUnread = vi.fn(async () => { await wait; return { uidValidity: '10', uidNext: 2, unreadUids: [1], mails: [remote(1)], remaining: 0 } })
    const sync = new SyncService(database, accounts, { listUnread } as unknown as ImapService, logger, events)
    const first = sync.syncAccount('qq'); const second = sync.syncAccount('qq')
    expect(first).toBe(second)
    release(); await first
    expect(listUnread).toHaveBeenCalledTimes(1)
  })

  it('失败的账户同步会释放任务与互斥锁以允许重试', async () => {
    seedAccount('qq', 'a@qq.com')
    const accounts = { list: () => [{ id: 'qq', isEnabled: true }] } as unknown as AccountService
    const listUnread = vi.fn()
      .mockRejectedValueOnce(new MailServiceError('NETWORK_FAILED', '网络不可用'))
      .mockResolvedValueOnce({ uidValidity: '10', uidNext: 2, unreadUids: [1], mails: [remote(1)], remaining: 0 })
    const sync = new SyncService(database, accounts, { listUnread } as unknown as ImapService, logger, events)
    await expect(sync.syncAccount('qq')).rejects.toThrow('网络不可用')
    await expect(sync.syncAccount('qq')).resolves.toMatchObject({ added: 1 })
    expect(listUnread).toHaveBeenCalledTimes(2)
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

  it('增量同步只接收新增邮件，同时用完整 UID 集合对账', async () => {
    seedAccount('qq', 'a@qq.com')
    const accounts = { list: () => [{ id: 'qq', isEnabled: true }] } as unknown as AccountService
    const listUnread = vi.fn()
      .mockResolvedValueOnce({ uidValidity: '10', uidNext: 3, unreadUids: [1, 2], mails: [remote(1), remote(2)], remaining: 0 })
      .mockResolvedValueOnce({ uidValidity: '10', uidNext: 4, unreadUids: [2, 3], mails: [remote(3)], remaining: 0 })
    const sync = new SyncService(database, accounts, { listUnread } as unknown as ImapService, logger, events)
    await sync.syncAll('manual')
    const result = await sync.syncAll('manual')
    expect(listUnread).toHaveBeenLastCalledWith('qq', { uidValidity: '10', unreadUids: [1, 2] })
    expect(result).toMatchObject({ added: 1, updated: 1 })
    expect(database.sqlite.prepare('SELECT imap_uid,is_read FROM mails ORDER BY imap_uid').all()).toEqual([
      expect.objectContaining({ imap_uid: 1, is_read: 1 }),
      expect.objectContaining({ imap_uid: 2, is_read: 0 }),
      expect.objectContaining({ imap_uid: 3, is_read: 0 })
    ])
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

  it('同步与已读写回在同一账户上严格串行', async () => {
    seedAccount('qq', 'a@qq.com')
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    const order: string[] = []
    const accounts = { list: () => [{ id: 'qq', isEnabled: true }] } as unknown as AccountService
    const imap = {
      listUnread: vi.fn(async () => { order.push('sync-start'); await wait; order.push('sync-end'); return { uidValidity: '10', uidNext: 2, unreadUids: [1], mails: [remote(1)], remaining: 0 } }),
      markRead: vi.fn(async () => { order.push('mark-read') })
    } as unknown as ImapService
    const sync = new SyncService(database, accounts, imap, logger, events)
    const syncing = sync.syncAccount('qq')
    await vi.waitFor(() => expect(order).toContain('sync-start'))
    const seededAt = new Date().toISOString()
    database.sqlite.prepare(`INSERT INTO mails(id,account_id,folder_path,uid_validity,imap_uid,message_id,sender_name,sender_address,recipients,subject,preview,received_at,is_read,has_attachments,operation_pending,sync_status,created_at,updated_at) VALUES('mail-1','qq','INBOX','10',1,NULL,'','','[]','','',?,0,0,0,'synced',?,?)`).run(seededAt, seededAt, seededAt)
    const mails = new MailService(database, imap, sync, logger, events.changed)
    const marking = mails.markRead('mail-1')
    await Promise.resolve()
    expect(order).toEqual(['sync-start'])
    release()
    await Promise.all([syncing, marking])
    expect(order).toEqual(['sync-start', 'sync-end', 'mark-read'])
  })

  it('服务器写回成功但本地更新失败时不错误显示为已读', async () => {
    seedAccount('qq', 'a@qq.com')
    const sync = createSync({ qq: { uidValidity: '10', uidNext: 2, mails: [remote(1)] } }, ['qq'])
    await sync.syncAll('manual')
    const imap = { markRead: vi.fn(async () => undefined) } as unknown as ImapService
    const mails = new MailService(database, imap, sync, logger, events.changed)
    const mailId = (database.sqlite.prepare('SELECT id FROM mails').get() as { id: string }).id
    database.sqlite.exec(`CREATE TRIGGER reject_local_read BEFORE UPDATE OF is_read ON mails WHEN NEW.is_read=1 BEGIN SELECT RAISE(FAIL, 'simulated write failure'); END`)
    await expect(mails.markRead(mailId)).rejects.toThrow('simulated write failure')
    expect(database.sqlite.prepare('SELECT is_read,operation_pending,sync_status FROM mails WHERE id=?').get(mailId)).toMatchObject({ is_read: 0, operation_pending: 0, sync_status: 'write_failed' })
  })

  it('一键已读只处理当前账户范围', async () => {
    seedAccount('qq', 'a@qq.com'); seedAccount('163', 'b@163.com')
    const sync = createSync({ qq: { uidValidity: '10', uidNext: 3, mails: [remote(1), remote(2)] }, '163': { uidValidity: '20', uidNext: 2, mails: [remote(1)] } }, ['qq', '163'])
    await sync.syncAll('manual')
    const markAllRead = vi.fn(async (_accountId: string, uids: number[]) => uids)
    const mails = new MailService(database, { markAllRead } as unknown as ImapService, sync, logger, events.changed)
    await expect(mails.markAllRead({ accountId: 'qq' })).resolves.toEqual({ marked: 2, succeeded: 1, failed: 0 })
    expect(markAllRead).toHaveBeenCalledWith('qq', [1, 2], '10')
    expect(database.sqlite.prepare(`SELECT COUNT(*) count FROM mails WHERE account_id='qq' AND is_read=0`).get()).toMatchObject({ count: 0 })
    expect(database.sqlite.prepare(`SELECT COUNT(*) count FROM mails WHERE account_id='163' AND is_read=0`).get()).toMatchObject({ count: 1 })
  })

  it('统一收件箱一键已读允许部分账户失败并恢复其本地状态', async () => {
    seedAccount('qq', 'a@qq.com'); seedAccount('163', 'b@163.com')
    const sync = createSync({ qq: { uidValidity: '10', uidNext: 2, mails: [remote(1)] }, '163': { uidValidity: '20', uidNext: 2, mails: [remote(1)] } }, ['qq', '163'])
    await sync.syncAll('manual')
    const markAllRead = vi.fn(async (accountId: string, uids: number[]) => { if (accountId === '163') throw new MailServiceError('NETWORK_FAILED', '网络不可用'); return uids })
    const mails = new MailService(database, { markAllRead } as unknown as ImapService, sync, logger, events.changed)
    await expect(mails.markAllRead({})).resolves.toEqual({ marked: 1, succeeded: 1, failed: 1 })
    expect(database.sqlite.prepare(`SELECT is_read,operation_pending FROM mails WHERE account_id='qq'`).get()).toMatchObject({ is_read: 1, operation_pending: 0 })
    expect(database.sqlite.prepare(`SELECT is_read,operation_pending,sync_status FROM mails WHERE account_id='163'`).get()).toMatchObject({ is_read: 0, operation_pending: 0, sync_status: 'write_failed' })
  })

  it('一键已读只提交服务器已确认的部分 UID', async () => {
    seedAccount('qq', 'a@qq.com')
    const sync = createSync({ qq: { uidValidity: '10', uidNext: 4, mails: [remote(1), remote(2), remote(3)] } }, ['qq'])
    await sync.syncAll('manual')
    const markAllRead = vi.fn(async () => { throw new PartialMarkReadError('部分失败', [1, 2]) })
    const mails = new MailService(database, { markAllRead } as unknown as ImapService, sync, logger, events.changed)
    await expect(mails.markAllRead({ accountId: 'qq' })).resolves.toEqual({ marked: 2, succeeded: 0, failed: 1 })
    expect(database.sqlite.prepare('SELECT imap_uid,is_read,operation_pending,sync_status FROM mails ORDER BY imap_uid').all()).toEqual([
      expect.objectContaining({ imap_uid: 1, is_read: 1, operation_pending: 0, sync_status: 'synced' }),
      expect.objectContaining({ imap_uid: 2, is_read: 1, operation_pending: 0, sync_status: 'synced' }),
      expect.objectContaining({ imap_uid: 3, is_read: 0, operation_pending: 0, sync_status: 'write_failed' })
    ])
  })

  it('同步会恢复应用中断留下的已读待确认状态', async () => {
    seedAccount('qq', 'a@qq.com')
    const accounts = { list: () => [{ id: 'qq', isEnabled: true }] } as unknown as AccountService
    const listUnread = vi.fn()
      .mockResolvedValueOnce({ uidValidity: '10', uidNext: 3, unreadUids: [1, 2], mails: [remote(1), remote(2)], remaining: 0 })
      .mockResolvedValueOnce({ uidValidity: '10', uidNext: 3, unreadUids: [2], mails: [], remaining: 0 })
    const sync = new SyncService(database, accounts, { listUnread } as unknown as ImapService, logger, events)
    await sync.syncAll('manual')
    database.sqlite.prepare(`UPDATE mails SET operation_pending=1,sync_status='pending_seen'`).run()
    await sync.syncAll('manual')
    expect(database.sqlite.prepare('SELECT imap_uid,is_read,operation_pending,sync_status FROM mails ORDER BY imap_uid').all()).toEqual([
      expect.objectContaining({ imap_uid: 1, is_read: 1, operation_pending: 0, sync_status: 'synced' }),
      expect.objectContaining({ imap_uid: 2, is_read: 0, operation_pending: 0, sync_status: 'write_failed' })
    ])
  })

  it('保留明确的 IMAP 业务错误码', () => {
    const error = new MailServiceError('UIDVALIDITY_CHANGED', '邮箱索引已变化')
    expect(classifyImapError(error)).toBe(error)
  })

  it('账户保存失败时回滚新建的加密凭据', () => {
    const accounts = new AccountService(database, new CredentialService(database))
    database.sqlite.exec(`CREATE TRIGGER reject_account_insert BEFORE INSERT ON accounts BEGIN SELECT RAISE(FAIL, 'simulated account failure'); END`)
    expect(() => accounts.save({ email: 'rollback@qq.com', provider: 'qq', displayName: '回滚测试', imapHost: 'imap.qq.com', imapPort: 993, imapSecure: true, authorizationCode: 'never-log-this' })).toThrow('simulated account failure')
    expect(database.sqlite.prepare('SELECT COUNT(*) count FROM credentials').get()).toMatchObject({ count: 0 })
  })

  it('附件缓存超过五封邮件时淘汰最早项目', async () => {
    seedAccount('qq', 'a@qq.com')
    const sync = createSync({ qq: { uidValidity: '10', uidNext: 7, mails: [1, 2, 3, 4, 5, 6].map((uid) => remote(uid)) } }, ['qq'])
    await sync.syncAll('manual')
    const fetchDetail = vi.fn(async () => ({ textBody: '正文', htmlBody: null, recipients: [], attachments: [{ id: '0', filename: 'a.txt', contentType: 'text/plain', size: 1, contentId: null, content: Buffer.from('a') }] }))
    const mails = new MailService(database, { fetchDetail } as unknown as ImapService, sync, logger, events.changed)
    const ids = (database.sqlite.prepare('SELECT id FROM mails ORDER BY imap_uid').all() as Array<{ id: string }>).map((row) => row.id)
    for (const id of ids) await mails.detail(id)
    await mails.attachment(ids[0]!, '0')
    expect(fetchDetail).toHaveBeenCalledTimes(7)
  })

  it('以领域模型返回最近同步历史', async () => {
    seedAccount('qq', 'a@qq.com')
    const sync = createSync({ qq: { uidValidity: '10', uidNext: 2, mails: [remote(1)] } }, ['qq'])
    await sync.syncAll('scheduled')
    expect(sync.history(1)).toEqual([
      expect.objectContaining({ accountId: 'qq', accountName: 'a@qq.com', trigger: 'scheduled', status: 'success', addedCount: 1, updatedCount: 0 })
    ])
  })

  it('全局同步初始化失败时恢复运行状态', async () => {
    const accounts = { list: () => { throw new Error('数据库不可用') } } as unknown as AccountService
    const sync = new SyncService(database, accounts, {} as ImapService, logger, events)
    await expect(sync.syncAll('manual')).rejects.toThrow('数据库不可用')
    expect(sync.isRunning()).toBe(false)
    expect(events.state).toHaveBeenNthCalledWith(1, true)
    expect(events.state).toHaveBeenNthCalledWith(2, false)
  })
})
