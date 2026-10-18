import pino from 'pino'
import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, renameSync, statSync, unlinkSync } from 'node:fs'

const redact = ['authorizationCode', 'password', 'auth.pass', 'source', 'textBody', 'htmlBody', 'content']

export function createLogger() {
  const destination = join(app.getPath('logs'), 'unified-mail.log')
  if (existsSync(destination) && statSync(destination).size >= 5 * 1024 * 1024) {
    const oldest = `${destination}.7`
    if (existsSync(oldest)) unlinkSync(oldest)
    for (let index = 6; index >= 1; index--) {
      const source = `${destination}.${index}`
      if (existsSync(source)) renameSync(source, `${destination}.${index + 1}`)
    }
    renameSync(destination, `${destination}.1`)
  }
  return pino({ level: process.env.NODE_ENV === 'development' ? 'debug' : 'info', redact }, pino.destination({ dest: destination, sync: false, mkdir: true }))
}

export type AppLogger = ReturnType<typeof createLogger>
