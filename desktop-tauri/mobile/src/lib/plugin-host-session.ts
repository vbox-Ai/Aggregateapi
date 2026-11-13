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
  /** 最近一条「取插件文件 / 宿主退出」相关的提示（没有就是空串） */
  notice: () => string
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
  exit(code) { self.postMessage({ kind: 'exit', code: Number(code) || 0 }) },
  on() {}, once() {}, off() {}, cwd: () => '/',
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

// ── Buffer：宿主用它分帧（concat / indexOf / toString）、算长度、base64 编解码。──
// 必须是 Uint8Array 的**子类**：wire.mjs 收帧时调 line.toString('utf8')，
// 普通 Uint8Array 的 toString 不认编码，会返回 "123,34,..." 这种逗号表 ⇒ JSON.parse 直接抛，
// 宿主 listen() 随之抛出、进程静默结束（表现：网关等 init 应答直到超时）。
class MiniBuffer extends Uint8Array {
  toString(encoding) {
    const name = String(encoding || 'utf8').toLowerCase()
    if (name === 'base64') {
      let binary = ''
      for (const byte of this) binary += String.fromCharCode(byte)
      return btoa(binary)
    }
    if (name === 'hex') {
      let out = ''
      for (const byte of this) out += byte.toString(16).padStart(2, '0')
      return out
    }
    return new TextDecoder().decode(this)
  }
  static alloc(size) { return new MiniBuffer(Number(size) || 0) }
  static byteLength(value) {
    return typeof value === 'string' ? new TextEncoder().encode(value).length : Number(value?.length) || 0
  }
  static from(value, encoding) {
    if (typeof value === 'string') {
      const name = String(encoding || 'utf8').toLowerCase()
      if (name === 'base64') return new MiniBuffer(Uint8Array.from(atob(value), c => c.charCodeAt(0)))
      if (name === 'hex') {
        const bytes = new MiniBuffer(Math.floor(value.length / 2))
        for (let at = 0; at < bytes.length; at += 1) bytes[at] = parseInt(value.substr(at * 2, 2), 16)
        return bytes
      }
      return new MiniBuffer(new TextEncoder().encode(value))
    }
    if (value instanceof Uint8Array) return new MiniBuffer(value)
    if (value instanceof ArrayBuffer) return new MiniBuffer(new Uint8Array(value))
    if (Array.isArray(value)) return new MiniBuffer(value)
    return new MiniBuffer(0)
  }
  static concat(list) {
    let total = 0
    for (const item of list) total += Number(item?.length) || 0
    const out = new MiniBuffer(total)
    let at = 0
    for (const item of list) { out.set(item, at); at += item.length }
    return out
  }
}
globalThis.Buffer = MiniBuffer

// ── Bun 空壳：真用到本机进程能力才失败，不静默假装支持。──
globalThis.Bun ??= new Proxy({}, {
  get(_target, name) {
    if (name === 'version') return 'stub'
    return () => { throw new Error('Bun.' + String(name) + ' is unavailable in this runtime') }
  },
})

self.addEventListener('message', event => {
  const data = event.data || {}
  // wire.mjs 的 listen() 靠 '\n' 分帧；传输层是按 '\n' 切行后才送过来的，行尾已丢。
  // 不补回去，宿主会把收到的所有帧攒在 remainder 里，一帧都切不出来（表现：握手超时）。
  if (data.kind === 'line') pushLine(data.text.endsWith('\n') ? data.text : data.text + '\n')
  else if (data.kind === 'files') {
    // 运行期追加文件（插件的文件是安装/接入时才从网关取回的）
    for (const [key, text] of Object.entries(data.files || {})) files.set(key, text)
    for (const [key, url] of Object.entries(data.moduleUrls || {})) moduleUrls.set(key, url)
  }
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
  /**
   * 取某个插件包的文件。iOS 上插件装在**网关那台机器**上，而宿主跑在手机里 ⇒
   * 网关 init 里给的 `directory` 是网关本机路径，宿主读不到内容。
   * 所以在把 `init` 交给宿主之前，先按包 id 把文件取回来登记进模块表/文件表。
   */
  packageFiles?: (id: string) => Promise<HostFile[]>
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
  let exitCode: number | null = null
  let lastNotice = ''
  const loadedPackages = new Set<string>()

  // 运行期登记文件：既进文件表（宿主 readFile 用），也生成模块 URL（宿主 import 用）。
  const registerFiles = (files: HostFile[]) => {
    const urls = buildModuleUrls(files, '')
    const moduleUrls: Record<string, string> = {}
    for (const [key, url] of urls) moduleUrls[key] = url
    const table: Record<string, string> = {}
    for (const file of files) table[file.path] = file.text
    worker.postMessage({ kind: 'files', files: table, moduleUrls })
  }

  // init 里带着每个已启用包的 id；先把文件取回手机，再交给宿主去 load。
  const prepareFrame = async (line: string): Promise<string> => {
    if (!options.packageFiles) return line
    let frame: { method?: string; params?: { packages?: unknown } }
    try { frame = JSON.parse(line) as typeof frame } catch { return line }
    if (frame.method !== 'init') return line
    const entries = Array.isArray(frame.params?.packages) ? (frame.params?.packages as Array<{ id?: unknown }>) : []
    for (const entry of entries) {
      const id = typeof entry.id === 'string' ? entry.id : ''
      if (!id || loadedPackages.has(id)) continue
      try {
        const files = await (options.packageFiles as (id: string) => Promise<HostFile[]>)(id)
        if (files.length) {
          registerFiles(files.map(file => ({ path: `packages/${id}/${file.path}`, text: file.text })))
          loadedPackages.add(id)
        }
      } catch (failure) {
        lastNotice = failure instanceof Error ? failure.message : String(failure)
      }
    }
    return line
  }

  worker.addEventListener('message', event => {
    const data = event.data || {}
    if (data.kind === 'out') {
      for (const line of String(data.text).split('\n')) {
        if (!line.trim()) continue
        // 宿主 stdout 上的每一行就是协议帧，而远端宿主（iOS）的对端是**网关** ——
        // 网关发来的 `init` 由宿主应答，应答只有送回网关，握手才会完成。
        // 曾经这里只把帧喂给面板自己的 handlers：帧被面板吞掉，网关一直等不到应答，
        // `start_remote` 直到超时，整次安装以「启动插件进程失败」收场。
        options.transport.send(line)
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
    if (data.kind === 'exit') {
      // 宿主自己结束了：以前这里什么都不做，于是面板永远停在「正在加载脚本插件」，
      // 直到网关 60 秒后报超时 —— 退出必须看得见。
      exitCode = Number(data.code) || 0
      return
    }
    if (data.kind === 'boot-failed') {
      // 事件回调里 throw 不会让任何 promise 失败，所以先记下来，由下一次 call 抛出
      bootFailure = new Error(`插件宿主启动失败：${data.message}`)
      return
    }
  })

  options.transport.onLine(line => {
    void prepareFrame(line).then(prepared => worker.postMessage({ kind: 'line', text: prepared }))
  })
  options.transport.onClose(() => worker.postMessage({ kind: 'close' }))

  return {
    notice: () => lastNotice,
    call(method, params) {
      if (bootFailure) return Promise.reject(bootFailure)
      if (exitCode !== null) return Promise.reject(new Error(`插件宿主已退出（code ${exitCode}）`))
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
