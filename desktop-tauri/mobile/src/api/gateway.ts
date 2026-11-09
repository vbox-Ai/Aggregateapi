/**
 * 网关 API 的类型与薄封装。
 *
 * 只声明**移动端真正读到**的字段（后端还会给更多，这里按 unknown 收）。
 * 字段名一律照后端契约（`record.rs` / `session.rs` / `checkin_center.rs`），
 * 不在前端另起一套命名 —— 改口径要能一眼看出改的是哪一边。
 */

import { ApiError, apiCall, authHeaders, refreshPanelAuthIfExpiring, resolveUrl } from './client'
import { dateStamp } from '../lib/download'
import type { ProxyUsage } from '../../../ui-shared/proxy-usage'
import type { CheckinCenter } from '../../../ui-shared/checkin'
import type { HiddenAccountsSummary } from '../../../ui-shared/plugins'
import type { AccountSorting } from '../../../ui-shared/account-sorting'
import { logQueryString, type LogPage, type LogQuery } from '../../../ui-shared/logs'

export type { LogEntry, LogPage } from '../../../ui-shared/logs'

export type { CheckinAccount, CheckinCenter, ProviderGroup as CheckinProviderRow } from '../../../ui-shared/checkin'

/* ─── 会话 / 账号 ─────────────────────────────── */

export type ProviderSummary = { id?: string; label?: string; count?: number; category?: 'agent' | 'web'; source?: 'builtin' | 'plugin' }

export type RateLimitInfo = {
  status?: number | string
  code?: string | number
  resetAt?: number
  message?: string
}

export type Account = {
  id: string
  provider?: string
  name?: string
  displayName?: string
  nameCustom?: boolean
  nickname?: string
  email?: string
  enabled?: boolean
  available?: boolean
  hasCredentials?: boolean
  priority?: number
  edition?: string
  editionLabel?: string
  tokenExpiresAt?: number
  expiresAt?: number
  hasAccessToken?: boolean
  accessTokenExpiresAt?: number | null
  hasRefreshToken?: boolean
  refreshTokenLongLived?: boolean
  refreshExpiresAt?: number | null
  refreshTokenExpiresAt?: number | null
  needsRelogin?: boolean
  needsReloginReason?: string
  /** 智谱清言：这条账号是不是访客（后端只对本家注入；访客没有积分体系，不查余额） */
  isGuest?: boolean
  /** 按模型记的限流记录 */
  rateLimits?: Record<string, RateLimitInfo>
  upstreamCooldownUntil?: number | null
  upstreamBlockedReason?: string
  [key: string]: unknown
}

export type SessionPayload = {
  health?: {
    upstreamConfigured?: boolean
    upstreamBaseUrl?: string | null
    authSource?: string | null
    unavailableReason?: string | null
  }
  session?: unknown
  accounts?: {
    currentAccountId?: string | null
    currentAccountIds?: Record<string, string | null>
    accounts?: Account[]
    providers?: ProviderSummary[]
    hiddenAccounts?: HiddenAccountsSummary
    sorting?: AccountSorting
  }
  accountFeatures?: Record<string, unknown>
  lastRequestModel?: string | null
  routedAccountId?: string | null
  defaultModel?: string | null
  proxies?: { optionCount?: number; clashAvailable?: boolean; clashError?: string | null }
  models?: Array<{ id?: string; name?: string; provider?: string; providerLabel?: string }>
}

export function fetchSession(signal?: AbortSignal): Promise<SessionPayload> {
  return apiCall<SessionPayload>('/api/session', { signal })
}

/** 账号列表（`GET /api/accounts` 返回的就是快照形状） */
export function fetchAccounts(signal?: AbortSignal): Promise<{
  accounts?: Account[]
  providers?: ProviderSummary[]
  hiddenAccounts?: HiddenAccountsSummary
  sorting?: AccountSorting
  currentAccountId?: string | null
  currentAccountIds?: Record<string, string | null>
}> {
  return apiCall('/api/accounts', { signal })
}

