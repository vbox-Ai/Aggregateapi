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

/**
 * 垫片只有一份真身：`plugin-host-shims.mjs`。
 * 桌面上的本地沙盘（`_hostprobe/`）也用同一份工厂生成垫片 ⇒ 沙盘里跑的就是这里上线的代码。
 */
import { NODE_SHIMS, shimSource } from './plugin-host-shims.mjs'

export { NODE_SHIMS, shimSource }

export type HostFile = { path: string; text: string }

export type HostTransport = {
  /** 把一帧发给对端（网关） */
  send: (line: string) => void
  /** 对端来的帧（每项是完整的一行 JSON） */
  onLine: (handler: (line: string) => void) => void
  /** 传输层关闭 */
  onClose: (handler: (reason: string) => void) => void
  /**
   * 主动收拾传输层（清掉网关侧的会话）。
   * 可选：有的实现（例如本地假对端）没有远端状态要清。
   */
  teardown?: () => void
}

/**
 * 把一个模块表编译成「可 import 的 URL 表」：改写相对与 node: 说明符为 Blob URL。
 *
 * ── 为什么不能单遍扫描（0026 修的就是这里）──────────────────────
 * 说明符要用「被依赖模块的 Blob URL」来改写，而 Blob URL 又只能由**改写后的内容**
 * 生成。单遍按数组顺序处理时，排在前面的模块看不到后面模块的 URL —— 占位是空串，
 * 而 `''` 是 falsy，`resolveSpecifier` 会当成「没有这份文件」返回 null，于是说明符
 * **原样保留**。GitHub 侧 `/host/source` 给出的顺序是 `main.mjs` 在最前、它 import
 * 的 wire / fetch / loader 全在后面，结果入口那 10 条 `./x.mjs` 一条都没被改写：
 * Blob URL 的相对解析落到 `blob:<origin>/wire.mjs` 这种不存在的地址，`await import`
 * 直接抛，宿主连 boot 都完成不了 —— 网关那边看到的就是 init 一直不应答，60 秒后
 * 报「远端插件握手超时」（手机上「正在加载脚本插件」一直转，0.0 MiB 不动）。
 *
 * ── 现在的做法 ────────────────────────────────────────────────
 * 先把依赖图求出来做 Tarjan，按**被依赖者在前**的分量顺序生成：轮到某个分量时，
 * 它依赖的分量都已有 URL，一次成型，无需回填。
 * 分量内多于一个模块（宿主里 `login-prompts.mjs` ↔ `login-policy.mjs` 就是这种环）
 * 时合并成一份源码 —— 环内互相 import 本来就是个死结（A 的 URL 要 B 的内容、
 * B 的 URL 要 A 的内容），合并后它们同处一个模块，环自然消失，两者对外都映射到
 * 同一个 URL（同一个 URL 只会被实例化一次，语义与「互为模块」一致）。
 */
export function buildModuleUrls(files: HostFile[], hostDir: string): Map<string, string> {
  const urls = new Map<string, string>()
  // 目录内相对路径 → 绝对（相对 hostDir）键，便于解析 `./x.mjs`
  const key = (path: string) => path.replace(/\\/g, '/').replace(/^\.\//, '')
  const pending = files.map(file => ({ ...file, key: key(file.path) }))

  const text = new Map<string, string>()
  for (const file of pending) text.set(file.key, file.text)

  const shimUrl = new Map<string, string>()
  for (const name of NODE_SHIMS) {
    shimUrl.set(name, URL.createObjectURL(new Blob([shimSource(name)], { type: 'text/javascript' })))
  }

  const deps = new Map<string, string[]>()
  for (const file of pending) {
    deps.set(
      file.key,
      relativeSpecifiers(file.text, file.key).filter(dep => text.has(dep)),
    )
  }

  for (const group of componentOrder([...text.keys()], deps)) {
    const members = new Set(group)
    const source =
      group.length === 1
        ? rewriteSpecifiers(group[0], text.get(group[0]) ?? '', urls, shimUrl)
        : mergeComponent(group, text, urls)
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    // 分量内每个键都指向同一个 URL：ESM 按 URL 去重，等价于它们互相就是同一个模块
    for (const member of members) urls.set(member, url)
  }
  return urls
}

/** 源码里出现的同表相对说明符（`./x` / `../x`）；`node:*` 与裸包名不算 */
function relativeSpecifiers(source: string, fromKey: string): string[] {
  const found: string[] = []
  const pattern = /(\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\2/g
  let match = pattern.exec(source)
  while (match) {
    const resolved = resolveKey(match[3], fromKey)
    if (resolved) found.push(resolved)
    match = pattern.exec(source)
  }
  return found
}

/**
 * 相对说明符 → 模块表键（候选规则与 {@link resolveSpecifier} 一致）。
 * 解析不出来（裸包名、`node:*`、绝对 URL）返回 null。
 */
function resolveKey(specifier: string, fromKey: string): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null
  const base = fromKey.split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') base.pop()
    else base.push(part)
  }
  const last = base.pop() ?? ''
  const joined = [...base, last].filter(Boolean).join('/')
  if (last.endsWith('.mjs')) return joined
  // 与 resolveSpecifier 的候选顺序对齐：先精确，再补 `.mjs`，最后 `index.mjs`
  return `${joined}.mjs`
}

