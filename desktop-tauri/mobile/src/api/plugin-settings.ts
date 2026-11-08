import { apiCall } from './client'

/**
 * 插件申报的管理面板对应的设置（`docs/mobile-ui/contracts/` 的 zcode_version.rs /
 * zcode_captcha_pool.rs / cline_headers.rs）。
 *
 * 三项都由插件在 `GET /api/plugins` 的 `adminPanels` 里申报后才在桌面上出现：
 * 『验证码令牌池』要 `captcha_pool`、『Cline 伪装头』要 `upstream_headers`。
 * 手机端沿用同一口径 —— 插件没装就不显示这些块，免得给出「改了没用」的开关。
 * ZCode 版本号不属申报面板，任何形态都能改（它只影响出站 URL 的 `?app_version=`）。
 */

// ── ZCode 客户端版本号 ────────────────────────────────────────

export type ZcodeVersionState = {
  version?: string
  /** 环境变量 `ZCODE_APP_VERSION` 的值；非空表示界面上的值此刻不生效 */
  envOverride?: string | null
}

/** 长度上限（上游 `MAX_LEN`） */
export const ZCODE_VERSION_MAX_LEN = 32

export const fetchZcodeVersion = () => apiCall<ZcodeVersionState>('/api/zcode/version')
/** 空串合法 = 清空覆盖，回落插件内置默认值 */
export const putZcodeVersion = (version: string) =>
  apiCall<ZcodeVersionState>('/api/zcode/version', { method: 'PUT', body: { version } })

/**
 * 本地校验：≤32 字符、字符合集 `[0-9A-Za-z._-]`、**首字符必须是数字**。
 * 空串合法（表示清空）。与上游 `zcode_version.rs:124-143` 同口径。
 */
export function validateZcodeVersion(
  value: string,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  const text = value.trim()
  if (!text) return null
  if (text.length > ZCODE_VERSION_MAX_LEN) {
    return translate('版本号不能超过 {max} 个字符', { max: ZCODE_VERSION_MAX_LEN })
  }
  if (!/^[0-9A-Za-z._-]+$/.test(text)) return translate('版本号只能包含字母、数字、点、下划线与连字符')
  if (!/^[0-9]/.test(text)) return translate('版本号必须以数字开头')
  return null
}

// ── 验证码令牌池补货节奏 ──────────────────────────────────────

export type CaptchaPoolSettings = {
  /** 库存目标（低于它才补铸），1–10，默认 3 */
  zcodeCaptchaPoolTarget?: number
  /** 铸造器轮询间隔毫秒，1000–30000，默认 2500 */
  zcodeCaptchaPoolPollMs?: number
  /** 单轮铸造上限，1–5，默认 1 */
  zcodeCaptchaPoolMaxPerRound?: number
}

export const CAPTCHA_POOL_FIELDS = [
  { key: 'zcodeCaptchaPoolTarget', min: 1, max: 10, fallback: 3 },
  { key: 'zcodeCaptchaPoolPollMs', min: 1000, max: 30000, fallback: 2500 },
  { key: 'zcodeCaptchaPoolMaxPerRound', min: 1, max: 5, fallback: 1 },
] as const satisfies ReadonlyArray<{ key: keyof CaptchaPoolSettings; min: number; max: number; fallback: number }>

export const fetchCaptchaPool = () => apiCall<CaptchaPoolSettings>('/api/zcode/captcha-pool')
/** 部分更新：只发要改的键（缺项 / null = 该项不改）；三项里任一非法则整体不落盘 */
export const putCaptchaPool = (body: CaptchaPoolSettings) =>
  apiCall<CaptchaPoolSettings>('/api/zcode/captcha-pool', { method: 'PUT', body })

// ── Cline 伪装头 ──────────────────────────────────────────────

export type ClineHeadersState = {
  /** 网关本地配置（不依赖插件） */
  overrides?: Record<string, string>
  /** 插件给的默认值；插件不在时为空表 */
  defaults?: Record<string, string>
  /** 最终生效的头；插件不在时为空表 */
  effective?: Record<string, string>
}

export const CLINE_LIMITS = { maxEntries: 64, maxKeyLen: 128, maxValueLen: 4096 } as const

/** 固定头：由协议层决定，不允许覆盖（大小写不敏感） */
export const CLINE_FIXED_HEADERS = ['authorization', 'content-type', 'accept', 'x-task-id'] as const

export const fetchClineHeaders = () => apiCall<ClineHeadersState>('/api/cline/headers')
/** **整体替换**（非 merge） */
export const putClineHeaders = (overrides: Record<string, string>) =>
  apiCall<ClineHeadersState>('/api/cline/headers', { method: 'PUT', body: { overrides } })

/**
 * 本地校验一组覆盖头。与上游 `cline_headers.rs:100-130` 同口径。
 *
 * 语义提醒（界面上也要写）：**空串 = 这个头不发**；从表里删掉某键 = 回落默认值。
 */
export function validateClineHeaders(
  entries: Array<{ name: string; value: string }>,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  const named = entries.filter(entry => entry.name.trim())
  if (named.length > CLINE_LIMITS.maxEntries) {
    return translate('最多 {max} 个自定义头', { max: CLINE_LIMITS.maxEntries })
  }
  const seen = new Set<string>()
  for (const entry of named) {
    const name = entry.name.trim()
    if (name.length > CLINE_LIMITS.maxKeyLen) {
      return translate('头名 {name} 超过 {max} 个字符', { name, max: CLINE_LIMITS.maxKeyLen })
    }
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
      return translate('头名「{name}」不是合法的头字段名', { name })
    }
    if (CLINE_FIXED_HEADERS.includes(name.toLowerCase() as (typeof CLINE_FIXED_HEADERS)[number])) {
      return translate('「{name}」是固定头，不能覆盖', { name })
    }
    if (seen.has(name.toLowerCase())) {
      return translate('头名「{name}」重复', { name })
    }
    seen.add(name.toLowerCase())
    if (entry.value.length > CLINE_LIMITS.maxValueLen) {
      return translate('头值不能超过 {max} 个字符', { max: CLINE_LIMITS.maxValueLen })
    }
    if (/[\r\n]/.test(name) || /[\r\n]/.test(entry.value)) {
      return translate('头名与头值不能包含换行')
    }
  }
  return null
}
