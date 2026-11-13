/**
 * 手机端脚本宿主的 `node:*` 垫片（**唯一真身**）。
 *
 * 这里是「宿主代码字符串」的工厂：手机端把它生成的内容做成 Blob URL 给 Worker 里的
 * 宿主据以 import（见 `plugin-host.ts`）；桌面上的本地沙盘（`_hostprobe/`）用同一份
 * 工厂把垫片写成文件，于是**沙盘跑的就是真正上线的垫片**，不再两处各写一遍。
 *
 * ⚠️ 这个文件里的每一段都是「模板字符串里的 JS」：里面**不能出现反引号或 `${`**，
 *    需要反斜杠时统一用 `String.fromCharCode(92)`。
 */

/** 宿主与插件里会被改写的 `node:*` 说明符 → 垫片名 */
export const NODE_SHIMS = [
  'async_hooks', 'child_process', 'crypto', 'events', 'fs', 'fs/promises',
  'http2', 'net', 'os', 'path', 'stream', 'string_decoder', 'tls', 'url', 'worker_threads',
]

/** 同步 SHA-256（`node:crypto.createHash` 在 Worker 里没有，而宿主是多处同步用它） */
const SHA256 = String.raw`
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]

const rotr = (value, bits) => ((value >>> bits) | (value << (32 - bits))) >>> 0

function block(state, chunk) {
  const w = new Uint32Array(64)
  for (let i = 0; i < 16; i += 1) {
    w[i] = ((chunk[i * 4] << 24) | (chunk[i * 4 + 1] << 16) | (chunk[i * 4 + 2] << 8) | chunk[i * 4 + 3]) >>> 0
  }
  for (let i = 16; i < 64; i += 1) {
    const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0
    const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
  }
  let a = state[0], b = state[1], c = state[2], d = state[3]
  let e = state[4], f = state[5], g = state[6], h = state[7]
  for (let i = 0; i < 64; i += 1) {
    const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
    const ch = ((e & f) ^ (~e & g)) >>> 0
    const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
    const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
    const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
    const t2 = (S0 + maj) >>> 0
    h = g; g = f; f = e; e = (d + t1) >>> 0
    d = c; c = b; b = a; a = (t1 + t2) >>> 0
  }
  state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0
  state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0
  state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0
  state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0
}

const toBytes = value => (value instanceof Uint8Array ? value
  : new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)))

function sha256(value) {
  const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const data = toBytes(value)
  const padded = new Uint8Array((((data.length + 9) + 63) >> 6) << 6)
  padded.set(data)
  padded[data.length] = 0x80
  const bits = data.length * 8
  for (let i = 0; i < 8; i += 1) padded[padded.length - 1 - i] = Math.floor(bits / Math.pow(2, 8 * i)) & 0xff
  for (let at = 0; at < padded.length; at += 64) block(state, padded.subarray(at, at + 64))
  const out = new Uint8Array(32)
  for (let i = 0; i < 8; i += 1) {
    out[i * 4] = (state[i] >>> 24) & 0xff; out[i * 4 + 1] = (state[i] >>> 16) & 0xff
    out[i * 4 + 2] = (state[i] >>> 8) & 0xff; out[i * 4 + 3] = state[i] & 0xff
  }
  return out
}`

/**
 * 生成一个 `node:<name>` 垫片的源码。
 * 重能力（net / tls / http2 / child_process / worker_threads）留桩：**真用了才报错**，
 * 但它们必须能被 import —— 宿主 main.mjs 在启动时就把这些模块都导进来了。
 */
