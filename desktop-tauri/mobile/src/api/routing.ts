import { ApiError, apiCall } from './client'
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

/* ─── 路由组（保存 / 删除）──────────────────────── */

/**
 * 路由组的线上形状（上游 `config::RoutingGroup` / `RoutingMember`）。
 *
 * 两条字段层面的硬约束，写错了后端直接 400，不是「宽容处理」：
 *  · 结构体带 `#[serde(rename_all = "camelCase", deny_unknown_fields)]` ——
 *    **多一个字段就报错**，所以客户端只能**原样回传**读到的字段集合。
 *  · `revision` 是**整组内容的 SHA-256**（`config::routing_groups::revision`），
 *    不是递增版本号：保存时必须回传读到的那个值，否则 409。
 */
export type RoutingGroupMember = {
  id: string
  provider: string
  model: string
  included: boolean
  accounts: string[]
}

export type RoutingGroupBody = {
  id: string
  name: string
  model: string
  description: string
  strategy: string
  sticky: string
  members: RoutingGroupMember[]
}

/**
 * `GET/PUT /api/routing/groups` 的返回形状。
 *
 * `catalog` 交给调用方定类型（`RoutingGroupsPayload<RouteModelChoice>`）：它是
 * 「可用模型目录」，各页面读的字段不同，API 层不该替它们决定形状。
 */
export type RoutingGroupsPayload<Catalog = unknown> = {
  groups?: Array<{ group: RoutingGroupBody; revision?: string }>
  /** 新建组时要回传的 revision（`revision(None)`，空组的哈希） */
  newRevision?: string
  catalog?: Catalog[]
}

/**
 * 保存 / 删除一个路由组：`PUT /api/routing/groups`（上游 `put_group` 的 `GroupSave`）。
 *
 *  · `group` 给对象 = 新增或覆盖；**给 `null` = 删除这个组**；
 *  · `revision` 必须是客户端上次读到的值（新建用响应里的 `newRevision`）；
 *  · 不一致 → **409**「路由配置已在其他位置修改，请刷新后重试；草稿未丢失」——
 *    并发编辑（桌面端 / 另一台设备）靠它兜住，客户端要把它当**正常分支**处理
 *    （重新拉取 + 提示），不是当未知错误；
 *  · 成功返回与 GET 同形的整份数据（含新 `revision`）→ **回读是内置的**。
 *
 * ⚠️ 这条路由**上游 v3.4.2 就有**（`http.rs` 里 `get(...).put(put_group)`）。
 * 我早前记的「网关没有保存路由组的 HTTP 路由」是**错的**：那个结论来自**已安装
 * 二进制**的字符串，而二进制里读不出 HTTP 方法，且那份二进制比 v3.4.2 旧。
 * 旧版网关确实没有这条路由，所以客户端必须能识别（404 / 405）并保持只读。
 */
export function putRoutingGroup<Catalog = unknown>(payload: {
  id: string
  group: RoutingGroupBody | null
  revision: string
}): Promise<RoutingGroupsPayload<Catalog>> {
  return apiCall<RoutingGroupsPayload<Catalog>>('/api/routing/groups', { method: 'PUT', body: payload })
}

/**
 * 探测网关是否支持保存路由组 —— **零副作用**。
 *
 * 手法：发一个 `group: null`（= 删除）但 `revision` 明显不合法（不是 SHA-256）的
 * 请求。上游 `save()` 的 revision 检查排在任何写入**之前**
 * （`if revision(old) != expected { return Err(...) }`），所以：
 *  · 有这条路由 → 一定 409（「已在其他位置修改」），**什么都没改**；
 *  · 没有这条路由 → 404 / 405。
 * 再叠一层保险：用一个不存在的 id —— 即使 revision 意外匹配，也只会「删掉一个
 * 并不存在的组」。
 */
export async function probeRoutingGroupWrite(): Promise<boolean> {
  try {
    await apiCall('/api/routing/groups', {
      method: 'PUT',
      body: { id: '__a2a_write_probe__', group: null, revision: 'probe' },
    })
    // 能走到这里说明 revision 竟然被接受了 —— 更说明路由存在
    return true
  } catch (cause) {
    const status = cause instanceof ApiError ? cause.status : 0
    if (status === 409) return true
    if (status === 404 || status === 405 || status === 501) return false
    // 其它状态（401/403/500…）说明路由在，只是这次调用没被接受：交给真正的保存
    // 去暴露原因，别在这里误判成「网关太旧」。
    return status !== 0
  }
}

