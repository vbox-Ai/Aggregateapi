import { apiCall } from './client'
import { serverIdentity } from '../lib/servers'
import { t } from '../i18n'

export type { Entitlement, PreviewPlan, OwnedPlan, PreviewResult, ClaimResult } from '../../../ui-shared/zcode-plans'
import type { PreviewResult, ClaimResult } from '../../../ui-shared/zcode-plans'

export type CaptchaPhase = 'preparing' | 'verifying' | 'submitting'
export type CaptchaPoolStats = {
  ready?: number; target?: number; required?: boolean; needsTokens?: boolean
  demandActive?: boolean; startPlanAccounts?: number; configError?: string; error?: string
}
type CaptchaConfig = { enabled?: boolean; region?: string; prefix?: string; sceneId?: string; skipModelRequest?: boolean }
type CaptchaApi = {
  solve<T>(config: CaptchaConfig, request: (param: string) => Promise<{ captchaResult: boolean; bizResult: boolean; result: T }>, signal?: AbortSignal,
    options?: { protocol: 'v3'; onPhase?: (phase: CaptchaPhase) => void }): Promise<{ result: T }>
  requestToken(config: CaptchaConfig, signal?: AbortSignal, options?: { onPhase?: (phase: CaptchaPhase) => void }): Promise<{ param: string }>
  cancel(): boolean
  isBusy(): boolean
}

const captchaApi = () => (window as Window & { wbAliyunCaptcha?: CaptchaApi }).wbAliyunCaptcha
let captchaLoading: Promise<CaptchaApi> | null = null

/** 只复用主程序的验证码实现，原生包也携带这份脚本，不从插件加载页面。 */
function loadCaptcha(): Promise<CaptchaApi> {
  const api = captchaApi()
  if (api) return Promise.resolve(api)
  if (captchaLoading) return captchaLoading
  captchaLoading = new Promise<CaptchaApi>((resolve, reject) => {
    const script = document.createElement('script')
    const timer = window.setTimeout(() => finish(new Error(t('验证码组件加载超时，请重试'))), 15_000)
    const finish = (error?: Error) => {
      window.clearTimeout(timer)
      script.onload = null
      script.onerror = null
      const loaded = captchaApi()
      if (error || !loaded) { script.remove(); reject(error || new Error(t('验证码组件未加载，请重试'))) }
      else resolve(loaded)
    }
    script.src = new URL('aliyun-captcha.js', document.baseURI).href
    script.onload = () => finish()
    script.onerror = () => finish(new Error(t('验证码组件加载失败，请重试')))
    document.head.appendChild(script)
  }).catch(error => { captchaLoading = null; throw error })
  return captchaLoading
}

const accountPath = (id: string) => `/api/accounts/${encodeURIComponent(id)}`

export function previewPlans(id: string): Promise<PreviewResult> {
  return apiCall(`${accountPath(id)}/zcode-claim/preview`, { method: 'POST' })
}

export async function claimPlan(id: string, planId: string, signal?: AbortSignal, onPhase?: (phase: CaptchaPhase) => void): Promise<ClaimResult> {
  const identity = serverIdentity()
  const requireCurrent = () => {
    if (signal?.aborted || serverIdentity() !== identity) throw new DOMException('请求已取消', 'AbortError')
  }
  requireCurrent()
  onPhase?.('preparing')
  const config = await apiCall<CaptchaConfig>(`${accountPath(id)}/zcode-claim/captcha-config`, { method: 'POST', signal })
  requireCurrent()
  if (!config || typeof config.enabled !== 'boolean') throw new Error(t('风控验证配置不完整，请稍后重试'))
  const claim = (captchaVerifyParam: string) => {
    requireCurrent()
    onPhase?.('submitting')
    return apiCall<ClaimResult>(`${accountPath(id)}/zcode-claim`, {
      method: 'POST', body: { planId, captchaVerifyParam, captchaRegion: config.region || '' },
    })
  }
  if (!config.enabled) return claim('')
  const captcha = await loadCaptcha()
  requireCurrent()
  const response = await captcha.solve({ ...config, region: config.region || 'cn' }, async param => {
    const result = await claim(param)
    return { captchaResult: result.failure !== 'captcha', bizResult: Boolean(result.ok), result }
  }, signal, { protocol: 'v3', onPhase })
  requireCurrent()
  return response.result
}

