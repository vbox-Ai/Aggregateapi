import { apiCall } from './client'

/**
 * 出站指纹脱敏（`docs/mobile-ui/contracts/CONTENT.md` 的 sanitize.rs 一节）。
 *
 * 这块**最容易踩**的是三个键各自的「省略 / null / 空数组」语义，三者互不相同：
 *
 * | 键 | 省略 | `null` | `[]` |
 * |---|---|---|---|
 * | `sanitizeBlacklistFingerprints` | 不改 | 类型错误 | — |
 * | `sanitizeFingerprintRules` | **不改** | **恢复内置词表** | 空词表（什么都不替换） |
 * | `sanitizeFingerprintProviders` | **不改** | **清空 → 等于全部提供商** | 全部提供商 |
 *
 * 注意最后一行：`providers = null` **不等于**「不改」—— 它会被归一成空数组，
 * 而空数组的语义是「应用到**全部**提供商（含以后新增的插件）」，而且**会落盘**
 * （上游 `sanitize.rs:92-125`）。所以只想改开关时，body 里**不要出现**这个键 ——
 * 用「省略」表达，别用 null。
 *
 * 词表是**整表替换**：改一条也必须把完整数组发回去。
 */

export type SanitizeMatchType = 'literal' | 'regex'

/** 可作用的角色（上游 `SanitizeRole::ALL`，顺序即选项顺序） */
export type SanitizeRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool' | 'function'

export type SanitizeRule = {
  /** 1–64 位，仅 `[A-Za-z0-9_-]`，词表内不得重复 */
  id: string
  /** 1–128 字符 */
  name: string
  /** 默认 true；false 的规则留在词表里但不参与替换 */
  enabled?: boolean
  /** 默认 literal */
  matchType?: SanitizeMatchType
  /** 必填，非空白，≤4096 字符 */
  pattern: string
  /** ≤4096 字符，默认空串 */
  replacement?: string
  /** 默认 false；**只有「正则删除」规则（regex 且 replacement 为空）才能开** */
  repeat?: boolean
  /** 空数组表示沿用旧规则的全字段行为；指定角色时只改对应消息的正文 */
  roles?: SanitizeRole[]
}

export type SanitizeProviderOption = {
  id: string
  label: string
  count?: number
  category?: string
  source?: 'builtin' | 'plugin'
}

export type SanitizeLimits = {
  maxRules?: number
  maxNameChars?: number
  maxPatternChars?: number
  maxReplacementChars?: number
}

export type SanitizeSettings = {
  /** 默认 true */
  sanitizeBlacklistFingerprints?: boolean
  /** 当前生效词表（含 enabled=false 的条目） */
  sanitizeFingerprintRules?: SanitizeRule[]
  /** 空数组 = 全部提供商 */
  sanitizeFingerprintProviders?: string[]
  /** 内置词表全量 */
  defaultRules?: SanitizeRule[]
  /** true = 当前词表是用户自定义的；false = 用内置 */
  customRules?: boolean
  providerOptions?: SanitizeProviderOption[]
  roleOptions?: SanitizeRole[]
  limits?: SanitizeLimits
}

export type SanitizePatch = {
  sanitizeBlacklistFingerprints?: boolean
  /** 省略 = 不改；null = 恢复内置词表；[] = 空词表 */
  sanitizeFingerprintRules?: SanitizeRule[] | null
  /** 省略 = 不改；[] 或 null 都表示全部提供商 */
  sanitizeFingerprintProviders?: string[]
}

export const fetchSanitize = () => apiCall<SanitizeSettings>('/api/sanitize')
export const putSanitize = (body: SanitizePatch) =>
  apiCall<SanitizeSettings & { saved?: boolean }>('/api/sanitize', { method: 'PUT', body })

/** 默认限制（后端会在 `limits` 里给一份，这里只是取不到时的兜底） */
export const SANITIZE_LIMITS: Required<SanitizeLimits> = {
  maxRules: 200,
  maxNameChars: 128,
  maxPatternChars: 4096,
  maxReplacementChars: 4096,
}

/** 角色 → 中文标签 */
export function roleLabel(role: SanitizeRole, translate: (key: string) => string): string {
  if (role === 'system') return translate('系统')
  if (role === 'developer') return translate('开发者')
  if (role === 'user') return translate('用户')
  if (role === 'assistant') return translate('助手')
  if (role === 'tool') return translate('工具')
  return translate('函数')
}

/**
 * 校验一条规则，返回第一条错误文案；合法返回 null。
 *
 * 与上游 `RuleSet::compile` 同口径 —— 先在本地拦下，用户不必为一条能一眼看出的
 * 错误等一次往返。
 */
export function validateRule(
  rule: SanitizeRule,
  others: SanitizeRule[],
  limits: SanitizeLimits,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string | null {
  const maxName = limits.maxNameChars ?? SANITIZE_LIMITS.maxNameChars
  const maxPattern = limits.maxPatternChars ?? SANITIZE_LIMITS.maxPatternChars
  const maxReplacement = limits.maxReplacementChars ?? SANITIZE_LIMITS.maxReplacementChars

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(rule.id)) {
    return translate('规则 ID 只能包含字母、数字、下划线与连字符，长度 1–64')
  }
  if (others.some(item => item.id === rule.id)) return translate('规则 ID 不能重复')
  const name = rule.name.trim()
  if (!name || name.length > maxName) return translate('名称需要 1–{max} 个字符', { max: maxName })
  if (!rule.pattern.trim()) return translate('匹配内容不能为空')
  if (rule.pattern.length > maxPattern) return translate('匹配内容不能超过 {max} 个字符', { max: maxPattern })
  if ((rule.replacement || '').length > maxReplacement) {
    return translate('替换内容不能超过 {max} 个字符', { max: maxReplacement })
  }
  // 只有「正则删除」才能开重复清理（上游 rules.rs:144-147）
  if (rule.repeat && (rule.matchType !== 'regex' || (rule.replacement || '') !== '')) {
    return translate('「重复清理」只能用在「正则匹配 + 替换内容为空」的删除规则上')
  }
  if (rule.matchType === 'regex') {
    try {
      // 与网关同样的字面量校验：语法错的正则到后端也是 400
      new RegExp(rule.pattern)
    } catch {
      return translate('正则表达式语法有误')
    }
  }
  return null
}

/** 新规则的默认值（id 用时间戳保证唯一，用户可改） */
export function blankRule(): SanitizeRule {
  return {
    id: `rule-${Date.now().toString(36)}`,
    name: '',
    enabled: true,
    matchType: 'literal',
    pattern: '',
    replacement: '',
    repeat: false,
    roles: [],
  }
}
