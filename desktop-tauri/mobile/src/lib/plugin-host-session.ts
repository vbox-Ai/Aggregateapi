/**
 * 插件宿主的 Worker 引导与客户端会话（阶段 0 · 第 2 项）。
 *
 * 与 `plugin-host.ts` 的分工：那边负责「把宿主与插件的 .mjs 变成可 import 的 URL 并改写
 * 说明符 + 提供 node:* 的最小实现」；这里负责「在 Worker 里把宿主跑起来、接上传输层、
 * 按 init → login.start → login.poll 驱动」。
 *
 * ── 两个刻意的设计 ────────────────────────────────────────────
 * 1) 每支插件一个 Worker：插件会在全局装东西（fetch/http2/websocket/console），
 *    同引擎多支会互相覆盖。一支一个上下文是隔离的最小代价。
 * 2) 传输层是一个窄接口（send/onLine/onClose），不写死 WebSocket：
 *    真机走网关的 WS 桥，本机测试可以喂一个假对端 —— 协议是同一份。
 */
import { buildModuleUrls, type HostFile, type HostTransport } from './plugin-host'

export type PluginHostSession = {
  /** 发起帧调用（init / login.start / …），解析为宿主给的 result 或抛错 */
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>
  /** 宿主主动推来的事件（startup / log / 登录进度等） */
  onEvent: (handler: (event: { event: string; params: unknown }) => void) => void
  /** 宿主反过来请求对端的方法（script.http.* / store.* 等）—— 由调用方转给网关 */
  onRequest: (handler: (method: string, params: Record<string, unknown>, id: number) => void) => void
  /** 把对端的响应回给宿主 */
  reply: (id: number, payload: { result?: unknown; error?: { code: string; message: string } }) => void
  /** 关闭并回收 Worker */
  close: () => void
}

/** Worker 引导脚本：注入 process/Buffer/Bun 与模块表，然后 import 宿主入口 */
function bootstrapSource(hostEntryKey: string): string {
  return `
// 模块表必须在 import 宿主之前就位，而 Worker 的构造参数只能带 URL。
// 所以这里先等一条 bootstrap 消息再继续 —— 否则会与 postMessage 竞态。
const bootstrap = await new Promise(resolve => {
  self.addEventListener('message', event => {
    if (event.data && event.data.kind === 'bootstrap') resolve(event.data)
  })
})
const moduleUrls = new Map(Object.entries(bootstrap.moduleUrls || {}))
const files = new Map(Object.entries(bootstrap.files || {}))
globalThis.__hostModuleUrls = moduleUrls
globalThis.__hostFiles = files

// ── process：宿主只用 stdout.write（发帧）与 stdin 的异步迭代（收帧）。──
// 真实 Bun/Node 的 stdin 产出 Buffer；这里产出 Uint8Array 即可（wire.mjs 只做
// 分帧与 JSON.parse）。
const inbound = []
const waiters = []
let closed = false
function pushLine(text) {
  const bytes = new TextEncoder().encode(text)
  if (waiters.length) waiters.shift()({ value: bytes, done: false })
  else inbound.push(bytes)
}
function endInbound() {
  closed = true
  while (waiters.length) waiters.shift()({ value: undefined, done: true })
}
self.__pushLine = pushLine
self.__endInbound = endInbound

globalThis.process = {
  env: {}, platform: 'ios', argv: ['host'], version: '0',
  exit() {}, on() {}, once() {}, off() {}, cwd: () => '/',
  stdout: { write(text) { self.postMessage({ kind: 'out', text: String(text) }); return true } },
  stderr: { write(text) { self.postMessage({ kind: 'err', text: String(text) }); return true } },
  stdin: {
    on() {},
    [Symbol.asyncIterator]() {
      return { next: () => new Promise(resolve => {
        if (inbound.length) resolve({ value: inbound.shift(), done: false })
        else if (closed) resolve({ value: undefined, done: true })
        else waiters.push(resolve)
      }) }
    },
  },
}

// ── Buffer：宿主用它算字节长度、base64 编解码。──
const toBase64 = bytes => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
const fromBase64 = text => Uint8Array.from(atob(String(text)), c => c.charCodeAt(0))
globalThis.Buffer = {
  byteLength: value => new TextEncoder().encode(String(value)).length,
  from(value, encoding) {
    if (encoding === 'base64') return fromBase64(value)
    return new TextEncoder().encode(String(value))
  },
  alloc(size) { return new Uint8Array(size) },
  concat(list) {
    const total = list.reduce((sum, item) => sum + item.length, 0)
    const out = new Uint8Array(total)
    let at = 0
    for (const item of list) { out.set(item, at); at += item.length }
    return out
  },
}

// ── Bun 空壳：真用到本机进程能力才失败，不静默假装支持。──
globalThis.Bun ??= new Proxy({}, {
  get(_target, name) {
    if (name === 'version') return 'stub'
    return () => { throw new Error('Bun.' + String(name) + ' is unavailable in this runtime') }
  },
})

self.addEventListener('message', event => {
  const data = event.data || {}
  if (data.kind === 'line') pushLine(data.text)
  else if (data.kind === 'close') endInbound()
})

try {
  const entry = moduleUrls.get(${JSON.stringify(hostEntryKey)})
  if (!entry) throw new Error('宿主入口未注册: ' + ${JSON.stringify(hostEntryKey)})
  await import(entry)
} catch (error) {
  self.postMessage({ kind: 'boot-failed', message: String(error?.stack || error) })
}
`
}