/** 把一条模块源码里的说明符改写成已就绪的 URL（依赖分量已先处理） */
function rewriteSpecifiers(
  fromKey: string,
  source: string,
  urls: Map<string, string>,
  shimUrl: Map<string, string>,
): string {
  return source.replace(
    /(\bfrom\s*|\bimport\s*\(\s*)(['"])([^'"]+)\2/g,
    (whole, lead: string, quote: string, specifier: string) => {
      const target = resolveSpecifier(specifier, fromKey, '', urls, shimUrl)
      return target ? `${lead}${quote}${target}${quote}` : whole
    },
  )
}

/**
 * 把强连通分量里的模块拼成一份源码。
 *
 * 命名导入按来源合并（两处都 `import { send } from './wire.mjs'` 拼起来会重复声明
 * 同一个绑定，是语法错误）；指向分量内部的导入整条丢掉（合并后同处一个作用域）。
 */
function mergeComponent(
  group: string[],
  text: Map<string, string>,
  urls: Map<string, string>,
): string {
  const members = new Set(group)
  const named = new Map<string, Set<string>>()
  const sideEffects: string[] = []
  const bodies: string[] = []

  for (const member of group) {
    const kept: string[] = []
    for (const line of (text.get(member) ?? '').split('\n')) {
      const namedImport = /^\s*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/.exec(line)
      if (namedImport) {
        const target = resolveKey(namedImport[2], member)
        if (target && members.has(target)) continue
        const source = target && urls.has(target) ? target : namedImport[2]
        const bucket = named.get(source) ?? new Set<string>()
        for (const raw of namedImport[1].split(',')) {
          const binding = raw.trim()
          if (binding) bucket.add(binding)
        }
        named.set(source, bucket)
        continue
      }
      const sideEffect = /^\s*import\s*['"]([^'"]+)['"]\s*;?\s*$/.exec(line)
      if (sideEffect) {
        const target = resolveKey(sideEffect[1], member)
        sideEffects.push(`import '${(target && urls.get(target)) || sideEffect[1]}'`)
        continue
      }
      kept.push(line)
    }
    bodies.push(`// ── 合并自 ${member} ──\n${kept.join('\n')}`)
  }

  const imports: string[] = []
  for (const [source, bindings] of named) {
    imports.push(`import { ${[...bindings].join(', ')} } from '${urls.get(source) ?? source}'`)
  }
  return [...imports, ...sideEffects, '', ...bodies].join('\n')
}

/** Tarjan：返回「被依赖者在前」的分量序列 */
function componentOrder(keys: string[], deps: Map<string, string[]>): string[][] {
  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const out: string[][] = []
  let next = 0

  const walk = (key: string): void => {
    index.set(key, next)
    low.set(key, next)
    next += 1
    stack.push(key)
    onStack.add(key)
    for (const dep of deps.get(key) ?? []) {
      if (!index.has(dep)) {
        walk(dep)
        low.set(key, Math.min(low.get(key) ?? 0, low.get(dep) ?? 0))
      } else if (onStack.has(dep)) {
        low.set(key, Math.min(low.get(key) ?? 0, index.get(dep) ?? 0))
      }
    }
    if (low.get(key) === index.get(key)) {
      const group: string[] = []
      for (;;) {
        const popped = stack.pop()
        if (popped === undefined) break
        onStack.delete(popped)
        group.push(popped)
        if (popped === key) break
      }
      out.push(group)
    }
  }

  for (const key of keys) if (!index.has(key)) walk(key)
  return out
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
