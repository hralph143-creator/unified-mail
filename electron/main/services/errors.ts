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
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const raw = error instanceof Error ? error.message : String(error)
  const code = typeof details.code === 'string' ? details.code : ''
  const serverCode = typeof details.serverResponseCode === 'string' ? details.serverResponseCode : ''
  const lower = `${raw} ${code} ${serverCode}`.toLowerCase()
  // Server text is used only for classification. It may contain echoed credentials
  // or mailbox contents, so never retain it in errors that reach logs or the UI.
  if (lower.includes('ethrottle') || lower.includes('rate limit') || lower.includes('too many') || lower.includes('temporarily blocked')) return new MailServiceError('RATE_LIMITED', '邮箱服务商暂时限制了连接，请降低同步频率并稍后重试')
  if (lower.includes('certificate') || lower.includes('tls') || lower.includes('ssl') || lower.includes('self_signed_cert')) return new MailServiceError('TLS_FAILED', '无法验证邮箱服务器的安全证书，请检查系统时间、代理和服务器设置')
  if (lower.includes('etimedout') || lower.includes('timeout') || lower.includes('timed out')) return new MailServiceError('TIMEOUT', '连接邮箱服务器超时，请检查网络后稍后重试')
  if (lower.includes('enotfound') || lower.includes('eai_again') || lower.includes('getaddrinfo')) return new MailServiceError('DNS_FAILED', '无法解析邮箱服务器地址，请检查网络或服务器配置')
  if (lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('econnaborted') || lower.includes('enetunreach') || lower.includes('network') || lower.includes('socket closed')) return new MailServiceError('NETWORK_FAILED', '无法连接邮箱服务器，请检查网络和 IMAP 设置后重试')
  if (details.authenticationFailed === true || lower.includes('auth') || lower.includes('login') || lower.includes('credential')) return new MailServiceError('AUTH_FAILED', '邮箱验证失败，请检查 IMAP 服务是否开启，以及填写的授权码是否正确')
  return new MailServiceError('IMAP_FAILED', '邮箱服务器操作失败，请检查账户设置后重试')
}
