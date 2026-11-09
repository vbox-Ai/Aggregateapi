/**
 * 手机验证码登录（AutoClaw 国内版 / Loomy / Tabbit 国内站）。
 *
 * ── 与「网页登录」是两套东西，不要合并 ────────────────────────
 *   网页登录：开窗口 → 用户在官方页面操作 → 网关等回调/轮询 → 拿凭证；
 *   手机验证码：在面板里填手机号 → 发码 → 填码 → 直接换凭证（并落成账号）。
 * 上游形态决定的：AutoClaw 国内版没有授权页、没有授权码回调（Loomy 同理），
 * 硬塞进网页登录只会多出一堆「这条路没有窗口也没有 state」的分支。
 *
 * ── 这张档案表是逐条对齐桌面端 `ui/sms-login.js` 抄来的 ────────
 * 端点、中间态字段名、手机号规则都照抄，不自己发明：
 *   · **AutoClaw**：上游把码绑在发码时的 `device_id` 上 → 登录回传 `deviceId`
 *   · **Loomy**：码绑在发码响应的 `msgid` 上 → 登录回传 `msgid`
 *     （手机号规则也更严：只收 `1[3-9]` 开头，与它客户端同口径）
 *   · **Tabbit 国内站**：码绑在 `uuid` 上；发码可能**先被风控拦下要滑块**
 *     （上游回 `{status:'captcha', captcha:{...}}` 而不是发码）
 *
 * ⚠️ **provider id 必须是 `autoclaw`，不是 `workbuddy`**：通用发码端点按
 * `provider` 决定发到哪个地区（`autoclaw` / `autoclaw-intl`），传别的值会被
 * **明确拒绝**（上游在 issue #93 之后不再静默回落到国内版 —— 静默回落的代价是
 * 「把 Loomy 的号码发去 AutoClaw 站点，调用方还拿到成功响应」）。
 *
 * ── 三家的验证码中间态为什么由前端保管 ────────────────────────
 * 网关不替用户保存这个中间态（一次登录可以跨多次 HTTP 请求、也可能被放弃，
 * 存在服务端只会多一份要清理的状态），所以发码把它回给前端、登录时带回来。
 */
import { apiCall } from './client'
import { t } from '../i18n'

export type SmsTicketKey = 'deviceId' | 'msgid' | 'uuid'

export type SmsProfile = {
  /** 与网关约定的 provider id（发码/登录都要带） */
  provider: string
  label: string
  send: string
  verify: string
  /** 中间态在请求体里的字段名 */
  ticketKey: SmsTicketKey
  phoneRe: RegExp
  /** 这家发码前可能要求滑块验证（目前只有 Tabbit） */
  captchaPage?: boolean
}

export const SMS_PROFILES: SmsProfile[] = [
  {
    provider: 'autoclaw', label: t('AutoClaw 国内版'),
    send: '/api/session/login/sms/send', verify: '/api/session/login/sms/verify',
    ticketKey: 'deviceId', phoneRe: /^1[2-9]\d{9}$/,
  },
  {
    provider: 'loomy', label: t('Loomy'),
    send: '/api/session/login/loomy/sms/send', verify: '/api/session/login/loomy/sms/verify',
    ticketKey: 'msgid', phoneRe: /^1[3-9]\d{9}$/,
  },
  {
    provider: 'tabbit', label: t('Tabbit 国内站'),
    send: '/api/session/login/tabbit/sms/send', verify: '/api/session/login/tabbit/sms/verify',
    ticketKey: 'uuid', phoneRe: /^1[2-9]\d{9}$/, captchaPage: true,
  },
]

/** 验证码规则（三家同一条） */
export const SMS_CODE_RE = /^\d{6}$/

/**
 * 发码冷却秒数。
 *
 * 60 不是猜的：上游**不返回**冷却时长（限频时回 `{"code":630101,...}`，响应头
 * 里也没有 `Retry-After`），但官方桌面端把它写在客户端里（发码成功后
 * `setRemaining(60)` 并倒计时禁用按钮）—— 所以 60 是**官方口径**。
 * 成功与失败**都**进冷却：那条「过于频繁」的失败正是最该冷却的一种，
 * 不冷却用户会继续点、每次都稳定失败。
 */
export const SMS_RESEND_COOLDOWN_SECONDS = 60

/** 未登记的 provider 按 id 推导端点；**不退回 AutoClaw**（会把号码发到别家站点） */
export function smsProfileOf(provider: string): SmsProfile {
  const known = SMS_PROFILES.find(item => item.provider === provider)
  if (known) return known
  return {
    provider,
    label: provider,
    send: `/api/session/login/${provider}/sms/send`,
    verify: `/api/session/login/${provider}/sms/verify`,
    ticketKey: provider === 'tabbit' ? 'uuid' : 'deviceId',
    phoneRe: /^1[2-9]\d{9}$/,
  }
}

export type SmsSendOutcome =
  | { kind: 'sent'; ticket: string }
  | { kind: 'captcha'; ticket: string; verifyUrl: string; message: string }

/**
 * 发码。
 *
 * `supportsCaptcha: true` 是**必须带**的：它告诉网关「这个界面认识发码前的滑块
 * 状态」，网关才会用 `200 + {status:'captcha'}` 回我们；不带时上游会给 409 与
 * 一句可读提示（旧缓存前端就是那样）。
 *
 * `captchaTicket`：过完滑块**重发**时必须沿用被拦下那一轮给的 uuid，否则上游会
 * 当成另一次会话，刚通过的验证结论对不上。
 */
export async function sendSmsCode(
  profile: SmsProfile, phone: string, captchaTicket = '',
): Promise<SmsSendOutcome> {
  const body: Record<string, unknown> = { phone, provider: profile.provider, supportsCaptcha: true }
  if (captchaTicket) body.uuid = captchaTicket
  const data = await apiCall<Record<string, unknown> & {
    status?: string
    uuid?: string
    captcha?: { verifyUrl?: string; message?: string }
  }>(profile.send, { method: 'POST', body })

  if (profile.captchaPage && data?.status === 'captcha') {
    return {
      kind: 'captcha',
      ticket: String(data.uuid || captchaTicket || ''),
      verifyUrl: String(data.captcha?.verifyUrl || ''),
      message: String(data.captcha?.message || '') || t('需要进行人机验证'),
    }
  }
  return { kind: 'sent', ticket: String(data?.[profile.ticketKey] || '') }
}

export type SmsLoginResult = {
  account?: { id?: string; provider?: string; name?: string }
  list?: unknown
}

/**
 * 用手机号 + 验证码登录并**直接落成账号**。
 *
 * 响应形状与 `POST /api/accounts` 一致（上游注释原文：登录只是另一种拿到凭证的
 * 方式，落盘、命名、去重、优先级分配全部复用插件那条落库通路），所以调用方
 * 直接走「已添加账号」的收尾逻辑即可：关弹窗、刷新账号列表。
 *
 * 中间态缺省时**不要传空串**：后端对「缺中间态」有专门的判定与提示（Loomy 缺
 * msgid 时要求先发码），传空串会把那层判定的语义覆盖掉。
 */
export function verifySmsLogin(
  profile: SmsProfile,
  input: { phone: string; code: string; ticket?: string; name?: string },
): Promise<SmsLoginResult> {
  const body: Record<string, unknown> = { phone: input.phone, code: input.code, provider: profile.provider }
  if (input.ticket) body[profile.ticketKey] = input.ticket
  const name = (input.name || '').trim()
  if (name) body.name = name
  return apiCall<SmsLoginResult>(profile.verify, { method: 'POST', body })
}
