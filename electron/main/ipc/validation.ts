import type { AccountInput, AppSettings, MailQuery, SyncTrigger } from '../../../shared/types'
import { PROVIDERS } from '../../../shared/providers'

export function parseText(value: unknown, name: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name}格式不正确`)
  return value.trim()
}

export function parseId(value: unknown): string {
  return parseText(value, '标识', 100)
}

export function parseAccountInput(raw: unknown): AccountInput {
  if (!raw || typeof raw !== 'object') throw new Error('账户信息格式不正确')
  const value = raw as Record<string, unknown>
  const provider = value.provider
  if (typeof provider !== 'string' || !(provider in PROVIDERS)) throw new Error('邮箱服务商无效')
  const email = parseText(value.email, '邮箱地址', 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请输入有效的完整邮箱地址')
  const port = Number(value.imapPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('IMAP 端口无效')
  return {
    id: typeof value.id === 'string' ? value.id : undefined,
    email,
    provider: provider as AccountInput['provider'],
    displayName: typeof value.displayName === 'string' ? value.displayName.slice(0, 100) : '',
    imapHost: parseText(value.imapHost, 'IMAP 服务器', 253),
    imapPort: port,
    imapSecure: value.imapSecure !== false,
    authorizationCode: parseText(value.authorizationCode, '客户端授权码', 500)
  }
}

export function parseMailQuery(raw: unknown): MailQuery {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<MailQuery>
  return {
    page: Math.max(1, Number(value.page) || 1),
    pageSize: Math.min(100, Math.max(10, Number(value.pageSize) || 50)),
    sort: value.sort === 'asc' ? 'asc' : 'desc',
    accountId: typeof value.accountId === 'string' ? value.accountId : undefined,
    provider: typeof value.provider === 'string' && value.provider in PROVIDERS ? value.provider as MailQuery['provider'] : undefined,
    search: typeof value.search === 'string' ? value.search.slice(0, 200) : undefined
  }
}

export function parseSettingsPatch(raw: unknown): Partial<AppSettings> {
  const patch = (raw && typeof raw === 'object' ? { ...raw } : {}) as Partial<AppSettings>
  if (patch.syncIntervalMinutes !== undefined) patch.syncIntervalMinutes = Math.min(10080, Math.max(15, Number(patch.syncIntervalMinutes) || 360))
  if (patch.pageSize !== undefined) patch.pageSize = Math.min(100, Math.max(10, Number(patch.pageSize) || 50))
  return patch
}

export function parseSyncTrigger(raw: unknown): SyncTrigger {
  return raw === 'startup' || raw === 'scheduled' || raw === 'account' || raw === 'manual' ? raw : 'manual'
}

export function parseLimit(raw: unknown, fallback = 50): number {
  return Math.min(200, Math.max(1, Number(raw) || fallback))
}

export function parseExternalUrl(raw: unknown): URL {
  const url = new URL(parseText(raw, '链接', 2048))
  if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('已阻止不安全的链接')
  return url
}
