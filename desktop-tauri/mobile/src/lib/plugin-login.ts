/**
 * 插件包加载与登录驱动（阶段 0 · 第 2/3 项）。
 *
 * ── 为什么在 JS 里解 .tgz ────────────────────────────────────
 * Magpie 的 `dist` 分支发布的就是已构建好的小包（实测 `opencode-nous-auth` 仅 10 KB、
 * `opencode-astudio-auth` 12 KB，`dependencies` 为空），所以手机上不需要 npm 解析、
 * 不需要 Bun —— 只要能取出包里的 .mjs 就行。解包用平台自带的
 * `DecompressionStream('gzip')`（iOS 15+ 的 WKWebView 支持）+ 一个 tar 读取器。
 *
 * ── 登录怎么驱动 ──────────────────────────────────────────────
 * 插件暴露 `auth.methods[].authorize()`，宿主把它包成 `login.start`：
 *   login.start → { flow, url, instructions, poll_interval_ms }
 *   login.poll  → 轮询结果（成功后宿主自己把凭证写进网关，见 store.update）
 * 所以界面只需展示 url 与 instructions（里面含 user_code）、提供「打开链接」与「取消」。
 */
import type { HostFile } from './plugin-host'
import type { PluginHostSession } from './plugin-host-session'

/** 解 gzip 并读 tar：只取普通文件，目录与元数据跳过 */
export async function unpackTarGz(bytes: Uint8Array): Promise<HostFile[]> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  const tar = new Uint8Array(await new Response(stream).arrayBuffer())
  const files: HostFile[] = []
  const decoder = new TextDecoder()
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    // 全零块 = 归档结束
    if (header.every(byte => byte === 0)) break
    const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/, '')
    const sizeText = decoder.decode(header.subarray(124, 136)).replace(/\0.*$/, '').trim()
    const size = parseInt(sizeText, 8) || 0
    const type = header[156]
    const body = tar.subarray(offset + 512, offset + 512 + size)
    offset += 512 + Math.ceil(size / 512) * 512
    if (!name || type === 53 /* 5 = 目录 */) continue
    if (type !== 48 /* 0 = 普通文件 */ && type !== 0) continue
    // 包内路径形如 package/index.mjs：去掉首层目录，其余作为相对路径
    const relative = name.replace(/^[^/]+\//, '')
    if (!relative) continue
    if (!/\.(mjs|js|json|ts)$/.test(relative)) continue
    files.push({ path: relative, text: decoder.decode(body) })
  }
  return files
}

export type LoginStart = {
  flow: string
  url: string
  instructions: string
  pollIntervalMs: number
}

export type LoginOutcome =
  | { status: 'pending' }
  | { status: 'success'; account?: string }
  | { status: 'failed'; message: string }

/** 把宿主返回的 login.start 结果规范化（字段名以宿主为准，这里只做取值与兜底） */
export function readLoginStart(result: unknown): LoginStart {
  const value = (result || {}) as Record<string, unknown>
  const flow = String(value.flow || '')
  const url = String(value.url || '')
  if (!flow || !url) throw new Error('插件没有返回可用的登录地址')
  return {
    flow,
    url,
    instructions: String(value.instructions || ''),
    pollIntervalMs: Number(value.poll_interval_ms) || 1500,
  }
}

/** 从 instructions 里抠出 user_code（界面上要单独放大显示，方便照着输） */
export function readUserCode(instructions: string): string | null {
  const matched = instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/)
  return matched ? matched[0] : null
}

/**
 * 轮询一次登录。宿主自己会在成功后把凭证写进网关，所以这里只判断状态。
 * 不在这里做定时器：界面通常已经有一个刷新节奏，重复起定时器会出现两条轮询。
 */
export async function pollLogin(
  session: PluginHostSession,
  provider: string,
  account: string,
  flow: string,
): Promise<LoginOutcome> {
  const result = await session.call('login.poll', { provider, account, id: flow })
  const value = (result || {}) as Record<string, unknown>
  const status = String(value.status || value.type || '')
  if (status === 'pending' || status === 'waiting') return { status: 'pending' }
  if (status === 'success' || status === 'done' || value.ok === true) {
    return { status: 'success', account: typeof value.account === 'string' ? value.account : undefined }
  }
  if (status === 'failed' || value.error) {
    return { status: 'failed', message: String(value.message || value.error || '登录失败') }
  }
  return { status: 'pending' }
}
