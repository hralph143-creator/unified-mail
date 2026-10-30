import type { ImapFlow, ImapFlowOptions } from 'imapflow'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { AccountInput } from '../shared/types'
import { PROVIDERS } from '../shared/providers'
import type { AccountService } from '../electron/main/services/accounts'
import type { CredentialService } from '../electron/main/services/credentials'
import { classifyImapError } from '../electron/main/services/errors'
import { ImapService } from '../electron/main/services/imap'
import type { AppLogger } from '../electron/main/services/logger'

function input(provider: AccountInput['provider'], email: string): AccountInput {
  const preset = PROVIDERS[provider]
  return {
    email, provider, displayName: email, imapHost: preset.host || 'imap.example.com', imapPort: preset.port,
    imapSecure: preset.secure, authorizationCode: `code-${provider}`
  }
}

function testClient(connect = vi.fn(async () => undefined)) {
  return Object.assign(new EventEmitter(), {
    usable: true,
    connect,
    mailboxOpen: vi.fn(async (_path: string, _options: { readOnly: boolean }) => ({})),
    logout: vi.fn(async () => undefined),
    close: vi.fn()
  })
}

function mailboxClient() {
  const release = vi.fn()
  return Object.assign(testClient(), {
    mailbox: { uidValidity: 10n, uidNext: 4 },
    release,
    getMailboxLock: vi.fn(async (_path: string, _options?: { readOnly: boolean }) => ({ release })),
    search: vi.fn(async (_query: unknown, _options: unknown) => [1, 2, 3]),
    fetch: vi.fn(async function* (_uids: number[] | string, _query: unknown, _options: unknown) {
      for (const uid of [1, 2, 3]) yield { uid, flags: new Set(['\\Seen']) }
    }),
    fetchOne: vi.fn(async (_uid: number, _query: unknown, _options: unknown) => ({ uid: 1, flags: new Set(['\\Seen']), source: Buffer.from('Content-Type: text/plain; charset=utf-8\r\n\r\n测试正文', 'utf8') })),
    messageFlagsAdd: vi.fn(async (_uids: number | string, _flags: string[], _options: unknown) => true)
  })
}

function serviceWithClient(client: ReturnType<typeof mailboxClient>) {
  return new ImapService(
    { get: () => ({ ...input('qq', 'test@qq.com'), isEnabled: true, credentialReference: 'test-credential' }) } as unknown as AccountService,
    { read: () => 'test-code' } as unknown as CredentialService,
    logger,
    () => client as unknown as ImapFlow
  )
}

const logger = { info: vi.fn(), warn: vi.fn() } as unknown as AppLogger
const accounts = {} as AccountService
const credentials = {} as CredentialService

