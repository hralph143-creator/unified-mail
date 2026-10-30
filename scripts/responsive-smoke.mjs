import { spawn } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const userData = mkdtempSync(join(tmpdir(), 'unified-mail-responsive-'))
const port = 9334
const processHandle = spawn(electronPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '.'], {
  cwd: root,
  env: { ...process.env, UNIFIEDMAIL_ALLOW_MULTIPLE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
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
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve
      this.socket.onerror = reject
    })
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
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json())
      const page = pages.find((item) => item.type === 'page')
      if (page) return page
    } catch { /* Electron 仍在启动。 */ }
    if (processHandle.exitCode !== null) throw new Error(`Electron 提前退出（${processHandle.exitCode}）：${startupOutput.trim() || '无启动日志'}`)
  }
  throw new Error(`Electron 页面未在规定时间内启动：${startupOutput.trim() || '无启动日志'}`)
}

function ensure(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  const page = await waitForPage()
  const cdp = new CdpClient(page.webSocketDebuggerUrl)
  await cdp.connect()
  let interfaceReady = false
  for (let attempt = 0; attempt < 30 && !interfaceReady; attempt++) {
    const ready = await cdp.send('Runtime.evaluate', { expression: `document.readyState === 'complete' && Boolean(document.querySelector('.inbox-layout'))`, returnByValue: true })
    interfaceReady = ready.result.value === true
    if (!interfaceReady) await new Promise((resolve) => setTimeout(resolve, 200))
  }
  ensure(interfaceReady, '应用界面未在规定时间内渲染完成')
  const customControlCheck = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const shell = document.querySelector('.app-shell')
      const controls = document.querySelector('.window-controls')
      const buttons = [...controls.querySelectorAll('button')]
      const before = buttons.map((button) => getComputedStyle(button).color + '|' + getComputedStyle(button).backgroundColor)
      shell.classList.add('modal-active')
      const pointerEvents = getComputedStyle(controls).pointerEvents
      const during = buttons.map((button) => getComputedStyle(button).color + '|' + getComputedStyle(button).backgroundColor)
      shell.classList.remove('modal-active')
      return { count: buttons.length, pointerEvents, unchanged: before.every((value, index) => value === during[index]) }
    })()`,
    returnByValue: true
  })
  ensure(customControlCheck.result.value.count === 3, '自绘窗口按钮数量不正确')
  ensure(customControlCheck.result.value.pointerEvents === 'none', '模态窗口出现时右上角按钮仍可点击')
  ensure(customControlCheck.result.value.unchanged, '模态窗口出现时右上角按钮发生变色')
  const lockedControls = await cdp.send('Runtime.evaluate', {
    expression: 'window.unifiedMail.appearance.setTourOverlay(true)',
    awaitPromise: true,
    returnByValue: true
  })
  ensure(Object.values(lockedControls.result.value).every((enabled) => enabled === false), '模态引导打开时窗口按钮仍可操作')
  const restoredControls = await cdp.send('Runtime.evaluate', {
    expression: 'window.unifiedMail.appearance.setTourOverlay(false)',
    awaitPromise: true,
    returnByValue: true
  })
  ensure(Object.values(restoredControls.result.value).every((enabled) => enabled === true), '模态引导关闭后窗口按钮未恢复')
  const sizes = [[720, 600], [860, 680], [900, 700], [1024, 768], [1080, 720], [1360, 840], [1920, 1080], [2560, 1440]]
  const results = []
  for (const [width, height] of sizes) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const shell = document.querySelector('.app-shell')
        const inbox = document.querySelector('.inbox-layout')
        const mail = document.querySelector('.mail-column')
        const detail = document.querySelector('.detail-column')
        let back = document.querySelector('.detail-back')
        const temporaryBack = !back
        if (!back) { back = document.createElement('button'); back.className = 'detail-back'; detail.append(back) }
        const sidebar = document.querySelector('.sidebar')
        const syncLabel = document.querySelector('.sync-button .n-button__content')
        const toolbar = document.querySelector('.mail-toolbar')
        const markAllButton = document.querySelector('.mark-all-button')
        const snapshot = () => ({
          viewport: [innerWidth, innerHeight],
          rootFits: document.documentElement.scrollWidth <= innerWidth,
          shellFits: shell.scrollWidth <= shell.clientWidth,
          shellHeight: Math.round(shell.getBoundingClientRect().height),
          mailDisplay: getComputedStyle(mail).display,
          detailDisplay: getComputedStyle(detail).display,
          backDisplay: getComputedStyle(back).display,
          sidebarWidth: Math.round(sidebar.getBoundingClientRect().width),
          mailWidth: Math.round(mail.getBoundingClientRect().width),
          detailWidth: Math.round(detail.getBoundingClientRect().width),
          syncLabelColor: getComputedStyle(syncLabel).color,
          toolbarFits: toolbar.scrollWidth <= toolbar.clientWidth,
          markAllWidth: Math.round(markAllButton.getBoundingClientRect().width)
        })
        const normal = snapshot()
        inbox.classList.add('show-detail')
        const selected = snapshot()
        inbox.classList.remove('show-detail')
        if (temporaryBack) back.remove()
        return { normal, selected }
      })()`,
      returnByValue: true
    })
    if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.exception?.description ?? JSON.stringify(evaluated.exceptionDetails))
    const value = evaluated.result.value
    ensure(value.normal.rootFits && value.normal.shellFits, `${width}x${height} 出现横向溢出`)
    ensure(Math.abs(value.normal.shellHeight - height) <= 1, `${width}x${height} 主界面没有铺满窗口，底部出现空白`)
    ensure(value.normal.syncLabelColor === 'rgb(255, 255, 255)', `${width}x${height} “立即同步”文字对比度不足`)
    ensure(value.normal.toolbarFits && value.normal.markAllWidth >= 70, `${width}x${height} “一键已读”按钮显示不完整`)
    ensure(value.normal.sidebarWidth > 0 && value.normal.sidebarWidth < width * 0.4, `${width}x${height} 侧栏宽度异常`)
    if (width <= 860) {
      ensure(value.normal.detailDisplay === 'none', `${width}x${height} 窄屏应默认隐藏详情`)
      ensure(value.selected.mailDisplay === 'none' && value.selected.detailDisplay !== 'none', `${width}x${height} 窄屏详情切换失败`)
      ensure(value.selected.backDisplay !== 'none', `${width}x${height} 窄屏缺少返回按钮`)
    } else {
      ensure(value.normal.mailDisplay !== 'none' && value.normal.detailDisplay !== 'none', `${width}x${height} 宽屏双栏未同时显示`)
      ensure(value.normal.backDisplay === 'none', `${width}x${height} 宽屏不应显示返回按钮`)
      ensure(value.normal.mailWidth >= 340 && value.normal.detailWidth >= 300, `${width}x${height} 双栏可用宽度不足`)
    }
    results.push({ size: `${width}x${height}`, sidebar: value.normal.sidebarWidth, mail: value.normal.mailWidth, detail: value.normal.detailWidth, mode: width <= 860 ? 'single-pane' : 'split-pane' })
    if (process.env.RESPONSIVE_SCREENSHOT_PATH && width === 2560) {
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      writeFileSync(process.env.RESPONSIVE_SCREENSHOT_PATH, Buffer.from(screenshot.data, 'base64'))
    }
  }
  const dpiResults = []
  for (const deviceScaleFactor of [1, 1.25, 1.5, 2]) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 840, deviceScaleFactor, mobile: false })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: `(() => ({
        devicePixelRatio,
        rootFits: document.documentElement.scrollWidth <= innerWidth,
        shellHeight: Math.round(document.querySelector('.app-shell').getBoundingClientRect().height),
        toolbarFits: document.querySelector('.mail-toolbar').scrollWidth <= document.querySelector('.mail-toolbar').clientWidth,
        syncLabelColor: getComputedStyle(document.querySelector('.sync-button .n-button__content')).color
      }))()`,
      returnByValue: true
    })
    const value = evaluated.result.value
    ensure(Math.abs(value.devicePixelRatio - deviceScaleFactor) < 0.01, `${deviceScaleFactor * 100}% DPI 模拟比例不正确（实际 ${value.devicePixelRatio}）`)
    ensure(value.rootFits && value.toolbarFits, `${deviceScaleFactor * 100}% DPI 模拟出现内容溢出`)
    ensure(Math.abs(value.shellHeight - 840) <= 1, `${deviceScaleFactor * 100}% DPI 模拟主界面未铺满窗口`)
    ensure(value.syncLabelColor === 'rgb(255, 255, 255)', `${deviceScaleFactor * 100}% DPI 模拟“立即同步”文字对比度不足`)
    dpiResults.push(`${deviceScaleFactor * 100}%`)
  }
  cdp.close()
  console.log(JSON.stringify({ layout: results, dpiSimulation: dpiResults }, null, 2))
} finally {
  if (processHandle.exitCode === null) {
    processHandle.kill()
    await Promise.race([once(processHandle, 'exit'), new Promise((resolve) => setTimeout(resolve, 3_000))])
  }
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