export function setAccountEnabled(id: string, enabled: boolean): Promise<unknown> {
  return apiCall(`/api/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled } })
}

/**
 * 粘贴 / 导入凭证（authFileContent 通道）。
 *
 * 桌面端「导入凭证文件」走的就是同一个 POST /api/accounts：
 * body { provider, authFileContent, authFileName, name }。
 * 不要求提供商声明动态登录方式，适合 501 / 未声明 provider。
 */
export type AccountFileImportPayload = {
  provider?: string
  authFileContent: string
  authFileName?: string
  name?: string
}

export async function addAccountByFile(payload: AccountFileImportPayload): Promise<{
  account?: { id?: string; provider?: string }
  warning?: string
}> {
  return apiCall('/api/accounts', {
    method: 'POST',
    body: {
      ...payload,
      authFileName: payload.authFileName || '粘贴导入.json',
    },
  })
}

/**
 * 导出全部账号（含 token 与自定义提供商定义）。
 *
 * `GET /api/accounts/export` 是明文 JSON —— 桌面端只把它写进用户选的文件，
 * 手机端同样只落成本地文件，不进 localStorage、不进日志。
 */
/**
 * 批量操作账号（`POST /api/accounts/batch`）。
 *
 * 行动语义见 `accounts_batch.rs`：`remove` / `enable` / `disable` 是最常用的三条；
 * 响应里带 `list`，调用方直接刷新列表即可。
 */
export function batchAccounts(action: 'remove' | 'enable' | 'disable', ids: string[]): Promise<unknown> {
  return apiCall('/api/accounts/batch', { method: 'POST', body: { ids, action } })
}

export function exportAccounts(): Promise<unknown> {
  return apiCall('/api/accounts/export')
}

/**
 * 导出单账号 / 本组账号的逐账号文件。
 *
 * 传 `id` 给一个账号，传 `provider` 给这一家的全部账号 —— 两个都传会以 `id` 为准
 * （服务端判定顺序如此，见 accounts_export.rs）。
 */
export function exportAccountFile(selector: { id?: string; provider?: string }): Promise<unknown> {
  return apiCall('/api/accounts/export-files', { method: 'POST', body: selector })
}

/**
 * 批量导入账号（merge 语义：同身份命中则更新凭证，未命中则追加）。
 *
 * 手机端「重新粘贴凭证」走这条：贴进来的账号文件解析成对象后，用同一个 id
 * 再导一次就是更新，不用先删后建。
 */
export function importAccounts(accounts: unknown[]): Promise<unknown> {
  return apiCall('/api/accounts/import', { method: 'POST', body: { accounts } })
}

export function deleteAccount(id: string): Promise<unknown> {
  return apiCall(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function refreshAccount(id: string): Promise<unknown> {
  return apiCall('/api/accounts/refresh', { method: 'POST', body: { id } })
}

export function refreshExpiringAccounts(): Promise<unknown> {
  return apiCall('/api/accounts/refresh-expiring', { method: 'POST' })
}

/* ─── 报表 ─────────────────────────────────────── */

export type StatsOverview = {
  requests?: number
  successful?: number
  tokens?: number
  activeDays?: number
  streak?: number
  topModel?: { model?: string; tokens?: number; percentage?: number } | null
}

export type StatsDimension = {
  id?: string
  label?: string
  requests?: number
  success?: number
  failures?: number
  totalTokens?: number
  tokens?: number
  percentage?: number
  model?: string
  successRate?: number | null
  promptTokens?: number | null
  completionTokens?: number | null
  cacheReadTokens?: number | null
  cacheRate?: number | null
  lastUsedAt?: number | null
  tokenDetailsComplete?: boolean
  source?: string
  filterValue?: string
  state?: 'enabled' | 'disabled' | 'deleted'
}

export type StatsDay = {
  date?: string; tokens?: number; requests?: number
  models?: StatsDimension[]; clients?: StatsDimension[]; apiKeys?: StatsDimension[]
}

export type StatsSummary = {
  range?: string
  startDate?: string
  endDate?: string
  overview?: StatsOverview
  providers?: StatsDimension[]
  accounts?: StatsDimension[]
  models?: StatsDimension[]
  clients?: StatsDimension[]
  apiKeys?: StatsDimension[]
  apiKeyDetail?: { filterValue?: string; label?: string; requests?: number; totalTokens?: number; detailsComplete?: boolean; clients?: StatsDimension[]; models?: StatsDimension[] } | null
  cacheRates?: Record<string, { rate?: number; inputTokens?: number; hitTokens?: number } | number | null>
  dailyTrend?: StatsDay[]
  cacheTrend24h?: unknown
}

export type StatsRange = 'today' | 'yesterday' | '7' | '30' | 'month' | 'all' | 'custom'

export function fetchStatsSummary(range: StatsRange, signal?: AbortSignal, options?: {
  apiKey?: string; startDate?: string; endDate?: string
}): Promise<StatsSummary> {
  const query = new URLSearchParams({ range })
  for (const [key, value] of Object.entries(options || {})) if (value) query.set(key, value)
  return apiCall<StatsSummary>(`/api/stats/summary?${query}`, { signal })
}

/* ─── 请求日志 ─────────────────────────────────── */

export type AttemptDetail = { provider?: string; status?: number; error?: string }

export type RequestRow = {
  clientLabel?: string
  clientEvidence?: import('../../../ui-shared/client-identification').ClientEvidence
  ts?: number
  id?: string
  model?: string
  accountId?: string
  accountName?: string
  status?: number
  durationMs?: number
  firstResponseMs?: number | null
  attempts?: number
  error?: string | null
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  provider?: string
  providerLabel?: string
  clientModel?: string
  upstreamModel?: string
  attemptDetails?: AttemptDetail[]
  sensitiveHits?: Array<{ word?: string; count?: number }>
  route?: unknown
  client?: string
  isTest?: boolean
  apiKeyId?: string; apiKeyName?: string; apiKeySource?: string
}

export type RequestPage = {
  entries?: RequestRow[]
  total?: number
  matched?: number
  running?: number
}

export function fetchRequests(
  params: {
    offset?: number
    limit?: number
    /** 后端只认这三个值，其余忽略（见 report::normalize_status_filter） */
    status?: 'ok' | 'error' | 'running'
    model?: string
    provider?: string
    client?: string
    apiKey?: string
    startDate?: string
    endDate?: string
    productionOnly?: string
    completedOnly?: string
  },
  signal?: AbortSignal,
): Promise<RequestPage> {
  const query = new URLSearchParams()
  if (params.offset) query.set('offset', String(params.offset))
  if (params.limit) query.set('limit', String(params.limit))
  if (params.status) query.set('status', params.status)
  if (params.model) query.set('model', params.model)
  if (params.provider) query.set('provider', params.provider)
  if (params.client !== undefined) query.set('client', params.client)
  for (const key of ['apiKey', 'startDate', 'endDate', 'productionOnly', 'completedOnly'] as const) {
    if (params[key] !== undefined) query.set(key, params[key] as string)
  }
  const suffix = query.toString()
  return apiCall<RequestPage>(`/api/stats/requests${suffix ? `?${suffix}` : ''}`, { signal })
}

/* ─── 运行日志 ─────────────────────────────────── */

export function fetchLogs(params: LogQuery, signal?: AbortSignal): Promise<LogPage> {
  return apiCall<LogPage>(`/api/logs?${logQueryString({ limit: 60, ...params })}`, { signal })
}

/**
 * 日志总量读数（`GET /api/logs/stats`，处理器 `logs_api::stats_logs`）。
 *
 * 形状来自上游 `store.stats()`（桌面端 `LogStats` 与之一致），只两枚数字：
 *   · `total`  —— 当前库里的日志条数（用来做概览，替换掉「当前页 N 条」这种误导读数）
 *   · `lastId` —— 最新一条的自增 id（桌面端用它做「有没有新错误」的水位线）
 *
 * 响应里还会附一段词典（`attach_dictionary`），界面不用它，忽略即可。
 */
export type LogStats = { total?: number; lastId?: number }

export function fetchLogStats(signal?: AbortSignal): Promise<LogStats> {
  return apiCall<LogStats>('/api/logs/stats', { signal })
}

/**
 * 下载网关的**运行日志文件**（`api/logs_api::download_logs`）。
 *
 * 与「导出」的区别（这是两件不同的事，界面上分成两个动作）：
 *   · `fetchLogs` + 客户端导出 = 数据库里**筛选后的条目**，落成 JSON；
 *   · 本函数 = 网关**日志文件本身**（`Content-Disposition: attachment`），
 *     保留原始行格式，适合整份贴给上游排查。
 *
 * ── 为什么不用 `apiCall` ────────────────────────────────────
 * 这个端点回的是**纯文本文件**，不是 `{success,data}` 信封；`apiCall` 按 JSON 解析
 * 会直接失败。所以这里用 `resolveUrl` + `authHeaders` 自己发一次，再把正文读出来。
 *
 * ⚠️ 查询参数沿用列表那一套（`logQueryString`）——`download_logs` 与 `query_logs`
 * 同模块，路由表里也只能看到路径。**过滤是否生效待真机核对**：不生效的话最坏结果是
 * 「下载到的是整份日志」，不影响拿到内容。若后端回的是 JSON（错误信封），这里会
 * 把里面的错误信息抛出来，不会把 JSON 当日志存成文件。
 */
export async function downloadLogsFile(query: LogQuery): Promise<{ text: string; filename: string }> {
  await refreshPanelAuthIfExpiring()
  const response = await fetch(resolveUrl(`/api/logs/download?${logQueryString(query)}`), {
    headers: authHeaders(),
  })
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok || contentType.includes('application/json')) {
    let message = `导出日志失败（HTTP ${response.status}）`
    try {
      const payload = (await response.json()) as { error?: unknown; message?: unknown }
      const detail = payload?.error ?? payload?.message
      if (typeof detail === 'string' && detail) message = detail
    } catch {
      /* 不是 JSON 就保留状态码文案 */
    }
    throw new ApiError(message, response.status)
  }
  const text = await response.text()
  return { text, filename: attachmentName(response.headers.get('content-disposition')) || `agent2api-logs-${dateStamp()}.log` }
}

/** 从 `Content-Disposition` 取文件名；两种写法都认（`filename*=` 优先，RFC 5987） */
function attachmentName(header: string | null): string {
  if (!header) return ''
  const extended = /filename\*\s*=\s*([^;]+)/i.exec(header)
  if (extended) {
    const raw = extended[1].trim().replace(/^"(.*)"$/, '$1')
    const parts = raw.split("''")
    const encoded = parts.length > 1 ? parts[1] : raw
    try {
      return decodeURIComponent(encoded)
    } catch {
      return encoded
    }
  }
  const plain = /filename\s*=\s*"([^"]+)"/i.exec(header) || /filename\s*=\s*([^;]+)/i.exec(header)
  return plain ? plain[1].trim() : ''
}

/* ─── 签到中心 ─────────────────────────────────── */

export function fetchCheckinCenter(signal?: AbortSignal): Promise<CheckinCenter> {
  return apiCall<CheckinCenter>('/api/checkin-center', { signal })
}

/* ─── 模型管理 ─────────────────────────────────── */

export type ManageModel = {
  id?: string
  name?: string
  provider?: string
  providerLabel?: string
  source?: string
  kind?: string
  supports_image_generation?: boolean
  supports_image_editing?: boolean
  enabled?: boolean
  aliases?: string[]
  visibility?: string | null
  upstreamStatus?: 'undeployed' | null
  capabilities?: unknown
  reasoningLevels?: unknown
  reasoningDefaultLevel?: unknown
  reasoningFixedLevel?: unknown
  reasoningBindingSupported?: unknown
  reasoningSource?: unknown
  refreshedAt?: unknown
}

export type ManageMapping = {
  alias?: string
  target?: string
  provider?: string
  enabled?: boolean
  isDefault?: boolean
  /**
   * 这条映射**挂不到任何模型行**（目标上游不在清单里 = `dangling`，
   * `carried: false` 时说明该上游已下线 / 改了 ID）。见桌面端
   * `models-dangling.tsx` 的说明 —— 手机端只在模型页顶部提示 + 清理。
   */
  dangling?: boolean
  carried?: boolean
}
export type ManageView = { models?: ManageModel[]; mappings?: ManageMapping[] }

export function fetchManage(signal?: AbortSignal): Promise<ManageView> {
  return apiCall<ManageView>('/api/models/manage', { signal })
}

export function setModelEnabled(payload: {
  id: string
  provider: string
  enabled: boolean
}): Promise<ManageView> {
  return apiCall<ManageView>('/api/models/state', { method: 'POST', body: payload })
}

/**
 * 删除一条映射（三元组定位）。手机端只用于清理「未挂载映射」——
 * 常规的映射编辑仍在桌面端「模型管理」里做。
 */
export function removeModelMapping(payload: {
  alias: string
  target: string
  provider?: string
}): Promise<ManageView> {
  return apiCall<ManageView>('/api/models/mappings/remove', { method: 'POST', body: payload })
}

export function refreshModels(): Promise<unknown> {
  return apiCall('/api/models/refresh', { method: 'POST' })
}

/**
 * 登记一个自定义模型（`api/model_manage.rs` 的 `add_custom`）。
 *
 * `POST /api/models/custom { provider, id }` —— 载荷只有这两个字段，
 * 契约取自网关二进制里内嵌的面板 JS（`addCustomModel(provider, id)`）。
 *
 * **只服务内置家**：自定义提供商的模型清单走 `/api/custom-providers/models`
 * 整表保存（面板侧对此有单独的分支），这里不要传自定义提供商。
 */
export function addCustomModel(payload: { provider: string; id: string }): Promise<ManageView> {
  return apiCall<ManageView>('/api/models/custom', { method: 'POST', body: payload })
}

/** 移除一条自定义模型登记：`POST /api/models/custom/remove { provider, id }` */
export function removeCustomModel(payload: { provider: string; id: string }): Promise<ManageView> {
  return apiCall<ManageView>('/api/models/custom/remove', { method: 'POST', body: payload })
}

/**
 * 这个模型能不能移除。
 *
 * 照抄面板侧 `function o7(e){ return e.source === "manual" || as(e.provider) }` 的
 * **前半条**：`source === 'manual'`（手动登记的自定义模型）。
 * 后半条（自定义提供商的模型）手机端不在这里做 —— 那种清单是在
 * 「自定义提供商」页里整表保存的，从这个入口删会和那边打架。
 */
export function isManualModel(model: ManageModel): boolean {
  return model.source === 'manual'
}

/* ─── 网关 Key ─────────────────────────────────── */

export type GatewayKey = {
  id?: string
  name?: string
  key?: string
  masked?: string
  enabled?: boolean
  createdAt?: number
  allowedProviders?: string[]
  allowedModels?: string[]
}

export type KeysPayload = {
  keys?: GatewayKey[]
  authRequired?: boolean
  providers?: ProviderSummary[]
  modelsByProvider?: Record<string, string[]>
}

export function fetchKeys(signal?: AbortSignal): Promise<KeysPayload> {
  return apiCall<KeysPayload>('/api/keys', { signal })
}

export type KeyCreatePayload = {
  name?: string
  key?: string
  allowedProviders?: string[]
  allowedModels?: string[]
}

export type KeyUpdatePayload = {
  name?: string
  enabled?: boolean
  allowedProviders?: string[]
  allowedModels?: string[]
}

export function createKey(payload: KeyCreatePayload): Promise<KeysPayload> {
  return apiCall<KeysPayload>('/api/keys', { method: 'POST', body: payload })
}

export function updateKey(id: string, payload: KeyUpdatePayload): Promise<KeysPayload> {
  return apiCall<KeysPayload>(`/api/keys/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload })
}

