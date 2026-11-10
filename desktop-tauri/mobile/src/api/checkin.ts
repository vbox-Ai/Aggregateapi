import { apiCall } from './client'
import type { OfficeaceSubscriptionResult, OfficeaceSubscriptionState } from '../../../ui-shared/checkin-officeace-types'
import type { BenefitRedemptionResult, CampaignClaimResult, CampaignPreview } from '../../../ui-shared/checkin-campaign-types'
import type {
  AutoState, CheckinCenter, CheckinResult, CheckinResultRow, KeepaliveState, OnboardingTask,
  RecordsPage, TravelRunResult, TravelState,
} from '../../../ui-shared/checkin'

export type {
  AutoState, CheckinAccount, CheckinCenter, CheckinResult, CheckinSection, GrowthEntry,
  KeepaliveState, OnboardingEntry, OnboardingTask, PlanEntry, ProviderGroup,
  RecordRow, RecordsPage, ScheduleEntry, TravelRunResult, TravelState,
} from '../../../ui-shared/checkin'
export { CHECKIN_SECTION_OPTIONS, modesOf } from '../../../ui-shared/checkin'

export type CheckinRun = CheckinResult
export type ActivityResult = CheckinResultRow

export type SchedulePatch = {
  id?: string
  label?: string
  enabled: boolean
  time: string
  timeEnd?: string
  providers: string[]
  /** 逐家的时刻覆盖（不传 = 保持原样；空对象 = 全部撤销） */
  providerTimes?: Record<string, string>
  /** 补签轮时刻（空串 = 关掉补签轮） */
  retryTime?: string
  /** 中性未领取的重试间隔（分钟；0 = 不重试） */
  retryGapMinutes?: number
  /** 每账号每天的重试次数上限（0 = 不重试） */
  retryLimit?: number
}

export type RecordFilters = {
  outcome?: string
  /** 签到类型：manual / schedule / makeup */
  kind?: string
  provider?: string
  keyword?: string
  start?: number
  end?: number
}

function queryString(params: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}

const accountPath = (id: string) => `/api/accounts/${encodeURIComponent(id)}`

export function getCheckinCenter(signal?: AbortSignal): Promise<CheckinCenter> {
  return apiCall('/api/checkin-center', { signal })
}

export function runCheckin(id?: string): Promise<CheckinRun> {
  return apiCall('/api/accounts/checkin', { method: 'POST', body: id ? { id } : {} })
}

export function runActivity(id: string, mode: string): Promise<ActivityResult> {
  return apiCall('/api/checkin-activity', { method: 'POST', body: { id, mode } })
}

export function saveAutoCheckin(enabled: boolean): Promise<AutoState> {
  return apiCall('/api/auto-checkin', { method: 'POST', body: { enabled } })
}

/**
 * 立即跑一次自动签到（`POST /api/auto-checkin/run`，处理器 `auto_checkin::run_now`）。
 *
 * 上游语义（源码注释写明）：返回体是 `{...summary, state}`——**本次运行摘要**再叠上
 * **当前开关状态**；若已有一次在执行，则不是 200 而是 **400「签到正在执行中，请稍候」**。
 * 所以调用方必须把 400 当成"**正在跑**"来提示，而不是当失败抱怨。
 */
export function runAutoCheckin(): Promise<CheckinRun & AutoState> {
  return apiCall('/api/auto-checkin/run', { method: 'POST' })
}

/**
 * 积分简报（`GET /api/usage`，处理器 `billing::get_usage`）。
 *
 * 形状由插件归一：`{kind, unlimited, totalLeft, planLeft, bonusLeft}` 外加明细与套餐。
 * 两种非 200 要知道怎么说（上游注释里写明）：
 *   · **400**：当前没有活动账号会话（「找不到该会话对应的账号记录」）
 *   · **503**：该提供商的积分查询需要装插件
 */
export type CreditsSummary = {
  kind?: string
  unlimited?: boolean
  totalLeft?: number
  planLeft?: number
  bonusLeft?: number
  [key: string]: unknown
}

export function getCreditsSummary(signal?: AbortSignal): Promise<CreditsSummary> {
  return apiCall('/api/usage', { signal })
}

/**
 * 签到活动状态（`GET /api/checkin/status`，处理器 `billing::checkin_status`）。
 *
 * 上游把各版本归一成同一套键（`active` / `todayCheckedIn`），**没有活动或没有数据时
 * 返回 `null`** —— 调用方要能接受 null，而不是把 null 当错误。
 */
export type CheckinActivityStatus = {
  active?: boolean
  todayCheckedIn?: boolean
  [key: string]: unknown
}

export function getCheckinStatus(signal?: AbortSignal): Promise<CheckinActivityStatus | null> {
  return apiCall('/api/checkin/status', { signal })
}

