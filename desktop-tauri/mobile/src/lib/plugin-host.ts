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
