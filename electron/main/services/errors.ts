export class MailServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly technical?: string) { super(message) }
}

export class PartialMarkReadError extends MailServiceError {
  constructor(message: string, public readonly confirmedUids: number[], technical?: string) {
    super('WRITE_PARTIAL', message, technical)
  }
}

export function classifyImapError(error: unknown): MailServiceError {
  if (error instanceof MailServiceError) return error
  const raw = error instanceof Error ? error.message : String(error)
  const lower = raw.toLowerCase()
  if (lower.includes('auth') || lower.includes('login') || lower.includes('credential')) return new MailServiceError('AUTH_FAILED', '授权码错误、已失效，或 IMAP 服务尚未开启', raw)
  if (lower.includes('certificate') || lower.includes('tls') || lower.includes('ssl')) return new MailServiceError('TLS_FAILED', '无法验证邮箱服务器的安全证书', raw)
  if (lower.includes('timeout') || lower.includes('timed out')) return new MailServiceError('TIMEOUT', '连接邮箱服务器超时，请稍后重试', raw)
  if (lower.includes('enotfound') || lower.includes('getaddrinfo')) return new MailServiceError('DNS_FAILED', '无法解析邮箱服务器地址，请检查网络或服务器配置', raw)
  if (lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('network')) return new MailServiceError('NETWORK_FAILED', '无法连接邮箱服务器，请检查网络和 IMAP 设置', raw)
  if (lower.includes('limit') || lower.includes('too many')) return new MailServiceError('RATE_LIMITED', '邮箱服务商暂时限制了连接，请稍后重试', raw)
  return new MailServiceError('IMAP_FAILED', '邮箱服务器操作失败，请检查账户设置后重试', raw)
}