export function shimSource(name) {
  const why = (label) => `${label} 在当前运行时不可用（手机端跑不了本机进程与裸 socket；插件请走宿主的 script.http）`
  const stub = (label) => `const fail = () => { throw new Error(${JSON.stringify(why(label))}) }
export default new Proxy({}, { get() { return fail } })`
  switch (name) {
    case 'events':
      return `export class EventEmitter {
  constructor() { this.listeners = new Map() }
  on(event, handler) { const list = this.listeners.get(event) || []; list.push(handler); this.listeners.set(event, list); return this }
  once(event, handler) { const wrapper = (...args) => { this.removeListener(event, wrapper); handler(...args) }; return this.on(event, wrapper) }
  off(event, handler) { return this.removeListener(event, handler) }
  removeListener(event, handler) {
    const list = (this.listeners.get(event) || []).filter(item => item !== handler)
    this.listeners.set(event, list); return this
  }
  emit(event, ...args) { for (const handler of this.listeners.get(event) || []) handler(...args); return true }
}
export function once(target, event) {
  return new Promise((resolve, reject) => {
    // 我们的 stdout 是无缓冲的（直接 postMessage 给面板），永远不需要等 drain；
    // 万一对端没有 once，直接放行，别把发送方吊死在这里。
    if (!target || typeof target.once !== 'function') { resolve([]); return }
    const done = (...args) => { target.removeListener && target.removeListener(event, done); resolve(args) }
    const failed = error => { target.removeListener && target.removeListener(event, done); reject(error) }
    target.once(event, done)
    target.once('error', failed)
  })
}
export default { EventEmitter, once }`
    case 'crypto':
      return `const toHex = bytes => Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
const toBase64 = bytes => btoa(String.fromCharCode.apply(null, bytes))
${SHA256}
class Hash {
  constructor() { this.chunks = [] }
  update(value) { this.chunks.push(value); return this }
  digest(encoding) {
    const parts = this.chunks.map(toBytes)
    const merged = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) { merged.set(part, at); at += part.length }
    const out = sha256(merged)
    if (encoding === 'hex') return toHex(out)
    if (encoding === 'base64') return toBase64(out)
    return out
  }
}
export const createHash = () => new Hash()
export const randomUUID = () => globalThis.crypto.randomUUID()
export function randomBytes(size) {
  const bytes = new Uint8Array(size); globalThis.crypto.getRandomValues(bytes); return bytes
}
export default { createHash, randomUUID, randomBytes }`
    case 'async_hooks':
      return `export class AsyncLocalStorage {
  constructor() { this.stack = [] }
  getStore() { return this.stack[this.stack.length - 1] }
  run(store, callback, ...rest) { this.stack.push(store)
    try { return callback(...rest) } finally { this.stack.pop() } }
  enterWith(store) { this.stack[this.stack.length - 1] = store }
  disable() { this.stack = [] }
}
export default { AsyncLocalStorage }`
    case 'path':
      // 宿主的 entries.mjs 用 relative(root, file) + isAbsolute 判断「入口是否在包内」；
      // 以前 relative 直接返回 to、isAbsolute 又把绝对路径判成 true ⇒ **每个插件**都被判成
      // "Plugin entry is outside its package"。这里给出真正的最小语义（POSIX 风格）。
      // 这段是模板字符串里的 JS，所以一个反斜杠都不能写（会被模板吃掉），统一用 code 92 切分。
      return `const slash = String.fromCharCode(92)
const toSlashes = value => String(value).split(slash).join('/')
export const normalize = value => {
  const text = toSlashes(value)
  const absolute = text.startsWith('/')
  const out = []
  for (const part of text.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!absolute) out.push('..')
      continue
    }
    out.push(part)
  }
  return (absolute ? '/' : '') + out.join('/')
}
export const join = (...parts) => normalize(parts.filter(part => part !== '').join('/'))
export const resolve = (...parts) => {
  let out = ''
  for (const part of parts) {
    if (part === '') continue
    const text = String(part)
    out = normalize(text.startsWith('/') ? text : out + '/' + text)
  }
  return out || '/'
}
export const dirname = value => {
  const text = normalize(value)
  const at = text.lastIndexOf('/')
  if (at < 0) return ''
  return at === 0 ? '/' : text.slice(0, at)
}
export const basename = value => normalize(value).split('/').pop()
export const isAbsolute = value => toSlashes(value).startsWith('/')
export const relative = (from, to) => {
  const base = normalize(from).split('/').filter(Boolean)
  const target = normalize(to).split('/').filter(Boolean)
  let at = 0
  while (at < base.length && at < target.length && base[at] === target[at]) at += 1
  return Array(base.length - at).fill('..').concat(target.slice(at)).join('/')
}
export const extname = value => {
  const leaf = basename(value)
  const at = leaf.lastIndexOf('.')
  return at <= 0 ? '' : leaf.slice(at)
}
export const sep = '/'
export const posix = { normalize, join, resolve, dirname, basename, isAbsolute, relative, extname, sep }
export default { normalize, join, resolve, dirname, basename, isAbsolute, relative, extname, sep, posix }`
    case 'url':
      return `// 关键：把「文件路径」映射回我们登记过的 Blob URL，宿主因此不必改一行
export function pathToFileURL(value) {
  // 远端宿主拿到的是**网关本机**绝对路径（或包内相对路径），而我们登记的是
  // packages/<包 id>/<相对路径>：既要能按整条路径命中，也要能按后缀（含文件名）命中。
  const key = String(value).split(String.fromCharCode(92)).join('/').replace(/^[.][/]/, '')
  const table = globalThis.__hostModuleUrls
  const leaf = key.split('/').pop()
  let url = table && (table.get(key) || table.get(leaf))
  if (!url && table) {
    for (const [path, candidate] of table) {
      if (path === leaf || key.endsWith(path) || path.endsWith(key)) { url = candidate; break }
    }
  }
  if (!url) throw new Error('host module is not registered: ' + key)
  return { href: url, toString: () => url }
}
export function fileURLToPath(value) {
  const text = typeof value === 'string' ? value : value.href
  return decodeURIComponent(text.replace(/^file:\\/\\//, '/'))
}
export class URL extends globalThis.URL {}
export default { pathToFileURL, fileURLToPath, URL: globalThis.URL }`
    case 'fs/promises':
      return `const table = () => globalThis.__hostFiles
export async function readFile(value) {
  const key = String(value).split(String.fromCharCode(92)).join('/')
  const files = table() || new Map()
  const leaf = key.split('/').pop()
  for (const [path, text] of files) {
    // 网关给的是**本机路径**（/var/mobile/.../packages/<id>/x），我们登记的是
    // packages/<id>/x：按整条后缀或文件名命中都算。
    if (key.endsWith(path) || path.endsWith(key) || path === leaf) return text
  }
  throw new Error('ENOENT: ' + key)
}
export async function realpath(value) { return String(value).split(String.fromCharCode(92)).join('/') }
export async function stat() { return { isFile: () => true, isDirectory: () => false, size: 0 } }
export async function mkdir() { return undefined }
export async function readdir() { return [] }
export async function rm() { return undefined }
export async function writeFile() { throw new Error('writeFile is unavailable in this runtime') }
export default { readFile, realpath, stat, mkdir, readdir, rm, writeFile }`
    case 'fs':
      return `export * from 'node:fs/promises'
export default {}`
    case 'stream':
      return `class Base { pipe(target) { return target } on() { return this } once() { return this } off() { return this } }
export class Readable extends Base {}
export class Writable extends Base {}
export class Duplex extends Base {}
export class PassThrough extends Duplex {}
export class Transform extends Duplex {}
export default { Readable, Writable, Duplex, PassThrough, Transform }`
    case 'string_decoder':
      return `export class StringDecoder {
  constructor(encoding) { this.encoding = encoding || 'utf8' }
  write(buffer) { return new TextDecoder('utf-8').decode(buffer) }
  end(buffer) { return buffer ? this.write(buffer) : '' }
}
export default { StringDecoder }`
    case 'os':
      return `export const homedir = () => '/'
export const platform = () => 'ios'
export const tmpdir = () => '/tmp'
export const cpus = () => []
export const totalmem = () => 0
export const freemem = () => 0
export default { homedir, platform, tmpdir, cpus, totalmem, freemem }`
    case 'child_process':
      return `export class ChildProcess {}
${stub('node:child_process')}`
    case 'http2':
      return `export const constants = {}
${stub('node:http2')}`
    case 'net':
      return stub('node:net')
    case 'tls':
      return stub('node:tls')
    case 'worker_threads':
      return stub('node:worker_threads')
    default:
      return stub(`node:${name}`)
  }
}