export function captchaPoolStats(signal?: AbortSignal): Promise<CaptchaPoolStats> {
  return apiCall('/api/zcode/captcha', { signal })
}

export async function verifyPlanChannel(id: string, signal?: AbortSignal, onPhase?: (phase: CaptchaPhase) => void): Promise<boolean> {
  const identity = serverIdentity()
  const requireCurrent = () => {
    if (signal?.aborted || serverIdentity() !== identity) throw new DOMException('请求已取消', 'AbortError')
  }
  requireCurrent()
  onPhase?.('preparing')
  const config = await apiCall<CaptchaConfig>(`${accountPath(id)}/zcode-claim/captcha-config`, { method: 'POST', signal })
  requireCurrent()
  const stats = await captchaPoolStats(signal)
  requireCurrent()
  if (stats.required === false) return false
  const captcha = await loadCaptcha()
  requireCurrent()
  const token = await captcha.requestToken(config, signal, { onPhase })
  requireCurrent()
  onPhase?.('submitting')
  const result = await apiCall<{ accepted?: number }>('/api/zcode/captcha', {
    method: 'POST', body: { tokens: [{ param: token.param, region: config.region || '' }] },
  })
  if (result.accepted !== 1) throw new Error(t('验证码令牌未全部入池'))
  return true
}

export function cancelPlanCaptcha(): void {
  captchaApi()?.cancel()
}

/* ─── 定时领取的「验证任务」（`POST /api/zcode/claim-verification`）─────────
 *
 * 上游只有这一个入口，靠 body 里的 `action` 分两个动作（`zcode_claim_verification.rs`）：
 *   · `poll`     —— 问后端"有没有正在等我验证的任务"，回 `{supported, task}`
 *   · `complete` —— 把验证结果交回去
 * 协议是从桌面端 `ui/zcode-claim-verification.js` 逐字对齐来的（那份是权威实现）：
 *   poll      → { action:'poll', clientId, ready }
 *   complete  → { action:'complete', clientId, requestId, accountId, planId, status, param?, message? }
 * 其中 `status` 四态：verified / timeout / cancelled / failed ——
 * **失败也要回传**，否则后端会一直把同一个任务发给客户端。
 */

export type ClaimVerificationTask = {
  requestId?: string
  accountId?: string
  planId?: string
  planName?: string
  config?: CaptchaConfig
  remainingMs?: number
}

export type ClaimVerificationResult = {
  supported?: boolean
  task?: ClaimVerificationTask | null
  accepted?: boolean
}

export function pollClaimVerification(clientId: string, ready: boolean, signal?: AbortSignal): Promise<ClaimVerificationResult> {
  return apiCall('/api/zcode/claim-verification', {
    method: 'POST', body: { action: 'poll', clientId, ready }, signal,
  })
}

export function completeClaimVerification(input: {
  clientId: string
  requestId: string
  accountId: string
  planId: string
  status: 'verified' | 'timeout' | 'cancelled' | 'failed'
  param?: string
  message?: string
}): Promise<ClaimVerificationResult> {
  return apiCall('/api/zcode/claim-verification', { method: 'POST', body: { action: 'complete', ...input } })
}

/** 求解一次验证码、只取令牌（复用主程序的阿里云实现，不新增第二套）。 */
export async function requestClaimCaptchaToken(
  config: CaptchaConfig, signal?: AbortSignal, onPhase?: (phase: CaptchaPhase) => void,
): Promise<{ param: string }> {
  const captcha = await loadCaptcha()
  return captcha.requestToken(config, signal, { onPhase })
}
