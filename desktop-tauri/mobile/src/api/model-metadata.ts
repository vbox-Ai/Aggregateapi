import { apiCall } from './client'

/**
 * models.dev 模型元数据（`docs/mobile-ui/contracts/CONTENT.md` 的 model_meta.rs 一节）。
 *
 * 用 models.dev 补齐上游没声明的模型能力与思考档位。内嵌快照始终生效，这个开关
 * 只管**联网刷新**：关掉后 `refresh` 直接返回 `skipped`，已装载的索引继续用
 * （内存与库里都不清）。默认**开启**（只有字面 `false` 算关）。
 */

export type MetadataSource = 'builtin' | 'cache' | 'network'

export type ModelMetadataStatus = {
  /** 当前索引来历：内嵌快照 / 库里上次刷新的缓存 / 本次刚拉到 */
  source?: MetadataSource
  /** 索引生成时刻（毫秒）；未知为 0 */
  updatedAt?: number
  /** 索引里的模型条数 */
  count?: number
  /** 由 handler 注入；默认开 */
  modelsDevEnabled?: boolean
}

export const fetchModelMetadata = () => apiCall<ModelMetadataStatus>('/api/models/metadata')

export const putModelMetadata = (modelsDevEnabled: boolean) =>
  apiCall<ModelMetadataStatus>('/api/models/metadata', { method: 'PUT', body: { modelsDevEnabled } })

export type RefreshStatus = 'refreshed' | 'skipped' | 'failed'

export type RefreshResult = {
  provider?: string
  providerLabel?: string
  refreshedAt?: number
  status?: RefreshStatus
  /** 仅 status === 'refreshed' */
  count?: number
  /** skipped / failed 时的原因 */
  message?: string
  /** 仅「冷却中」的 skipped：下次可刷新的时刻 */
  retryAt?: number
}

/**
 * 手动刷新。**永远返回 2xx** —— 成败看 `result.status`，不是看 HTTP 状态码。
 * 另有 24 小时的手动刷新间隔（冷却中会回 `skipped` + `retryAt`）。
 */
export const refreshModelMetadata = () =>
  apiCall<{ result?: RefreshResult; status?: ModelMetadataStatus }>('/api/models/metadata/refresh', { method: 'POST' })

/** 索引来历 → 中文说明 */
export function sourceLabel(source: MetadataSource | undefined, translate: (key: string) => string): string {
  if (source === 'cache') return translate('库里缓存')
  if (source === 'network') return translate('本次联网刷新')
  return translate('内嵌快照')
}
