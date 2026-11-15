/**
 * 插件宿主的 Worker 引导与客户端会话（阶段 0 · 第 2 项）。
 *
 * 与 `plugin-host.ts` 的分工：那边负责「把宿主与插件的 .mjs 变成可 import 的 URL 并改写
 * 说明符 + 提供 node:* 的最小实现」；这里负责「把宿主跑起来、接上传输层、
 * 按 init → login.start → login.poll 驱动」。
 *
 * ── 三个刻意的设计 ────────────────────────────────────────────
 * 1) 一支插件一个上下文：插件会在全局装东西（fetch/http2/websocket/console），
 *    同引擎多支会互相覆盖。
 * 2) 传输层是一个窄接口（send/onLine/onClose），不写死 WebSocket：
 *    真机走网关的 HTTP 三端点，本机测试可以喂一个假对端 —— 协议是同一份。
 * 3) **双通道启动**：先试 Worker，8 秒内没走到 `loaded` 就自动降级到主线程重跑。
 *    iOS 的 WKWebView 对 `new Worker(blob:, { type: 'module' })` 与 Worker 内的
 *    blob 互引并不总是可用；而同一份引导脚本在主文档里跑是稳的（宿主只是被动
 *    收发帧，不需要真正的多线程）。降级只影响 CPU 占用，不影响功能。
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
  /** 关闭并回收运行环境 */
  close: () => void
  /** 最近一条「取插件文件 / 宿主退出」相关的提示（没有就是空串） */
  notice: () => string
}

/** 运行通道：Worker 或主线程，接口一致 */
type Channel = {
  post: (message: unknown) => void
  onMessage: (handler: (data: Record<string, unknown>) => void) => void
  dispose: () => void
}

/**
 * 引导脚本：注入 process/Buffer/Bun 与模块表，然后 import 宿主入口。
 *
 * 里面所有 `self.` 都会被改写成 `__bridge.`，`__bridge` 在脚本开头解析：
 * · Worker 里没有注入标记 ⇒ `__bridge = self`（就是 Worker 的全局对象）
 * · 主线程模式预先写 `self.__hostBridgeForBootstrap` ⇒ `__bridge` 是那个假对象
 * 这样同一份脚本两种运行方式共用，不用维护两份。
 */
function bootstrapSource(hostEntryKey: string): string {
  const body = `
// 模块表必须在 import 宿主之前就位，而 Worker 的构造参数只能带 URL。
// 所以这里先等一条 bootstrap 消息再继续 —— 否则会与 postMessage 竞态。
__bridge.postMessage({ kind: 'boot' })
const bootstrap = await new Promise(resolve => {
  __bridge.addEventListener('message', event => {
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
__bridge.__pushLine = pushLine
__bridge.__endInbound = endInbound

globalThis.process = {
  env: {}, platform: 'ios', argv: ['host'], version: '0',
  exit(code) { __bridge.postMessage({ kind: 'exit', code: Number(code) || 0 }) },
  on() {}, once() {}, off() {}, cwd: () => '/',
  stdout: { write(text) { __bridge.postMessage({ kind: 'out', text: String(text) }); return true } },
  stderr: { write(text) { __bridge.postMessage({ kind: 'err', text: String(text) }); return true } },
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

// ── 宿主内部错误必须看得见 ─────────────────────────────────────
// 顶层 import 成功返回 ≠ 宿主在跑。宿主之后在异步段抛出时，如果没人监听
// error/unhandledrejection，process.stderr 也没人消费，网关只能等 init 超时，
// 面板除了转圈什么都看不到（真机上就是这样卡满 60 秒）。
function reportHostError(reason) {
  __bridge.postMessage({ kind: 'host-error', message: String(reason) })
}
__bridge.addEventListener('error', event => {
  const detail = (event && event.error && event.error.stack) || (event && event.message) || event
  reportHostError(detail)
})
__bridge.addEventListener('unhandledrejection', event => {
  const reason = event && event.reason
  reportHostError((reason && (reason.stack || reason.message)) || reason)
})

// ── Bun 空壳：真用到本机进程能力才失败，不静默假装支持。──
globalThis.Bun ??= new Proxy({}, {
  get(_target, name) {
    if (name === 'version') return 'stub'
    return () => { throw new Error('Bun.' + String(name) + ' is unavailable in this runtime') }
  },
})

__bridge.addEventListener('message', event => {
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
  __bridge.postMessage({ kind: 'importing' })
  await import(entry)
  __bridge.postMessage({ kind: 'loaded' })
} catch (error) {
  __bridge.postMessage({ kind: 'boot-failed', message: String(error?.stack || error) })
}
`
  // 两种运行方式共用同一份脚本：把 self 换成可注入的 __bridge
  return 'const __bridge = (typeof self !== "undefined" && self.__hostBridgeForBootstrap) || self\n' +
    body.split('self.').join('__bridge.')
}

