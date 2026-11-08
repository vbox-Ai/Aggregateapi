import { apiCall } from './client'

/**
 * 本机接入：把工具服务接进客户端（`api/tools.rs`）。
 *
 * 端点与载荷**逐字取自两处权威源**：
 *  · Rust 源码 `gw-src/tools.rs` 的 `install_targets` / `install_info` /
 *    `install_skill` / `install_mcp` / `uninstall_skill` / `uninstall_mcp`；
 *  · 网关二进制里内嵌的面板 JS 的同名封装。
 *
 * ```js
 * installInfo    = (e)   => GET  /api/tools/install-info?service=<id>
 * installTargets = (e,t) => GET  /api/tools/install-targets?service=<id>&protocol=<skill|mcp>
 * apiKeys        = ()    => GET  /api/tools/api-keys
 * installSkill   = (body)=> POST /api/tools/install-skill   { api_key_id, variant, clients }
 * installMcp     = (body)=> POST /api/tools/install-mcp     { service_id, mode?, api_key_id, clients }
 * uninstallSkill = (body)=> POST /api/tools/uninstall-skill { service_id, clients }
 * uninstallMcp   = (body)=> POST /api/tools/uninstall-mcp   { service_id, clients }
 * ```
 *
 * ── ⚠️ 这类操作写的是**网关所在主机**的文件 ────────────────────
 * skill 档是「打包为 Agent Skill，由面板安装到**本机客户端目录**」；mcp 档是往客户端的
 * MCP 配置里写一段。所以：手机端直连自己的网关（iOS 上网关就在手机里）时，那些客户端
 * 目录通常并不存在，**装了也没用**；手机端连**桌面网关**时才有意义。
 * 反过来，`install-info` 给出的**远程 MCP 地址**是纯只读的、任何设备上都有用 ——
 * 可以把它填进任意客户端的 MCP 配置。
 *
 * 校验规则（Rust 侧，客户端照抄以免白跑一趟）：
 *  · `install-targets`：未知服务 → 400「未知的工具服务」；服务不支持该协议 → 400「该服务不支持这个协议」；
 *  · `install-skill`：变体无效 → 400「Skill 运行时变体无效」；Key 不可用 →
 *    400「所选 API Key 不存在、已停用或不可用」；`clients` 为空 → 400「请至少选择一个客户端」；
 *  · `install-mcp`：`mode` 缺省 `http`，只接受 `http` / `bridge`；`bridge` **仅视觉分析可用**
 *    （其他服务 → 400「只有视觉分析支持本地桥接」）。
 */

export type InstallTarget = {
  /** 客户端标识，安装/卸载时放进 `clients` */
  key: string
  label?: string
  /** 已装/已配置 */
  installed?: boolean
  [k: string]: unknown
}

export type InstallInfo = {
  base_url?: string
  service?: string
  name?: string
  version?: string
  timeout_seconds?: number
  mcp?: {
    server_name?: string
    url?: string
    tools?: string[]
    bridge_url?: string
  }
  /** 只有网络搜索有 skill 档 */
  skill?: {
    name?: string
    version?: string
    recommended_variant?: string
    variants?: Array<{ id?: string; label?: string; note?: string; [k: string]: unknown }>
  }
}

export type InstallOutcome = {
  client?: string
  label?: string
  ok?: boolean
  error?: string | null
  path?: string
  [k: string]: unknown
}

export type InstallResult = { results?: InstallOutcome[] }

export const fetchInstallInfo = (service: string) =>
  apiCall<InstallInfo>(`/api/tools/install-info?service=${encodeURIComponent(service)}`)

export const fetchInstallTargets = (service: string, protocol: 'skill' | 'mcp') =>
  apiCall<{ targets?: InstallTarget[] }>(
    `/api/tools/install-targets?service=${encodeURIComponent(service)}&protocol=${protocol}`,
  )

export type ToolApiKey = { id?: string; name?: string; masked?: string }

export const fetchToolApiKeys = () => apiCall<{ keys?: ToolApiKey[] }>('/api/tools/api-keys')

export function installSkill(payload: { api_key_id: string; variant: string; clients: string[] }): Promise<InstallResult> {
  return apiCall<InstallResult>('/api/tools/install-skill', { method: 'POST', body: payload })
}

export function installMcp(payload: {
  service_id: string
  mode?: 'http' | 'bridge'
  api_key_id: string
  clients: string[]
}): Promise<InstallResult> {
  return apiCall<InstallResult>('/api/tools/install-mcp', { method: 'POST', body: payload })
}

export function uninstallSkill(payload: { service_id: string; clients: string[] }): Promise<InstallResult> {
  return apiCall<InstallResult>('/api/tools/uninstall-skill', { method: 'POST', body: payload })
}

export function uninstallMcp(payload: { service_id: string; clients: string[] }): Promise<InstallResult> {
  return apiCall<InstallResult>('/api/tools/uninstall-mcp', { method: 'POST', body: payload })
}

/** 把结果拆成「成功几个 / 失败哪几个」——面板侧的结果处理也是这个口径（`{label, error}`） */
export function splitOutcomes(results: InstallOutcome[] | undefined): {
  ok: number
  failed: Array<{ label: string; error: string }>
} {
  const list = results || []
  const failed = list
    .filter(item => Boolean(item.error))
    .map(item => ({ label: item.label || item.client || '—', error: String(item.error) }))
  return { ok: list.length - failed.length, failed }
}