export function saveCheckinSchedule(body: SchedulePatch): Promise<AutoState> {
  return apiCall('/api/checkin-schedules', { method: 'POST', body })
}

export function deleteCheckinSchedule(id: string): Promise<unknown> {
  return apiCall(`/api/checkin-schedules/${encodeURIComponent(id)}/delete`, { method: 'POST' })
}

export function runCheckinSchedule(id: string): Promise<CheckinRun & AutoState> {
  return apiCall(`/api/checkin-schedules/${encodeURIComponent(id)}/run`, { method: 'POST' })
}

export function saveKeepalive(models: string[], apiKeyId?: string | null): Promise<KeepaliveState> {
  return apiCall('/api/checkin-keepalive', { method: 'POST', body: { models, apiKeyId } })
}

export function saveTravel(body: { enabled?: boolean; times?: string[] }): Promise<TravelState> {
  return apiCall('/api/travel-schedule', { method: 'POST', body })
}

export function runTravel(): Promise<TravelRunResult> {
  return apiCall('/api/travel-schedule/run', { method: 'POST' })
}

export function getCheckinRecords(
  filters: RecordFilters & { offset: number; limit: number },
  signal?: AbortSignal,
): Promise<RecordsPage> {
  return apiCall(`/api/checkin-records${queryString(filters)}`, { signal })
}

export function clearCheckinRecords(filters: RecordFilters, all = false): Promise<{ removed: number }> {
  return apiCall(`/api/checkin-records${queryString(all ? { all: 1 } : filters)}`, { method: 'DELETE' })
}

export type OnboardingResult = {
  tasks?: OnboardingTask[]
  earned?: number
  total?: number
  unclaimed?: number
  settled?: boolean
  settledAt?: number | null
  claimed?: number
  failed?: number
  claimedPoints?: number
  message?: string
}

export function getOnboarding(id: string, refresh = false): Promise<OnboardingResult> {
  return apiCall(`${accountPath(id)}/onboarding${refresh ? '?refresh=1' : ''}`)
}

export function claimOnboarding(id: string): Promise<OnboardingResult> {
  return apiCall(`${accountPath(id)}/onboarding/claim`, { method: 'POST' })
}

export type GrowthTask = {
  code: string
  title: string
  description?: string
  status?: string
  current?: number
  target?: number
  locked?: boolean
  supported?: boolean
  unforgeable?: boolean
}

export type GrowthResult = {
  energy?: number | null
  streak?: number | null
  tasks?: { tasks?: GrowthTask[]; error?: string }
  travel?: Record<string, unknown> | null
  school?: Record<string, unknown> | null
}

export type GrowthRun = {
  code?: string
  outcome?: string
  message?: string
  error?: string
  credit?: number
}

export function getGrowth(id: string): Promise<GrowthResult> {
  return apiCall(`${accountPath(id)}/growth`)
}

export function runGrowthTask(id: string, code: string, mode: 'full' | 'claim'): Promise<GrowthRun> {
  return apiCall(`${accountPath(id)}/growth/task`, { method: 'POST', body: { code, mode } })
}

export function runGrowthTravel(id: string): Promise<GrowthRun> {
  return apiCall(`${accountPath(id)}/growth/travel`, { method: 'POST' })
}

export function runGrowthSchool(id: string, lottery: boolean): Promise<GrowthRun> {
  return apiCall(`${accountPath(id)}/growth/school`, { method: 'POST', body: { lottery } })
}

export type UmidState = { available?: boolean; installing?: boolean; installSupported?: boolean; source?: string }

export function getUmid(): Promise<UmidState> {
  return apiCall('/api/qoder-umid')
}

export function installUmid(): Promise<UmidState> {
  return apiCall('/api/qoder-umid/install', { method: 'POST' })
}

export function getCampaignRewards(id: string): Promise<CampaignPreview> {
  return apiCall(`${accountPath(id)}/campaigns`)
}

export function claimCampaignReward(id: string, campaignId: string): Promise<CampaignClaimResult> {
  return apiCall(`${accountPath(id)}/campaigns/claim`, { method: 'POST', body: { campaignId } })
}

export function redeemCampaignBenefit(id: string, code: string): Promise<BenefitRedemptionResult> {
  return apiCall(`${accountPath(id)}/campaigns/redeem`, { method: 'POST', body: { code } })
}

export function getOfficeaceSubscription(id: string): Promise<OfficeaceSubscriptionState> {
  return apiCall(`${accountPath(id)}/officeace-subscription`)
}

export function activateOfficeaceSubscription(id: string, confirmAgreements: boolean): Promise<OfficeaceSubscriptionResult> {
  return apiCall(`${accountPath(id)}/officeace-subscription/activate`, { method: 'POST', body: { confirmAgreements } })
}
