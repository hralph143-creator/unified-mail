import { describe, expect, it } from 'vitest'
import { parseAccountInput, parseExternalUrl, parseMailQuery, parseSettingsPatch, parseSyncTrigger } from '../electron/main/ipc/validation'

describe('IPC 输入校验', () => {
  it('规范化账户输入并保留安全默认值', () => {
    expect(parseAccountInput({
      email: ' User@QQ.COM ',
      provider: 'qq',
      displayName: '个人邮箱',
      imapHost: ' imap.qq.com ',
      imapPort: '993',
      authorizationCode: ' secret '
    })).toMatchObject({
      email: 'user@qq.com',
      provider: 'qq',
      imapHost: 'imap.qq.com',
      imapPort: 993,
      imapSecure: true,
      authorizationCode: 'secret'
    })
  })

  it('拒绝未知服务商和非邮件地址', () => {
    expect(() => parseAccountInput({ provider: 'unknown' })).toThrow('邮箱服务商无效')
    expect(() => parseAccountInput({ provider: 'qq', email: 'invalid', imapHost: 'imap.qq.com', imapPort: 993, authorizationCode: 'secret' })).toThrow('请输入有效的完整邮箱地址')
  })

  it('限制邮件查询和设置的数值范围', () => {
    expect(parseMailQuery({ page: -2, pageSize: 999, sort: 'invalid', provider: 'unknown' })).toMatchObject({ page: 1, pageSize: 100, sort: 'desc', provider: undefined })
    expect(parseSettingsPatch({ syncIntervalMinutes: 1, pageSize: 999 })).toMatchObject({ syncIntervalMinutes: 15, pageSize: 100 })
  })

  it('只接受已声明的同步触发器和外部链接协议', () => {
    expect(parseSyncTrigger('scheduled')).toBe('scheduled')
    expect(parseSyncTrigger('unexpected')).toBe('manual')
    expect(parseExternalUrl('https://example.com').protocol).toBe('https:')
    expect(() => parseExternalUrl('file:///C:/secret.txt')).toThrow('已阻止不安全的链接')
  })
})
