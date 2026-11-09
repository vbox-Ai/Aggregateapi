/**
 * 上下文压缩路由（模型页）。
 *
 * ── 这一项的政策由上游决定，界面只负责别把话说错 ──────────────
 *  · **目前只支持 ZCode 客户端**（`CLIENT_ZCODE`）：服务端校验会直接拒绝别家
 *    （「压缩路由目前只支持 ZCode 客户端」），所以界面上不给客户端选择器；
 *  · **整块保存 + 修订号防覆盖**：GET 回来的 `revision` 是那份配置的 SHA-256，
 *    PUT 必须原样带回；别处改过就 409
 *    「压缩路由已在其他位置修改，请重新读取后再保存；当前草稿未丢失」；
 *  · 来源模型 / 压缩模型必须是**当前可用的模型**（`validate_models`）；
 *    例外的只有"已失效的旧规则"：它可以保留、关闭或删除，但**不能**把失效目标
 *    当作新选择或重新启用。
 *
 * 本地校验的文案与上游逐条对齐（这样用户先看到的是同一句话，而不是两个版本）。
 */
import { apiCall } from './client'
import { t } from '../i18n'

export const COMPACT_CLIENT_ZCODE = 'zcode'
export const COMPACT_MAX_RULES = 200

export type CompactRoute = {
  client: string
  source: string
  target: string
  enabled: boolean
}

export type CompactRoutesConfig = {
  enabled: boolean
  rules: CompactRoute[]
}

export type CompactRoutesView = {
  config: CompactRoutesConfig
  revision: string
  clients?: Array<{ id?: string; label?: string }>
  /** 可选的模型（上游已滤掉图片模型） */
  models?: Array<{ id?: string; label?: string; name?: string; kind?: string }>
  maxRules?: number
}

export function fetchCompactRoutes(signal?: AbortSignal): Promise<CompactRoutesView> {
  return apiCall<CompactRoutesView>('/api/models/compact-routes', { signal })
}

/** 整块保存。`revision` 必须是这份草稿**基于**的那次读取的修订号。 */
export function saveCompactRoutes(config: CompactRoutesConfig, revision: string): Promise<CompactRoutesView> {
  return apiCall<CompactRoutesView>('/api/models/compact-routes', {
    method: 'PUT', body: { config, revision },
  })
}

/** 与上游 `config/compact_routes.rs::model_key` 同一口径（判重、判相同都用它） */
export function compactModelKey(model: string): string {
  return model.trim().toLowerCase()
}

/**
 * 本地校验：返回 null 表示通过，否则返回**与上游同文案**的原因。
 *
 * 上游还会做两件本地做不到的事：模型是否可用（要当前模型清单）、以及修订号比对。
 * 那两件交给服务端，界面照它的报错显示。
 */
export function validateCompactRoutes(config: CompactRoutesConfig): string | null {
  const max = COMPACT_MAX_RULES
  if (config.rules.length > max) return t('压缩路由最多允许 {n} 条规则', { n: max })
  const seen = new Set<string>()
  for (const rule of config.rules) {
    if (rule.client !== COMPACT_CLIENT_ZCODE) return t('压缩路由目前只支持 ZCode 客户端')
    for (const model of [rule.source, rule.target]) {
      if (!model.trim()) return t('来源模型和压缩模型必须完整填写，模型 ID 不能超过 256 个字符或含控制字符')
      if (model.trim() !== model || [...model].length > 256 || /[\u0000-\u001f\u007f]/.test(model)) {
        return t('来源模型和压缩模型必须完整填写，模型 ID 不能超过 256 个字符或含控制字符')
      }
    }
    if (compactModelKey(rule.source) === compactModelKey(rule.target)) return t('来源模型和压缩模型不能相同')
    const key = `${rule.client}:${compactModelKey(rule.source)}`
    if (seen.has(key)) return t('同一客户端的来源模型不能重复：{model}', { model: rule.source })
    seen.add(key)
  }
  return null
}