/**
 * 启动一个插件宿主会话。
 *
 * `hostFiles` 是网关侧的宿主源码（`plugin_host/script/host/*.mjs`，由网关提供，
 * 保证与网关版本一致）；`pluginFiles` 是插件包内文件（package.json + 入口 + 依赖）。
 */
export async function startPluginHost(options: {
  hostFiles: HostFile[]
  pluginFiles: HostFile[]
  transport: HostTransport
}): Promise<PluginHostSession> {
  const hostEntryKey = 'main.mjs'
  const urls = buildModuleUrls(
    [...options.hostFiles, ...options.pluginFiles.map(file => ({ path: `packages/${file.path}`, text: file.text }))],
    '',
  )
  const table: Record<string, string> = {}
  for (const [key, url] of urls) table[key] = url
  const files: Record<string, string> = {}
  for (const file of [...options.hostFiles, ...options.pluginFiles.map(f => ({ path: `packages/${f.path}`, text: f.text }))]) {
    files[file.path] = file.text
  }

  const worker = new Worker(URL.createObjectURL(new Blob([bootstrapSource(hostEntryKey)], { type: 'text/javascript' })), {
    type: 'module',
  })
  // 一条 bootstrap：把模块表与文件表送进去，引导脚本收到后才 import 宿主
  worker.postMessage({ kind: 'bootstrap', moduleUrls: table, files })

  let nextId = 1
  const pending = new Map<number, (value: unknown) => void>()
  const eventHandlers: Array<(event: { event: string; params: unknown }) => void> = []
  const requestHandlers: Array<(method: string, params: Record<string, unknown>, id: number) => void> = []
  let bootFailure: Error | null = null

  worker.addEventListener('message', event => {
    const data = event.data || {}
    if (data.kind === 'out') {
      for (const line of String(data.text).split('\n')) {
        if (!line.trim()) continue
        let frame: Record<string, unknown>
        try { frame = JSON.parse(line) } catch { continue }
        if (frame.method) {
          for (const handler of requestHandlers) handler(String(frame.method), (frame.params || {}) as Record<string, unknown>, Number(frame.id))
        } else if (frame.event) {
          for (const handler of eventHandlers) handler({ event: String(frame.event), params: frame.params })
        } else if (typeof frame.id === 'number' && pending.has(frame.id)) {
          const resolve = pending.get(frame.id) as (value: unknown) => void
          pending.delete(frame.id)
          resolve(frame)
        }
      }
      return
    }
    if (data.kind === 'boot-failed') {
      // 事件回调里 throw 不会让任何 promise 失败，所以先记下来，由下一次 call 抛出
      bootFailure = new Error(`插件宿主启动失败：${data.message}`)
      return
    }
  })

  options.transport.onLine(line => worker.postMessage({ kind: 'line', text: line }))
  options.transport.onClose(() => worker.postMessage({ kind: 'close' }))

  return {
    call(method, params) {
      if (bootFailure) return Promise.reject(bootFailure)
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, value => {
          const frame = value as { result?: unknown; error?: { message?: string } }
          if (frame.error) reject(new Error(frame.error.message || '插件宿主返回错误'))
          else resolve(frame.result)
        })
        options.transport.send(JSON.stringify({ id, method, params }))
      })
    },
    onEvent(handler) { eventHandlers.push(handler) },
    onRequest(handler) { requestHandlers.push(handler) },
    reply(id, payload) { options.transport.send(JSON.stringify({ id, ...payload })) },
    close() { worker.terminate() },
  }
}
