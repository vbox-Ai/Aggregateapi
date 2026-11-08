import { apiCall } from './client'
import { t } from '../i18n'

/**
 * 账号路由设置（`api/routing_api.rs`）。
 *
 * 与 `/api/timeouts` 同一模式：独立端点、允许部分字段、返回生效后的全量值、
 * 保存后对下一个请求立即生效（转发层逐请求读内存快照，不读盘）。
 *
 * ── ⚠️ 键名带 `routing` 前缀，别照字段语义猜 ────────────────────
 * `PUT /api/routing` 读的是 `config::KEY_ROUTING_*` 这组常量，形状是
 * `routingStrategy` / `routingSticky` / `routingFailoverBackoff` / `routingSink` /
 * `routingBreakerEnabled` / `routingBreakerThreshold` / `routingBreakerTimeoutSeconds` /
 * `routingBreakerSuccessThreshold`（已发布二进制里逐个核对过）。
 *
 * 这里曾经写成 `strategy` / `sticky` / `failoverBackoff` / `breakerTimeout` …：
 * 后端对**不认识的键是静默忽略**（`RoutingPatch::default()` 全 None），所以保存
 * 「成功」但什么都没改，读回来也没有对应字段可填 —— 界面看着能点，实际全程没生效。
 *
 * ── 后端是严格校验，值写错会 400 ──────────────────────────────
 * · 策略只支持 `order` / `rotate` / `provider`（没有 `usage`；`usage` 只是桌面端
 *   标签函数里的兜底分支）；
 * · 粘性只支持 `auto` / `session` / `turn` / `off`（**没有 `on`**）；
 * · `routingFailoverBackoff` 是**布尔**（不是毫秒数）—— 它是「失败退避」开关；
 * · 熔断三个数值有范围：阈值 1~20、时长 10~600 秒、恢复阈值 1~10。
 *
 * ── 一个容易忽略的副作用 ─────────────────────────────────────
 * 粘性档位**变化**时，后端会清空所有会话绑定（`clear_route_sticky(None, None)`）。
 * 所以改这一档的提示里要写明「会解除现有绑定」，而不是只说「下个请求生效」。
 */

export type RoutingStrategy = 'order' | 'rotate' | 'provider'
export type RoutingSticky = 'auto' | 'session' | 'turn' | 'off'

export type RoutingSettings = {
  routingStrategy: RoutingStrategy
  routingSticky: RoutingSticky
  routingFailoverBackoff: boolean
  routingSink: boolean
  routingBreakerEnabled: boolean
  routingBreakerThreshold: number
  routingBreakerTimeoutSeconds: number
  routingBreakerSuccessThreshold: number
}

/** 部分字段更新：不给的键不动 */
export type RoutingPatch = Partial<RoutingSettings>

/** 数值字段的取值范围（与后端常量一致，与桌面端输入框 min/max 一致） */
export const ROUTING_LIMITS = {
  breakerThreshold: { min: 1, max: 20 },
  breakerTimeoutSeconds: { min: 10, max: 600 },
  breakerSuccessThreshold: { min: 1, max: 10 },
} as const

/** 读生效的路由设置 */
export function fetchRouting(): Promise<RoutingSettings> {
  return apiCall<RoutingSettings>('/api/routing')
}

export function putRouting(patch: RoutingPatch): Promise<RoutingSettings> {
  return apiCall<RoutingSettings>('/api/routing', { method: 'PUT', body: patch })
}

/**
 * 队列可见化：按当前策略，这个模型的候选账号会怎么排、谁被跳过、为什么。
 *
 * `model` 省略（或空）时按「不限模型」的全局队列展开。
 * 排序实现与转发选路是同一个函数（`routing::plan_route`）——
 * 界面画的顺序和实际转发顺序不会分叉。
 */
export function fetchRoutingQueue(model?: string): Promise<RoutingQueue> {
  const query = model ? `?model=${encodeURIComponent(model)}` : ''
  return apiCall<RoutingQueue>(`/api/routing/queue${query}`)
}

export type RoutingQueueEntry = {
  id: string
  name?: string
  provider?: string
  reason?: string
}

export type RoutingQueue = {
  strategy: string
  sticky: string
  model: string | null
  modelKnown?: boolean
  lastRequestModel?: string
  pickedId?: string
  ordered: RoutingQueueEntry[]
  blocked: RoutingQueueEntry[]
}

/* ─── 会话粘滞（`/api/routing/sticky`）───────────────────────── */

export type StickyEntry = {
  id: string
  /** 会话键的脱敏预览 */
  keyPreview: string
  model: string
  source: string
  accountId: string
  accountName: string
  provider: string
  providerLabel: string
  createdAt: number
  lastSeen: number
  expiresAt: number
  remainingMs: number
  hits: number
}

export type StickyState = {
  entries: StickyEntry[]
  /** 网关侧的当前时间：与手机时钟可能有偏差，倒计时要按它算 */
  now: number
  sticky: string
}

export function fetchRoutingSticky(model?: string): Promise<StickyState> {
  const query = model ? `?model=${encodeURIComponent(model)}` : ''
  return apiCall<StickyState>(`/api/routing/sticky${query}`)
}

/**
 * 解除会话粘滞。
 *
 * 三种粒度，后端按「先看 id、再看 model、最后 all」的顺序取（见桌面端调用处）：
 * 单条 = `{ id, model }`（`model` 一起给，便于后端定位）；按模型 = `{ model }`；
 * 全部 = `{ all: true }`。
 *
 * 语义：只清网关这边的账号绑定，**不终止在途请求**、不删聊天历史、不改粘性档位。
 */
export function clearRoutingSticky(payload: { id?: string; model?: string; all?: boolean }): Promise<{ cleared: number }> {
  return apiCall<{ cleared: number }>('/api/routing/sticky/clear', { method: 'POST', body: payload })
}

/* ─── 展示口径（照抄桌面端 `routing-ui.tsx`）──────────────────── */

export function strategyLabel(strategy?: string): string {
  return strategy === 'rotate' || strategy === 'usage'
    ? t('负载均衡')
    : strategy === 'provider'
      ? t('家内轮询')
      : t('顺序优先')
}

export function stickyLabel(sticky?: string): string {
  return sticky === 'session'
    ? t('会话内')
    : sticky === 'off'
      ? t('关闭')
      : sticky === 'turn'
        ? t('每轮')
        : t('自动')
}

/** 粘性档位的说明；`off` / `turn` 都没有跨请求绑定（粘滞页面据此提示） */
export function stickyHint(sticky?: string): string {
  if (sticky === 'auto') return t('五分钟没有往来即释放；客户端会话标识优先，内容哈希兜底。')
  if (sticky === 'session') return t('会话最长保持六小时无往来；可以随时在会话粘滞中解除。')
  return t('每轮重新选路，不保留跨请求的账号绑定。')
}

export function strategyHint(strategy?: string): string {
  if (strategy === 'order') return t('优先使用队首账号，不可用时顺延。')
  if (strategy === 'provider') return t('提供商保持优先顺序，同一提供商的账号轮流承接。')
  return t('可用账号按请求轮换；开启会话粘性时同一会话优先留在原账号。')
}
