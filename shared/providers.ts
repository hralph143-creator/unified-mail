import type { Provider } from './types'

export const PROVIDERS: Record<Provider, { label: string; host: string; port: number; secure: boolean; domains: string[] }> = {
  qq: { label: 'QQ 邮箱', host: 'imap.qq.com', port: 993, secure: true, domains: ['qq.com'] },
  '163': { label: '网易 163 邮箱', host: 'imap.163.com', port: 993, secure: true, domains: ['163.com'] },
  '126': { label: '网易 126 邮箱', host: 'imap.126.com', port: 993, secure: true, domains: ['126.com'] },
  custom: { label: '其他 IMAP', host: '', port: 993, secure: true, domains: [] }
}

export function inferProvider(email: string): Provider {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  return (Object.entries(PROVIDERS).find(([, value]) => value.domains.includes(domain))?.[0] as Provider | undefined) ?? 'custom'
}
