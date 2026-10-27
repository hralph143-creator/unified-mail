import { describe, expect, it } from 'vitest'
import { parseAccountInput, parseBoolean, parseExternalUrl, parseMailQuery, parseMailScope, parseSettingsPatch, parseSyncTrigger } from '../electron/main/ipc/validation'

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
    expect(() => parseAccountInput({ provider: 'qq', email: 'a@qq.com', imapHost: 'imap.qq.com', imapPort: 993, authorizationCode: 'secret', imapSecure: 'false' })).toThrow('TLS 设置格式不正确')
    expect(() => parseAccountInput({ provider: 'qq', email: 'a@qq.com', imapHost: 'imap.qq.com', imapPort: 993, authorizationCode: 'secret', password: 'unexpected' })).toThrow('账户信息包含未知字段')
  })

  it('限制邮件查询和设置的数值范围', () => {
    expect(parseMailQuery({ page: -2, pageSize: 999, sort: 'invalid' })).toMatchObject({ page: 1, pageSize: 100, sort: 'desc', provider: undefined })
    expect(() => parseMailQuery({ provider: 'unknown' })).toThrow('邮箱服务商无效')
    expect(() => parseMailQuery({ page: 1, pageSize: 50, debug: true })).toThrow('邮件查询包含未知字段')
    expect(parseSettingsPatch({ syncIntervalMinutes: 1, pageSize: 999 })).toMatchObject({ syncIntervalMinutes: 15, pageSize: 100 })
  })

  it('严格校验布尔设置并拒绝未知设置项', () => {
    expect(parseBoolean(false, '启用状态')).toBe(false)
    expect(() => parseBoolean('false', '启用状态')).toThrow('启用状态格式不正确')
    expect(parseSettingsPatch({ autoSyncEnabled: false, defaultAccountScope: 'account-1' })).toEqual({ autoSyncEnabled: false, defaultAccountScope: 'account-1' })
    expect(() => parseSettingsPatch({ notificationsEnabled: 'yes' })).toThrow('notificationsEnabled格式不正确')
    expect(() => parseSettingsPatch({ unknown: true })).toThrow('包含未知设置项')
  })

  it('严格校验一键已读的账户范围', () => {
    expect(parseMailScope({ accountId: 'account-1', provider: 'qq' })).toEqual({ accountId: 'account-1', provider: 'qq' })
    expect(parseMailScope({})).toEqual({ accountId: undefined, provider: undefined })
    expect(() => parseMailScope({ search: '不允许' })).toThrow('邮件范围包含未知字段')
    expect(() => parseMailScope({ provider: 'unknown' })).toThrow('邮箱服务商无效')
  })

  it('只接受已声明的同步触发器和外部链接协议', () => {
    expect(parseSyncTrigger('scheduled')).toBe('scheduled')
    expect(parseSyncTrigger(undefined)).toBe('manual')
    expect(() => parseSyncTrigger('unexpected')).toThrow('同步触发器无效')
    expect(parseExternalUrl('https://example.com').protocol).toBe('https:')
    expect(() => parseExternalUrl('file:///C:/secret.txt')).toThrow('已阻止不安全的链接')
    expect(() => parseExternalUrl('https://user:secret@example.com')).toThrow('已阻止包含凭据的链接')
  })
})