/** 宿主启动到哪一步了 —— Worker 是黑盒，没有这条链就只能看到「60 秒后网关报超时」 */
const STAGE_TEXT: Record<string, string> = {
  created: 'Worker 已创建但未响应',
  boot: '引导脚本已执行，尚未开始加载宿主入口',
  importing: '正在加载宿主入口 main.mjs',
}

/** 首轮等待入口加载完成的上限；超时就换主线程再试一次 */
const BOOT_TIMEOUT_MS = 8000
/** 降级到主线程后再等多久 */
const MAIN_TIMEOUT_MS = 12000

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
  /**
   * 宿主不可用时的回调（启动抛错 / 内部崩溃 / 自己退出 / 两条通道都没起来）。
   *
   * 以前这些只记在 `bootFailure` 里、由 `call()` 抛出 —— 可这套宿主是网关直连的，
   * 面板一次 `call()` 都不做，于是「宿主启动失败」四个字永远不会出现在界面上。
   */
  onFailure?: (reason: string) => void
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

  let nextId = 1
  const pending = new Map<number, (value: unknown) => void>()
  const eventHandlers: Array<(event: { event: string; params: unknown }) => void> = []
  const requestHandlers: Array<(method: string, params: Record<string, unknown>, id: number) => void> = []
  let bootFailure: Error | null = null
  let exitCode: number | null = null
  let lastNotice = ''
  const loadedPackages = new Set<string>()
  let stage = 'created'
  let channel: Channel | null = null
  let mode: 'worker' | 'main' = 'worker'
  let watchdog: ReturnType<typeof setTimeout> | null = null

  /** 宿主侧的失败：既记进 notice，也立刻抛给外层（不等到下一次 call） */
  const report = (reason: unknown) => {
    const text = String(reason ?? '').trim()
    if (!text) return
    lastNotice = text.length > 400 ? `${text.slice(0, 400)}…` : text
    options.onFailure?.(lastNotice)
  }

  const clearWatchdog = () => {
    if (watchdog !== null) {
      clearTimeout(watchdog)
      watchdog = null
    }
  }

  /** 一条宿主侧消息（两种通道都汇到这里） */
  const handleMessage = (data: Record<string, unknown>) => {
    const kind = String(data.kind ?? '')
    if (kind === 'boot') { stage = 'boot'; return }
    if (kind === 'importing') { stage = 'importing'; return }
    if (kind === 'loaded') {
      stage = 'loaded'
      clearWatchdog()
      return
    }
    if (kind === 'out') {
      for (const line of String(data.text ?? '').split('\n')) {
        if (!line.trim()) continue
        // 宿主 stdout 上的每一行就是协议帧，而远端宿主的对端是**网关** ——
        // 网关发来的 `init` 由宿主应答，应答只有送回网关，握手才会完成。
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
    if (kind === 'exit') {
      exitCode = Number(data.code) || 0
      report(`插件宿主已退出（code ${exitCode}）`)
      return
    }
    if (kind === 'err') {
      // process.stderr：宿主的崩溃堆栈、console.error 全走这里，以前整支丢弃
      report(data.text)
      return
    }
    if (kind === 'host-error') {
      report(`插件宿主内部错误：${data.message}`)
      return
    }
    if (kind === 'boot-failed') {
      bootFailure = new Error(`插件宿主启动失败：${data.message}`)
      report(bootFailure.message)
      return
    }
  }

  // 运行期登记文件：既进文件表（宿主 readFile 用），也生成模块 URL（宿主 import 用）。
  const registerFiles = (extra: HostFile[]) => {
    const extraUrls = buildModuleUrls(extra, '')
    const moduleUrls: Record<string, string> = {}
    for (const [key, url] of extraUrls) moduleUrls[key] = url
    const extraTable: Record<string, string> = {}
    for (const file of extra) extraTable[file.path] = file.text
    channel?.post({ kind: 'files', files: extraTable, moduleUrls })
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
        const extra = await (options.packageFiles as (id: string) => Promise<HostFile[]>)(id)
        if (extra.length) {
          registerFiles(extra.map(file => ({ path: `packages/${id}/${file.path}`, text: file.text })))
          loadedPackages.add(id)
        }
      } catch (failure) {
        lastNotice = failure instanceof Error ? failure.message : String(failure)
        // 取不回插件文件时宿主一定加载不了；以前这里只写变量、没人读，于是表现成「网关等 60 秒超时」
        report(`取回插件文件失败（${id}）：${lastNotice}`)
      }
    }
    return line
  }

  const makeWorkerChannel = (source: string): Channel => {
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { type: 'module' })
    return {
      post: message => worker.postMessage(message),
      onMessage: handler => worker.addEventListener('message', event => handler((event.data || {}) as Record<string, unknown>)),
      dispose: () => worker.terminate(),
    }
  }

  /**
   * 主线程通道：同一份引导脚本改用注入的假 self 跑。
   * 只在 Worker 迟迟不报 `loaded` 时启用 —— iOS 上 blob Worker 不总是可用，
   * 而主文档里 `import(blob:)` 是稳的。
   */
  const makeMainChannel = (source: string): Channel => {
    let inbound: ((event: { data: unknown }) => void) | null = null
    let outbound: ((data: Record<string, unknown>) => void) | null = null
    const bridge = {
      postMessage: (data: unknown) => { outbound?.(data as Record<string, unknown>) },
      addEventListener: (type: string, handler: (event: { data: unknown }) => void) => {
        if (type === 'message') inbound = handler
      },
    }
    const globals = globalThis as unknown as Record<string, unknown>
    const savedProcess = globals.process
    const savedConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug }
    const savedBuffer = globals.Buffer
    globals.__hostBridgeForBootstrap = bridge
    // 顶层 await 用 async IIFE 包起来；`new Function` 里动态 import 可用
    const factory = new Function(`(async () => { ${source} })()`) as () => Promise<void>
    void factory().catch(error => report(`插件宿主（主线程）启动失败：${error instanceof Error ? error.message : String(error)}`))
    return {
      post: message => inbound?.({ data: message }),
      onMessage: handler => { outbound = handler },
      dispose: () => {
        inbound = null
        outbound = null
        delete globals.__hostBridgeForBootstrap
        globals.process = savedProcess
        globals.Buffer = savedBuffer
        console.log = savedConsole.log
        console.info = savedConsole.info
        console.warn = savedConsole.warn
        console.error = savedConsole.error
        console.debug = savedConsole.debug
      },
    }
  }

  /** 建通道、挂监听、发 bootstrap —— 两种模式共用 */
  const wire = (next: 'worker' | 'main') => {
    channel?.dispose()
    mode = next
    stage = 'created'
    const source = bootstrapSource(hostEntryKey)
    channel = next === 'worker' ? makeWorkerChannel(source) : makeMainChannel(source)
    channel.onMessage(handleMessage)
    channel.post({ kind: 'bootstrap', moduleUrls: table, files })
    clearWatchdog()
    watchdog = setTimeout(() => {
      watchdog = null
      if (stage === 'loaded') return
      if (mode === 'worker') {
        // Worker 这条路走不通：同一份脚本改在主线程再试一次
        report(`插件宿主在 Worker 中没有启动（${STAGE_TEXT[stage] ?? stage}），正在改用主线程重试`)
        wire('main')
        watchdog = setTimeout(() => {
          watchdog = null
          if (stage === 'loaded') return
          report(`插件宿主（主线程）未完成加载：${STAGE_TEXT[stage] ?? stage}`)
        }, MAIN_TIMEOUT_MS)
        return
      }
      report(`插件宿主（主线程）未完成加载：${STAGE_TEXT[stage] ?? stage}`)
    }, BOOT_TIMEOUT_MS)
  }

  wire('worker')

  options.transport.onLine(line => {
    void prepareFrame(line)
      .then(prepared => channel?.post({ kind: 'line', text: prepared }))
      .catch(failure => report(`投递帧失败：${failure instanceof Error ? failure.message : String(failure)}`))
  })
  options.transport.onClose(() => channel?.post({ kind: 'close' }))

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
    close() {
      clearWatchdog()
      channel?.dispose()
      channel = null
    },
  }
}
