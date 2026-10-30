import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const executable = process.env.UNIFIEDMAIL_SMOKE_EXECUTABLE || join(root, 'release-delivery', 'win-unpacked', '多邮箱统一管理与双向同步系统.exe')
if (!existsSync(executable)) throw new Error('未找到解包版程序，请先运行 pnpm package:win')

const userData = mkdtempSync(join(tmpdir(), 'unified-mail-packaged-'))
const port = 9335
const processHandle = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], {
  cwd: dirname(executable), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
})
let startupOutput = ''
for (const stream of [processHandle.stdout, processHandle.stderr]) {
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => { startupOutput = (startupOutput + chunk).slice(-4000) })
}

class CdpClient {
  constructor(url) {
    this.nextId = 1
    this.pending = new Map()
    this.socket = new WebSocket(url)
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const callback = this.pending.get(message.id)
      if (callback) { this.pending.delete(message.id); callback(message) }
    }
  }
  async connect() {
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result))
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  close() { this.socket.close() }
}

async function waitForPage() {
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const page = pages.find((item) => item.type === 'page')
      if (page) return page
    } catch { /* 应用仍在启动。 */ }
    if (processHandle.exitCode !== null) throw new Error(`解包版提前退出（${processHandle.exitCode}）：${startupOutput.trim() || '无启动日志'}`)
  }
  throw new Error(`解包版未在规定时间内启动：${startupOutput.trim() || '无启动日志'}`)
}

try {
  const page = await waitForPage()
  const cdp = new CdpClient(page.webSocketDebuggerUrl)
  await cdp.connect()
  let result
  for (let attempt = 0; attempt < 30; attempt++) {
    result = await cdp.send('Runtime.evaluate', {
      expression: `({
        ready: document.readyState === 'complete' && Boolean(document.querySelector('.app-shell')),
        preload: Boolean(window.unifiedMail?.settings?.get),
        title: document.title,
        fullHeight: Math.abs(document.querySelector('.app-shell')?.getBoundingClientRect().height - innerHeight) <= 1
      })`, returnByValue: true
    })
    if (result.result.value.ready) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const value = result?.result.value
  if (!value?.ready || !value.preload || !value.fullHeight) throw new Error(`解包版界面校验失败：${JSON.stringify(value)}`)
  const database = join(userData, 'data', 'unified-mail.db')
  if (!existsSync(database)) throw new Error('首次启动未创建本地数据库')
  cdp.close()
  console.log(JSON.stringify({ executable, title: value.title, databaseInitialized: true, isolatedUserData: userData }, null, 2))
} finally {
  if (processHandle.exitCode === null) {
    processHandle.kill()
    await Promise.race([once(processHandle, 'exit'), new Promise((resolve) => setTimeout(resolve, 3_000))])
  }
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
