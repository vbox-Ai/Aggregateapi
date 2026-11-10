/**
 * 脚本插件在手机端的宿主运行器（阶段 0）。
 *
 * ── 它解决什么问题 ────────────────────────────────────────────
 * iOS 上没有 Bun（`plugin_host/script/bun.rs` 的 `asset()` 没有 ios 分支），
 * 而脚本插件宿主本体是一整套 JS（`plugin_host/script/host/*.mjs`，29 个模块）。
 * 本机原型已实测：宿主只依赖「两条流上的 NDJSON」与少量标准能力，注入一个
 * `Bun` 空壳即可在非 Bun 运行时下跑起来（见 `tools/plugin-host-node/`）。
 *
 * ── 为什么要在 Worker 里跑 ────────────────────────────────────
 * 宿主是长驻的、会读 stdin 的循环，且插件的全局变量必须与面板隔离
 * （一支插件一个上下文，防互相污染）。所以放进独立 Worker。
 *
 * ── 为什么要把模块改写成 Blob URL ─────────────────────────────
 * Worker 里没有文件系统，而宿主是这么加载插件的：
 *     const candidates = servers(await import(pathToFileURL(entry).href))
 * 于是我们：① 把每个 .mjs 的内容变成一个 Blob URL；② 把源码里的模块说明符
 * （`./wire.mjs` 这类相对路径、以及 `node:*`）改写成对应的 Blob URL；
 * ③ 把 `node:fs/promises` 等按我方的内存表实现。
 * 这样 `pathToFileURL` 返回的仍然是「一个真的能 import 的 URL」，宿主一行不用改。
 *
 * ── 宿主侧对端契约（实测，见 tools/plugin-host-node/README.md）──
 *   宿主 → 对端：script.http.open / script.http.read / script.http.close
 *                （open 返回 {id,status,headers,url}；read 返回 {data: base64, done}，
 *                  done 为真时宿主只关闭不入队 ⇒ 最后一块必须 done:false 送完）
 *                + store.get / store.list / store.update / store.ledger_* / script.proxy.resolve
 *   对端 → 宿主：init / ping / script.packages / script.settings / shutdown
 *                + login.start / login.poll / login.callback / login.cancel / provider.info
 */

/** 宿主与插件里会被改写的 `node:*` 说明符 → 我方 shim 的模块名 */
export const NODE_SHIMS = [
  'async_hooks', 'child_process', 'crypto', 'events', 'fs', 'fs/promises',
  'http2', 'net', 'os', 'path', 'stream', 'string_decoder', 'tls', 'url', 'worker_threads',
] as const

export type HostFile = { path: string; text: string }

export type HostTransport = {
  /** 把一帧发给对端（网关） */
  send: (line: string) => void
  /** 对端来的帧（每项是完整的一行 JSON） */
  onLine: (handler: (line: string) => void) => void
  /** 传输层关闭 */
  onClose: (handler: (reason: string) => void) => void
}

/** 把一个模块表编译成「可 import 的 URL 表」：改写相对与 node: 说明符为 Blob URL */
export function buildModuleUrls(files: HostFile[], hostDir: string): Map<string, string> {
  const urls = new Map<string, string>()
  // 目录内相对路径 → 绝对（相对 hostDir）键，便于解析 `./x.mjs`
  const key = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '')
  const pending = files.map(file => ({ ...file, key: key(file.path) }))

  for (const file of pending) {
    // 先占位，后回填：说明符可能指向尚未处理的文件
    urls.set(file.key, '')
  }
  const shimUrl = new Map<string, string>()

  for (const name of NODE_SHIMS) {
    shimUrl.set(name, URL.createObjectURL(new Blob([shimSource(name)], { type: 'text/javascript' })))
  }

  for (const file of pending) {
    const rewritten = file.text.replace(
      /(\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\2/g,
      (whole, lead: string, quote: string, specifier: string) => {
        const target = resolveSpecifier(specifier, file.key, hostDir, urls, shimUrl)
        return target ? `${lead}${quote}${target}${quote}` : whole
      },
    )
    urls.set(file.key, URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' })))
  }
  return urls
}

function resolveSpecifier(
  specifier: string,
  fromKey: string,
  hostDir: string,
  urls: Map<string, string>,
  shimUrl: Map<string, string>,
): string | null {
  if (specifier.startsWith('node:')) {
    const name = specifier.slice('node:'.length)
    return shimUrl.get(name) ?? shimUrl.get('path') ?? null
  }
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const base = fromKey.split('/').slice(0, -1)
    const parts = specifier.split('/')
    for (const part of parts) {
      if (part === '.' || part === '') continue
      if (part === '..') base.pop()
      else base.push(part)
    }
    const resolved = base.join('/')
    const candidates = [resolved, `${resolved}.mjs`, `${resolved}/index.mjs`]
    for (const candidate of candidates) {
      const url = urls.get(candidate)
      if (url) return url
    }
    // 宿主目录是 hostDir；插件文件的相对导入同样落在同一张表里
    return null
  }
  return null
}

