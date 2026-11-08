import { apiCall } from './client'

/**
 * 自定义提供商（设置页「自定义提供商」区域）。
 *
 * 契约见 `api/custom_providers.rs`：
 * - `POST /api/custom-providers` **一次事务建齐提供商 + 首个账号**（带 apiKey）
 * - `POST /api/custom-providers/models` 整表保存模型清单与映射
 * - `POST /api/custom-providers/fetch-models` 服务端代理拉上游清单（真打上游）
 */

export type CustomProvider = {
  id: string
  name: string
  protocol: string
  baseUrl: string
  enabled: boolean
  createdAt: number
  models: Array<{ id: string; enabled: boolean; reasoning: string }>
  mappings: Array<{ alias: string; target: string; enabled: boolean }>
  urlSuffix?: string
  headers?: Record<string, string>
  anthropicToolType?: string
  clientEmulation?: string
  balanceScheme?: string
  [key: string]: unknown
}

export type CustomProviderList = { providers: CustomProvider[] }

/** 拉取全部自定义提供商（按创建时间升序） */
export function fetchCustomProviders(): Promise<CustomProviderList> {
  return apiCall<CustomProviderList>('/api/custom-providers')
}

/**
 * 新建自定义提供商。
 *
 * `apiKey` 会在同一个事务里成为名下第一个账号的凭证；请求体里其余字段
 * （`name` / `protocol` / `baseUrl` 与各预置修正项）原样交给网关校验。
 */
export function createCustomProvider(payload: Record<string, unknown>): Promise<{
  provider?: CustomProvider
  account?: unknown
  created?: boolean
}> {
  return apiCall('/api/custom-providers', { method: 'POST', body: payload })
}

/** 更新提供商属性：只传要改的字段 */
export function updateCustomProvider(id: string, patch: Record<string, unknown>): Promise<{
  provider?: CustomProvider
}> {
  return apiCall('/api/custom-providers/update', { method: 'POST', body: { id, ...patch } })
}

/**
 * 删除提供商：级联删除名下全部账号，并把这家的 id 从各 Key 的可用提供商
 * 白名单里摘掉。**不可恢复**，调用方必须先确认。
 */
export function removeCustomProvider(id: string): Promise<unknown> {
  return apiCall('/api/custom-providers/remove', { method: 'POST', body: { id } })
}

/** 服务端代理拉取上游模型清单（不落盘，返回的是纯读结果） */
export function fetchCustomProviderModels(providerId: string): Promise<{
  models: string[]
  provider?: CustomProvider
}> {
  return apiCall('/api/custom-providers/fetch-models', { method: 'POST', body: { providerId } })
}

/** 整表保存模型清单与映射 */
export function saveCustomProviderModels(
  providerId: string,
  models: CustomProvider['models'],
  mappings: CustomProvider['mappings'],
): Promise<{ provider?: CustomProvider }> {
  return apiCall('/api/custom-providers/models', {
    method: 'POST',
    body: { providerId, models, mappings },
  })
}

/** 提供商支持的协议清单（网关侧校验用的最小集合；预置卡可扩展） */
export const PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic 兼容' },
  { value: 'gemini', label: 'Gemini 兼容' },
] as const