export function setKeyEnabled(id: string, enabled: boolean): Promise<KeysPayload> {
  return apiCall<KeysPayload>(`/api/keys/${encodeURIComponent(id)}`, { method: 'PATCH', body: { enabled } })
}

export function deleteKey(id: string): Promise<KeysPayload> {
  return apiCall<KeysPayload>(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/* ─── 网络代理 ─────────────────────────────────── */

export type PoolItem = ProxyUsage & {
  id: string
  name: string
  source: string
  enabled: boolean
  sourceEnabled?: boolean
  localDisabled?: boolean
  listenerUid?: string
  protocol: string
  host: string
  port: number | null
  username: string
  password: string
  resolved?: { protocol?: string; host?: string; port?: number | null; label?: string } | null
  resolveError?: string | null
  lastTest?: { at?: number; success?: boolean; ip?: string; error?: string; durationMs?: number } | null
}

export type PoolPayload = { items?: PoolItem[]; clash?: import('../../../ui-shared/clash-proxy').ClashProxySnapshot; changes?: number; syncError?: string | null }
export type ProxyDraft = Pick<PoolItem, 'name' | 'protocol' | 'host' | 'port' | 'username' | 'password' | 'enabled'>
export type ProxyTestResult = PoolPayload & {
  success?: boolean
  error?: string
  ip?: string
  durationMs?: number
  saveError?: string
}
export type ProxySettings = { testUrl?: string; defaults?: { testUrl?: string } }

export function fetchProxyPool(signal?: AbortSignal): Promise<PoolPayload> {
  return apiCall<PoolPayload>('/api/proxies/pool', { signal })
}

export function syncClashProxies(): Promise<PoolPayload> {
  return apiCall('/api/proxies/pool/sync-clash', { method: 'POST' })
}

export function saveProxyItem(draft: ProxyDraft, id?: string): Promise<PoolPayload> {
  return apiCall<PoolPayload>(id ? '/api/proxies/pool/update' : '/api/proxies/pool', {
    method: 'POST', body: { ...draft, source: 'manual', ...(id ? { id } : {}) },
  })
}

export function removeProxyItem(id: string): Promise<PoolPayload> {
  return apiCall<PoolPayload>('/api/proxies/pool/remove', { method: 'POST', body: { id } })
}

export function setProxyEnabled(id: string, enabled: boolean): Promise<PoolPayload> {
  return apiCall<PoolPayload>('/api/proxies/pool/enable', { method: 'POST', body: { id, enabled } })
}

export function testProxy(id: string): Promise<ProxyTestResult> {
  return apiCall('/api/proxies/pool/test', { method: 'POST', body: { id } })
}

export function testProxyDraft(draft: ProxyDraft): Promise<ProxyTestResult> {
  return apiCall('/api/proxies/test', { method: 'POST', body: { proxy: { ...draft, source: 'custom' } } })
}

export function fetchProxySettings(): Promise<ProxySettings> {
  return apiCall('/api/proxies/settings')
}

export function saveProxySettings(testUrl: string): Promise<ProxySettings> {
  return apiCall('/api/proxies/settings', { method: 'POST', body: { testUrl } })
}

/* ─── 定时任务 ─────────────────────────────────── */

export type ScheduledTask = {
  id?: string
  label?: string
  description?: string
  unit?: string
  runner?: 'backend' | 'frontend'
  enabled?: boolean
  interval?: number
  min?: number
  max?: number
  defaultInterval?: number
  running?: boolean
  lastRunAt?: number | null
  lastSuccessAt?: number | null
  lastResult?: string | null
  lastError?: string | null
  nextRunAt?: number | null
  canRun?: boolean
}

export function fetchScheduledTasks(signal?: AbortSignal): Promise<{ tasks?: ScheduledTask[] }> {
  return apiCall<{ tasks?: ScheduledTask[] }>('/api/scheduled-tasks', { signal })
}

export function patchScheduledTask(
  id: string,
  patch: { enabled?: boolean; interval?: number },
): Promise<ScheduledTask> {
  return apiCall(`/api/scheduled-tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
}

export function runScheduledTask(id: string): Promise<unknown> {
  return apiCall(`/api/scheduled-tasks/${encodeURIComponent(id)}/run`, { method: 'POST' })
}

/* ─── Agent 接管 ───────────────────────────────── */

export type AgentClient = {
  resources?: import('../../../ui-shared/agent-resources').ResourceCapabilities
  id?: string
  name?: string
  resolvedPath?: string
  configPath?: string
  viaGateway?: boolean
  configMode?: string
  installed?: boolean
  readError?: string | null
  needsRestart?: boolean
  detectionState?: string
  supportNote?: string
  applied?: { canUndo?: boolean; canDisconnect?: boolean; modifiedExternally?: boolean }
  [key: string]: unknown
}

export type AgentRestorePreview = {
  token: string
  warnings: string[]
  files: Array<{ path: string; diff: Array<{ kind: 'same' | 'added' | 'removed'; text: string }> }>
}

export function fetchAgents(signal?: AbortSignal): Promise<{ clients?: AgentClient[] }> {
  return apiCall<{ clients?: AgentClient[] }>('/api/agents', { signal })
}

export function previewAgentRestore(clientId: string): Promise<AgentRestorePreview> {
  return apiCall('/api/agents/preview', { method: 'POST', body: { clientId, operation: 'restore' } })
}

export function restoreAgentClient(clientId: string, token: string): Promise<unknown> {
  return apiCall('/api/agents/restore', { method: 'POST', body: { clientId, operation: 'restore', token } })
}

/* ─── 账号余额 ─────────────────────────────── */

export type UsageRow = import('../../../ui-shared/usage-query-state').UsageQueryRow

export type UsageSnapshot = {
  sorting?: AccountSorting
  /** 全部行里最新的结论时刻 */
  at?: number
  results?: UsageRow[]
  skipped?: number
}

/** 最近一次查询结果的快照（只读记录表，不触发上游查询） */
export function fetchUsageSnapshot(signal?: AbortSignal): Promise<UsageSnapshot> {
  return apiCall<UsageSnapshot>('/api/accounts/usage/snapshot', { signal })
}

/** 手动查询单个账号余额（会真的打上游，可能慢） */
export function fetchAccountUsage(id: string): Promise<{ results?: UsageRow[]; skipped?: number }> {
  return apiCall<{ results?: UsageRow[]; skipped?: number }>(
    `/api/accounts/usage?id=${encodeURIComponent(id)}`,
  )
}

/** 改备注名（后端 PATCH 支持 name 字段，空串会被 400 拒绝） */
export function renameAccount(id: string, name: string): Promise<unknown> {
  return apiCall(`/api/accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name } })
}

/** 不传 model 时清除账号冷却与全部模型限流标记。 */
export function clearAccountRateLimits(id: string, model?: string): Promise<unknown> {
  return apiCall(`/api/accounts/${encodeURIComponent(id)}/rate-limits/clear`, {
    method: 'POST',
    body: model ? { model } : {},
  })
}

/** 把账号设为全局队列第一位（设为首选） */
export function promoteAccount(id: string): Promise<unknown> {
  return apiCall('/api/accounts/current', { method: 'POST', body: { id } })
}