/** `node:*` 的最小实现；重能力（net/tls/http2/child_process）留桩：真用了才报错 */
function shimSource(name: string): string {
  const stub = (why: string) => `export default new Proxy({}, { get() { throw new Error(${JSON.stringify(why)}) } })`
  switch (name) {
    case 'events':
      return `export function once(target, event) {
  return new Promise((resolve, reject) => {
    const onEvent = (...args) => { cleanup(); resolve(args) }
    const onError = error => { cleanup(); reject(error) }
    const cleanup = () => { target.removeListener?.(event, onEvent); target.removeListener?.('error', onError) }
    target.once?.(event, onEvent); target.once?.('error', onError)
  })
}
export default { once }`
    case 'crypto':
      return `const uuid = () => globalThis.crypto.randomUUID()
export const randomUUID = uuid
export function randomBytes(size) {
  const bytes = new Uint8Array(size); globalThis.crypto.getRandomValues(bytes); return bytes
}
// createHash 等属于 Node 专有：真的用到才失败，而不是静默给出错的结果
export default new Proxy({ randomUUID: uuid, randomBytes }, {
  get(target, key) { if (key in target) return target[key]
    throw new Error('node:crypto.' + String(key) + ' is unavailable in this runtime') },
})`
    case 'async_hooks':
      return `export class AsyncLocalStorage {
  #stack = []
  getStore() { return this.#stack[this.#stack.length - 1] }
  run(store, callback, ...rest) { this.#stack.push(store)
    try { return callback(...rest) } finally { this.#stack.pop() } }
  enterWith(store) { this.#stack[this.#stack.length - 1] = store }
}
export default { AsyncLocalStorage }`
    case 'path':
      return `const norm = parts => parts.filter(p => p !== '' && p !== '.').join('/')
export const join = (...parts) => norm(parts)
export const resolve = (...parts) => norm(parts)
export const dirname = value => { const at = String(value).replace(/\\\\/g, '/').lastIndexOf('/'); return at <= 0 ? '' : String(value).replace(/\\\\/g, '/').slice(0, at) }
export const basename = value => String(value).replace(/\\\\/g, '/').split('/').pop()
export const isAbsolute = value => /^(\\/|[A-Za-z]:[\\\\/])/.test(String(value))
export const relative = (from, to) => String(to)
export const sep = '/'
export default { join, resolve, dirname, basename, isAbsolute, relative, sep }`
    case 'url':
      return `// 关键：把「文件路径」映射回我们登记过的 Blob URL，宿主因此不必改一行
export function pathToFileURL(value) {
  const key = String(value).replace(/\\\\/g, '/').replace(/^\\.\\//, '')
  const table = globalThis.__hostModuleUrls
  const url = table && (table.get(key) || table.get(key.replace(/^.*\\//, '')))
  if (!url) throw new Error('host module is not registered: ' + key)
  return { href: url, toString: () => url }
}
export class URL extends globalThis.URL {}
export default { pathToFileURL, URL: globalThis.URL }`
    case 'fs/promises':
      return `const table = () => globalThis.__hostFiles
export async function readFile(value) {
  const key = String(value).replace(/\\\\/g, '/')
  const files = table() || new Map()
  for (const [path, text] of files) if (key.endsWith(path) || path.endsWith(key.replace(/^.*\\//, ''))) return text
  throw new Error('ENOENT: ' + key)
}
export async function realpath(value) { return String(value).replace(/\\\\/g, '/') }
export async function stat() { return { isFile: () => true } }
export async function mkdir() {}
export default { readFile, realpath, stat, mkdir }`
    case 'fs':
      return `export * from 'node:fs/promises'
export default {}`
    case 'stream':
      return `export class Readable { pipe() { return this } }
export class Writable {}
export default { Readable, Writable }`
    case 'string_decoder':
      return `export class StringDecoder { constructor(encoding) { this.encoding = encoding }
  write(buffer) { return new TextDecoder(this.encoding || 'utf-8').decode(buffer) } }
export default { StringDecoder }`
    case 'os':
      return `export const homedir = () => '/'
export const platform = () => 'ios'
export const tmpdir = () => '/tmp'
export default { homedir, platform, tmpdir }`
    default:
      return `${stub(`node:${name} is unavailable on this platform`)}
`
  }
}
