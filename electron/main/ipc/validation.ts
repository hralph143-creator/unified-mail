import type { AccountInput, AppSettings, MailQuery, MailScope, SyncTrigger } from '../../../shared/types'
import { PROVIDERS } from '../../../shared/providers'

export function parseText(value: unknown, name: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name}格式不正确`)
  return value.trim()
}

export function parseId(value: unknown): string {
  return parseText(value, '标识', 100)
}

export function parseBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name}格式不正确`)
  return value
}

export function parseAccountInput(raw: unknown): AccountInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('账户信息格式不正确')
  const value = raw as Record<string, unknown>
  const allowed = new Set(['id', 'email', 'provider', 'displayName', 'imapHost', 'imapPort', 'imapSecure', 'authorizationCode'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error('账户信息包含未知字段')
  const provider = value.provider
  if (typeof provider !== 'string' || !(provider in PROVIDERS)) throw new Error('邮箱服务商无效')
  const email = parseText(value.email, '邮箱地址', 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('请输入有效的完整邮箱地址')
  const port = Number(value.imapPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('IMAP 端口无效')
  const requestedSecure = value.imapSecure === undefined ? true : parseBoolean(value.imapSecure, 'TLS 设置')
  const preset = PROVIDERS[provider as AccountInput['provider']]
  const custom = provider === 'custom'
  return {
    id: value.id === undefined ? undefined : parseId(value.id),
    email,
    provider: provider as AccountInput['provider'],
    displayName: typeof value.displayName === 'string' ? value.displayName.slice(0, 100) : '',
    imapHost: custom ? parseText(value.imapHost, 'IMAP 服务器', 253) : preset.host,
    imapPort: custom ? port : preset.port,
    imapSecure: custom ? requestedSecure : preset.secure,
    authorizationCode: parseText(value.authorizationCode, '客户端授权码', 500)
  }
}

export function parseMailQuery(raw: unknown): MailQuery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('邮件查询格式不正确')
  const value = raw as Record<string, unknown>
  const allowed = new Set(['accountId', 'provider', 'search', 'page', 'pageSize', 'sort'])
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error('邮件查询包含未知字段')
  if (value.provider !== undefined && (typeof value.provider !== 'string' || !(value.provider in PROVIDERS))) throw new Error('邮箱服务商无效')
  return {
    page: Math.max(1, Number(value.page) || 1),
    pageSize: Math.min(100, Math.max(10, Number(value.pageSize) || 50)),
    sort: value.sort === 'asc' ? 'asc' : 'desc',
    accountId: value.accountId === undefined ? undefined : parseId(value.accountId),
    provider: value.provider as MailQuery['provider'],
    search: typeof value.search === 'string' ? value.search.slice(0, 200) : undefined
  }
}

export function parseMailScope(raw: unknown): MailScope {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('邮件范围格式不正确')
  const value = raw as Record<string, unknown>
  for (const key of Object.keys(value)) if (key !== 'accountId' && key !== 'provider') throw new Error('邮件范围包含未知字段')
  const provider = value.provider
  if (provider !== undefined && (typeof provider !== 'string' || !(provider in PROVIDERS))) throw new Error('邮箱服务商无效')
  return {
    accountId: value.accountId === undefined ? undefined : parseId(value.accountId),
    provider: provider as MailScope['provider']
  }
}

export function parseSettingsPatch(raw: unknown): Partial<AppSettings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('设置格式不正确')
  const value = raw as Record<string, unknown>
  const allowed = new Set<keyof AppSettings>(['autoSyncEnabled', 'syncIntervalMinutes', 'launchAtLogin', 'minimizeToTray', 'notificationsEnabled', 'pageSize', 'defaultAccountScope', 'tutorialCompleted'])
  for (const key of Object.keys(value)) if (!allowed.has(key as keyof AppSettings)) throw new Error('包含未知设置项')
  const patch: Partial<AppSettings> = {}
  for (const key of ['autoSyncEnabled', 'launchAtLogin', 'minimizeToTray', 'notificationsEnabled', 'tutorialCompleted'] as const) {
    if (value[key] !== undefined) patch[key] = parseBoolean(value[key], key)
  }
  if (value.syncIntervalMinutes !== undefined) {
    if (!Number.isInteger(value.syncIntervalMinutes)) throw new Error('同步间隔格式不正确')
    patch.syncIntervalMinutes = Math.min(10080, Math.max(15, value.syncIntervalMinutes as number))
  }
  if (value.pageSize !== undefined) {
    if (!Number.isInteger(value.pageSize)) throw new Error('每页数量格式不正确')
    patch.pageSize = Math.min(100, Math.max(10, value.pageSize as number))
  }
  if (value.defaultAccountScope !== undefined) patch.defaultAccountScope = parseText(value.defaultAccountScope, '默认收件箱', 100)
  return patch
}

export function parseSyncTrigger(raw: unknown): SyncTrigger {
  if (raw === undefined) return 'manual'
  if (raw === 'startup' || raw === 'scheduled' || raw === 'account' || raw === 'manual') return raw
  throw new Error('同步触发器无效')
}

export function parseLimit(raw: unknown, fallback = 50): number {
  if (raw === undefined) return fallback
  if (!Number.isInteger(raw)) throw new Error('数量限制格式不正确')
  return Math.min(200, Math.max(1, raw as number))
}

export function parseExternalUrl(raw: unknown): URL {
  const url = new URL(parseText(raw, '链接', 2048))
  if (!['https:', 'http:', 'mailto:'].includes(url.protocol)) throw new Error('已阻止不安全的链接')
  if (url.username || url.password) throw new Error('已阻止包含凭据的链接')
  return url
}