describe('IMAP 服务商兼容性模拟', () => {
  it('QQ、163、126 与标准 IMAP 分别建立独立 TLS 连接并只读打开 INBOX', async () => {
    const options: ImapFlowOptions[] = []
    const clients: ReturnType<typeof testClient>[] = []
    const factory = (value: ImapFlowOptions) => {
      options.push(value)
      const client = testClient()
      clients.push(client)
      return client as unknown as ImapFlow
    }
    const service = new ImapService(accounts, credentials, logger, factory)
    const cases = [
      input('qq', 'test@qq.com'),
      input('163', 'test@163.com'),
      input('126', 'test@126.com'),
      input('custom', 'test@example.com')
    ]

    for (const value of cases) await expect(service.test(value)).resolves.toMatchObject({ ok: true })

    expect(options.map((value) => ({ host: value.host, port: value.port, secure: value.secure, user: value.auth && 'user' in value.auth ? value.auth.user : undefined }))).toEqual([
      { host: 'imap.qq.com', port: 993, secure: true, user: 'test@qq.com' },
      { host: 'imap.163.com', port: 993, secure: true, user: 'test@163.com' },
      { host: 'imap.126.com', port: 993, secure: true, user: 'test@126.com' },
      { host: 'imap.example.com', port: 993, secure: true, user: 'test@example.com' }
    ])
    expect(options.every((value) => value.tls?.rejectUnauthorized === true && value.socketTimeout === 45_000 && value.greetingTimeout === 20_000)).toBe(true)
    expect(clients.every((client) => client.mailboxOpen.mock.calls[0]?.[0] === 'INBOX' && client.mailboxOpen.mock.calls[0]?.[1]?.readOnly === true)).toBe(true)
    expect(clients.every((client) => client.logout.mock.calls.length === 1)).toBe(true)
  })

  it('结构化认证、限流、DNS、TLS 与断线错误得到可操作的中文分类', () => {
    expect(classifyImapError(Object.assign(new Error('NO'), { authenticationFailed: true })).code).toBe('AUTH_FAILED')
    expect(classifyImapError(Object.assign(new Error('NO'), { code: 'ETHROTTLE' })).code).toBe('RATE_LIMITED')
    expect(classifyImapError(Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' })).code).toBe('DNS_FAILED')
    expect(classifyImapError(Object.assign(new Error('handshake failed'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })).code).toBe('TLS_FAILED')
    expect(classifyImapError(Object.assign(new Error('closed'), { code: 'ECONNRESET' })).code).toBe('NETWORK_FAILED')
  })

  it('连接测试失败不会把授权码交给日志记录器', async () => {
    const warn = vi.fn()
    const failure = Object.assign(new Error('NO rejected code-qq'), { authenticationFailed: true })
    const factory = () => testClient(vi.fn(async () => { throw failure })) as unknown as ImapFlow
    const service = new ImapService(accounts, credentials, { info: vi.fn(), warn } as unknown as AppLogger, factory)
    const value = input('qq', 'test@qq.com')

    await expect(service.test(value)).resolves.toMatchObject({ ok: false, code: 'AUTH_FAILED' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain(value.authorizationCode)
    expect(classifyImapError(failure).technical).toBeUndefined()
  })

  it('自定义非隐式 TLS 连接必须升级 STARTTLS，不允许明文认证降级', async () => {
    const factory = vi.fn((_options: ImapFlowOptions) => testClient() as unknown as ImapFlow)
    const service = new ImapService(accounts, credentials, logger, factory)
    await service.test({ ...input('custom', 'test@example.com'), imapPort: 143, imapSecure: false })
    expect(factory.mock.calls[0]?.[0]).toMatchObject({ secure: false, doSTARTTLS: true, tls: { rejectUnauthorized: true } })
  })

  it('认证阶段的服务商限流保留限流分类而非要求更换授权码', () => {
    expect(classifyImapError(Object.assign(new Error('Command failed'), { authenticationFailed: true, code: 'ETHROTTLE' })).code).toBe('RATE_LIMITED')
  })

  it('详情只读获取正文，不发送已读标记且正确解析中文正文', async () => {
    const client = mailboxClient()
    const service = serviceWithClient(client)
    await expect(service.fetchDetail('qq', 1, '10')).resolves.toMatchObject({ textBody: '测试正文' })
    expect(client.getMailboxLock).toHaveBeenCalledWith('INBOX', { readOnly: true })
    expect(client.fetchOne).toHaveBeenCalledWith(1, { uid: true, source: true }, { uid: true })
    expect(client.messageFlagsAdd).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledOnce()
    expect(client.close).toHaveBeenCalledOnce()
  })

  it('增量同步对账完整未读集合且只抓取未知 UID', async () => {
    const client = mailboxClient()
    const service = serviceWithClient(client)
    await expect(service.listUnread('qq', { uidValidity: '10', unreadUids: [1, 2] })).resolves.toMatchObject({ unreadUids: [1, 2, 3], remaining: 0 })
    expect(client.getMailboxLock).toHaveBeenCalledWith('INBOX', { readOnly: true })
    expect(client.fetch.mock.calls[0]?.[0]).toEqual([3])
    expect(client.messageFlagsAdd).not.toHaveBeenCalled()
  })

  it('单封与批量已读遇到 UIDVALIDITY 变化均保持错误码且不写服务器', async () => {
    const client = mailboxClient()
    const service = serviceWithClient(client)
    await expect(service.markRead('qq', 1, '9')).rejects.toMatchObject({ code: 'UIDVALIDITY_CHANGED' })
    await expect(service.markAllRead('qq', [1, 2], '9')).rejects.toMatchObject({ code: 'UIDVALIDITY_CHANGED' })
    expect(client.messageFlagsAdd).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledTimes(2)
  })

  it('批量确认只接受请求内已读 UID，排除未读与多余响应', async () => {
    const client = mailboxClient()
    client.fetch.mockImplementation(async function* () {
      yield { uid: 1, flags: new Set(['\\Seen']) }
      yield { uid: 2, flags: new Set<string>() }
      yield { uid: 999, flags: new Set(['\\Seen']) }
    })
    await expect(serviceWithClient(client).markAllRead('qq', [1, 2], '10')).rejects.toMatchObject({ code: 'WRITE_PARTIAL', confirmedUids: [1] })
  })

  it('批量确认途中断线保留已收到的逐 UID 确认结果', async () => {
    const client = mailboxClient()
    client.fetch.mockImplementation(async function* () {
      yield { uid: 1, flags: new Set(['\\Seen']) }
      throw Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })
    })
    await expect(serviceWithClient(client).markAllRead('qq', [1, 2], '10')).rejects.toMatchObject({ code: 'WRITE_PARTIAL', confirmedUids: [1] })
    expect(client.release).toHaveBeenCalledOnce()
    expect(client.close).toHaveBeenCalledOnce()
  })

  it('连接后的 socket error 有监听者并关闭连接，不成为未处理异常', async () => {
    const client = mailboxClient()
    const failure = Object.assign(new Error('socket closed'), { code: 'ECONNRESET' })
    await expect(serviceWithClient(client).withAccount('qq', async () => {
      expect(() => client.emit('error', failure)).not.toThrow()
      throw failure
    })).rejects.toMatchObject({ code: 'NETWORK_FAILED' })
    expect(client.close).toHaveBeenCalled()
  })

  it('连接尚未可用就失败时仍关闭底层资源，退出后拒绝新操作', async () => {
    const client = mailboxClient()
    client.usable = false
    client.connect.mockRejectedValueOnce(Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' }))
    const service = serviceWithClient(client)
    await expect(service.listUnread('qq')).rejects.toMatchObject({ code: 'DNS_FAILED' })
    expect(client.logout).not.toHaveBeenCalled()
    expect(client.close).toHaveBeenCalledOnce()
    await service.shutdown()
    await expect(service.listUnread('qq')).rejects.toMatchObject({ code: 'APP_SHUTTING_DOWN' })
    expect(client.connect).toHaveBeenCalledOnce()
  })
})
