import { apiCall } from './client'

/**
 * 系统提示词（`docs/mobile-ui/contracts/CONTENT.md` 的 prompt.rs 一节）。
 *
 * 契约要点：
 *  · `GET/PUT /api/prompt`，**PUT 的响应与 GET 同形**，可以直接用返回值刷新界面（不必再 GET）。
 *  · 写入是**稀疏部分更新**：`promptProviders` / `promptGateway` / `promptGatewayText`
 *    三个 map 只发要改的那一家（值传 `null` 表示删掉这一家 / 回默认 / 回官方原文）。
 *  · `promptText` 传**空串 = 清除**界面正文（不是「不改」），`null` 才是「不改」。
 *  · `promptMode` 只认 `passthrough` / `custom` / `append`（大小写不敏感、空串按透传）。
 *  · 生效口径（`config/mod.rs` 的 `resolve_choice`）：只有 `custom`/`append` 才读文件；
 *    正文非空时以正文为准（`inline`），否则读文件（`file`），读不到回落内置（`builtin`）。
 *    `passthrough` 下 `promptSource` 恒为 `none`。
 */

export type PromptMode = 'passthrough' | 'custom' | 'append'
export type PromptSource = 'none' | 'builtin' | 'file' | 'inline'

/** 网关自带提示词的三段（顺序固定，段名是上游常量 `GatewayBlocks::FIELDS`） */
export const GATEWAY_SEGMENTS = ['identity', 'stable', 'dynamic'] as const
export type GatewaySegment = (typeof GATEWAY_SEGMENTS)[number]
export type GatewayBlocks = Partial<Record<GatewaySegment, string>>

/** 动态段支持的占位符（发请求时才换真值） */
export const GATEWAY_PLACEHOLDERS = ['{cwd}', '{platform}', '{shell}', '{os_version}', '{git}', '{provider}', '{model}'] as const

export type PromptProviderEntry = {
  promptMode?: PromptMode
  promptFile?: string
  promptText?: string
  /** 这家**生效**的正文来源 */
  promptSource?: PromptSource
  promptLines?: number
  promptFileError?: string | null
}

export type PromptProviderOption = {
  id: string
  label: string
  /** 非空说明这家有网关提示词装配 */
  gatewayNote?: string | null
  gatewayChars?: number | null
  /** 官方原文（编辑器的初始值与「恢复官方原文」的目标） */
  gatewayBlocks?: GatewayBlocks | null
}

export type PromptSettings = {
  promptMode?: PromptMode
  promptFile?: string
  promptText?: string
  promptSource?: PromptSource
  promptFileError?: string | null
  promptLines?: number
  degradeActive?: boolean
  degradeUntil?: number
  degradeUntilText?: string
  /** 只含**配过的家** */
  promptProviders?: Record<string, PromptProviderEntry>
  /** 只含**被明确拨过**的家；键缺失 = 默认装 */
  promptGateway?: Record<string, boolean>
  /** 只含**改过的段** */
  promptGatewayText?: Record<string, GatewayBlocks>
  /** 注册表全量（下拉用） */
  promptProviderOptions?: PromptProviderOption[]
}

export type PromptPatch = {
  promptMode?: PromptMode
  /** 空串 = 清除；null = 不改（前端不编辑文件路径，保留字段以备将来） */
  promptFile?: string | null
  /** 空串 = 清除界面正文 */
  promptText?: string | null
  /** 值 null = 删掉这一家（回落全局） */
  promptProviders?: Record<string, PromptProviderEntry | null>
  /** 值 null = 删键回默认（装） */
  promptGateway?: Record<string, boolean | null>
  /** 值 null = 回官方原文 */
  promptGatewayText?: Record<string, GatewayBlocks | null>
  /** 独立动作：立刻解除内容拦截降级期 */
  clearDegrade?: boolean
}

export const fetchPrompt = () => apiCall<PromptSettings>('/api/prompt')
export const putPrompt = (body: PromptPatch) => apiCall<PromptSettings>('/api/prompt', { method: 'PUT', body })

/** 模式 → 中文标签（与桌面端同一套说法） */
export function promptModeLabel(mode: PromptMode, translate: (key: string) => string): string {
  if (mode === 'custom') return translate('自定义')
  if (mode === 'append') return translate('追加')
  return translate('透传')
}

/** 正文来源 → 中文说明 */
export function promptSourceLabel(source: PromptSource | undefined, translate: (key: string) => string): string {
  if (source === 'builtin') return translate('内置默认提示词')
  if (source === 'file') return translate('提示词文件')
  if (source === 'inline') return translate('界面正文')
  return translate('不注入（原样透传）')
}

/** 读某家「网关装配开关」：键缺失 = 默认装 */
export function gatewayEnabled(settings: PromptSettings, providerId: string): boolean {
  const map = settings.promptGateway || {}
  return Object.prototype.hasOwnProperty.call(map, providerId) ? map[providerId] !== false : true
}

/** 取某家三段的值：改过的用改过的，没改过的回落官方原文 */
export function gatewayBlocksOf(
  settings: PromptSettings,
  option: PromptProviderOption,
): { text: GatewayBlocks; edited: boolean } {
  const edited = (settings.promptGatewayText || {})[option.id]
  if (edited) return { text: edited, edited: true }
  return { text: option.gatewayBlocks || {}, edited: false }
}
