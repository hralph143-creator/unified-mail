import { ImapFlow } from 'imapflow'
import { simpleParser, type AddressObject } from 'mailparser'
import type { AccountInput, AttachmentInfo, TestConnectionResult } from '../../../shared/types'
import type { AccountService } from './accounts'
import type { CredentialService } from './credentials'
import { classifyImapError, MailServiceError, PartialMarkReadError } from './errors'
import type { AppLogger } from './logger'

export interface RemoteMail {
  uid: number; messageId: string | null; senderName: string; senderAddress: string; recipients: string[]; subject: string
  preview: string; receivedAt: string; hasAttachments: boolean
}

export interface KnownMailboxState { uidValidity: string | null; unreadUids: number[] }
export interface UnreadMailboxState { uidValidity: string; uidNext: number | null; unreadUids: number[]; mails: RemoteMail[]; remaining: number }

const MAX_NEW_MESSAGES_PER_SYNC = 500

function addresses(value: AddressObject | AddressObject[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : []
  return values.flatMap((item) => item.value.map((entry) => entry.address ?? '').filter(Boolean))
}

export class ImapService {
  private readonly clients = new Set<ImapFlow>()
  private shuttingDown = false
  private idleResolvers: Array<() => void> = []
  constructor(private readonly accounts: AccountService, private readonly credentials: CredentialService, private readonly logger: AppLogger) {}

  private createClient(config: { email: string; host: string; port: number; secure: boolean; authorizationCode: string }): ImapFlow {
    return new ImapFlow({
      host: config.host, port: config.port, secure: config.secure,
      auth: { user: config.email, pass: config.authorizationCode },
      logger: false, tls: { rejectUnauthorized: true }, socketTimeout: 45_000, greetingTimeout: 20_000
    })
  }

  async withAccount<T>(accountId: string, action: (client: ImapFlow) => Promise<T>): Promise<T> {
    if (this.shuttingDown) throw new MailServiceError('APP_SHUTTING_DOWN', '应用正在退出，已取消邮箱操作')
    const account = this.accounts.get(accountId)
    if (!account) throw new MailServiceError('ACCOUNT_NOT_FOUND', '邮箱账户不存在')
    if (!account.isEnabled) throw new MailServiceError('ACCOUNT_DISABLED', '该邮箱账户已停用')
    const code = this.credentials.read(account.credentialReference)
    const client = this.createClient({ email: account.email, host: account.imapHost, port: account.imapPort, secure: account.imapSecure, authorizationCode: code })
    this.clients.add(client)
    try {
      await client.connect()
      return await action(client)
    } catch (error) {
      throw classifyImapError(error)
    } finally {
      if (client.usable) await client.logout().catch(() => client.close())
      this.clients.delete(client)
      if (!this.clients.size) {
        for (const resolve of this.idleResolvers.splice(0)) resolve()
      }
    }
  }

  async test(input: AccountInput): Promise<TestConnectionResult> {
    if (this.shuttingDown) throw new MailServiceError('APP_SHUTTING_DOWN', '应用正在退出，已取消邮箱操作')
    const client = this.createClient({ email: input.email, host: input.imapHost, port: input.imapPort, secure: input.imapSecure, authorizationCode: input.authorizationCode })
    this.clients.add(client)
    try {
      await client.connect()
      await client.mailboxOpen('INBOX', { readOnly: true })
      return { ok: true, message: '连接和认证成功' }
    } catch (error) {
      const classified = classifyImapError(error)
      this.logger.warn({ code: classified.code, technical: classified.technical }, '邮箱连接测试失败')
      return { ok: false, code: classified.code, message: classified.message }
    } finally {
      if (client.usable) await client.logout().catch(() => client.close())
      this.clients.delete(client)
      if (!this.clients.size) {
        for (const resolve of this.idleResolvers.splice(0)) resolve()
      }
    }
  }

  async listUnread(accountId: string, known?: KnownMailboxState): Promise<UnreadMailboxState> {
    return this.withAccount(accountId, async (client) => {
      const lock = await client.getMailboxLock('INBOX', { readOnly: true })
      try {
        const mailbox = client.mailbox
        if (!mailbox) throw new MailServiceError('MAILBOX_UNAVAILABLE', '无法打开收件箱')
        const uidValidity = String(mailbox.uidValidity)
        const uidNext = mailbox.uidNext ?? null
        const unseenResult = await client.search({ seen: false }, { uid: true })
        const unseen = unseenResult || []
        if (!unseen.length) return { uidValidity, uidNext, unreadUids: [], mails: [], remaining: 0 }
        const knownUids = known?.uidValidity === uidValidity ? new Set(known.unreadUids) : new Set<number>()
        const missing = unseen.filter((uid) => !knownUids.has(uid))
        const requested = missing.slice(-MAX_NEW_MESSAGES_PER_SYNC)
        if (!requested.length) return { uidValidity, uidNext, unreadUids: unseen, mails: [], remaining: 0 }
        const mails: RemoteMail[] = []
        for await (const message of client.fetch(requested, { uid: true, envelope: true, internalDate: true, bodyStructure: true, source: { start: 0, maxLength: 96 * 1024 } }, { uid: true })) {
          const envelope = message.envelope
          const sender = envelope?.from?.[0]
          let preview = ''
          if (message.source) {
            try {
              const parsed = await simpleParser(message.source, { skipHtmlToText: false, skipTextToHtml: true })
              preview = (parsed.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
            } catch { preview = '' }
          }
          const body = message.bodyStructure
          const hasAttachments = JSON.stringify(body ?? {}).toLowerCase().includes('attachment')
          mails.push({
            uid: message.uid, messageId: envelope?.messageId ?? null, senderName: sender?.name ?? '', senderAddress: sender?.address ?? '',
            recipients: (envelope?.to ?? []).map((item) => item.address ?? '').filter(Boolean), subject: envelope?.subject || '(无主题)', preview,
            receivedAt: new Date(message.internalDate ?? envelope?.date ?? Date.now()).toISOString(), hasAttachments
          })
        }
        return { uidValidity, uidNext, unreadUids: unseen, mails, remaining: Math.max(0, missing.length - requested.length) }
      } finally { lock.release() }
    })
  }

  async markRead(accountId: string, uid: number, expectedUidValidity: string): Promise<void> {
    await this.withAccount(accountId, async (client) => {
      const lock = await client.getMailboxLock('INBOX')
      try {
        if (!client.mailbox || String(client.mailbox.uidValidity) !== expectedUidValidity) throw new MailServiceError('UIDVALIDITY_CHANGED', '邮箱索引已变化，请先重新同步后再操作')
        const changed = await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
        if (!changed) throw new MailServiceError('WRITE_UNCONFIRMED', '服务器未确认已读操作，请重新同步确认状态')
        const confirmation = await client.fetchOne(uid, { uid: true, flags: true }, { uid: true })
        if (!confirmation || !confirmation.flags?.has('\\Seen')) throw new MailServiceError('WRITE_UNCONFIRMED', '服务器未能确认已读状态，请稍后重试')
      } finally { lock.release() }
    })
  }

  async markAllRead(accountId: string, uids: number[], expectedUidValidity: string): Promise<number[]> {
    if (!uids.length) return []
    const confirmed: number[] = []
    try {
      await this.withAccount(accountId, async (client) => {
        const lock = await client.getMailboxLock('INBOX')
        try {
          if (!client.mailbox || String(client.mailbox.uidValidity) !== expectedUidValidity) throw new MailServiceError('UIDVALIDITY_CHANGED', '邮箱索引已变化，请先重新同步后再操作')
          for (let index = 0; index < uids.length; index += 500) {
            const requested = uids.slice(index, index + 500)
            const batch = requested.join(',')
            const changed = await client.messageFlagsAdd(batch, ['\\Seen'], { uid: true })
            if (!changed) throw new PartialMarkReadError('服务器未确认批量已读操作，请重新同步确认状态', [...confirmed])
            const seen = new Set<number>()
            for await (const message of client.fetch(batch, { uid: true, flags: true }, { uid: true })) {
              if (message.flags?.has('\\Seen')) seen.add(message.uid)
            }
            confirmed.push(...requested.filter((uid) => seen.has(uid)))
            if (seen.size !== requested.length) throw new PartialMarkReadError('部分邮件已被移动、删除或未能确认已读状态', [...confirmed])
          }
        } finally { lock.release() }
      })
      return confirmed
    } catch (error) {
      if (error instanceof PartialMarkReadError) throw error
      const known = classifyImapError(error)
      throw new PartialMarkReadError(known.message, [...confirmed], known.technical)
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    for (const client of this.clients) client.close()
    if (!this.clients.size) return
    await new Promise<void>((resolve) => this.idleResolvers.push(resolve))
  }

  async fetchDetail(accountId: string, uid: number, expectedUidValidity: string): Promise<{ textBody: string | null; htmlBody: string | null; recipients: string[]; attachments: Array<AttachmentInfo & { content: Buffer }> }> {
    return this.withAccount(accountId, async (client) => {
      const lock = await client.getMailboxLock('INBOX', { readOnly: true })
      try {
        if (!client.mailbox || String(client.mailbox.uidValidity) !== expectedUidValidity) throw new MailServiceError('UIDVALIDITY_CHANGED', '邮箱索引已变化，请先重新同步')
        const message = await client.fetchOne(uid, { uid: true, source: true }, { uid: true })
        if (!message) throw new MailServiceError('MAIL_NOT_FOUND', '服务器上已找不到这封邮件，可能已被移动或删除')
        const source = message.source
        if (!source) throw new MailServiceError('MAIL_NOT_FOUND', '服务器上已找不到这封邮件，可能已被移动或删除')
        if (source.length > 25 * 1024 * 1024) throw new MailServiceError('MAIL_TOO_LARGE', '邮件内容超过 25 MB，暂不支持在应用内加载')
        const parsed = await simpleParser(source)
        const files = parsed.attachments.map((item, index) => ({ id: String(index), filename: item.filename || `附件-${index + 1}`, contentType: item.contentType, size: item.size, contentId: item.cid || null, content: item.content }))
        return { textBody: parsed.text || null, htmlBody: typeof parsed.html === 'string' ? parsed.html : null, recipients: addresses(parsed.to), attachments: files }
      } finally { lock.release() }
    })
  }
}
