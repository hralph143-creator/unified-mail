import { BrowserWindow, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { MailService } from '../services/mails'
import type { RegisterHandler } from './contracts'
import { parseId, parseMailQuery } from './validation'

async function saveAttachment(mails: MailService, rawMailId: unknown, rawAttachmentId: unknown): Promise<string | null> {
  const item = await mails.attachment(parseId(rawMailId), parseId(rawAttachmentId))
  const window = BrowserWindow.getFocusedWindow() ?? undefined
  const options = { title: '保存附件', defaultPath: item.filename }
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  await writeFile(result.filePath, item.content, { flag: 'wx' }).catch(async (error: unknown) => {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
    if (code !== 'EEXIST') throw error
    const boxOptions = { type: 'question' as const, buttons: ['取消', '覆盖'], defaultId: 0, cancelId: 0, message: '文件已存在，是否覆盖？' }
    const overwrite = window ? await dialog.showMessageBox(window, boxOptions) : await dialog.showMessageBox(boxOptions)
    if (overwrite.response === 1) await writeFile(result.filePath!, item.content)
  })
  return result.filePath
}

export function registerMailHandlers(register: RegisterHandler, mails: MailService): void {
  register('mails:list', (raw) => mails.list(parseMailQuery(raw)))
  register('mails:detail', (rawId) => mails.detail(parseId(rawId)))
  register('mails:mark-read', (rawId) => mails.markRead(parseId(rawId)))
  register('mails:download-attachment', (rawMailId, rawAttachmentId) => saveAttachment(mails, rawMailId, rawAttachmentId))
}
