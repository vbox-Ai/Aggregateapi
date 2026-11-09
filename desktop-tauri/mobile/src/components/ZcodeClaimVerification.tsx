import { useEffect, useRef, useState } from 'react'
import { Button, Card, Spinner } from '@ui'
import { store } from '../state/store'
import {
  cancelPlanCaptcha, completeClaimVerification, pollClaimVerification, requestClaimCaptchaToken,
  type ClaimVerificationTask,
} from '../api/zcode'
import { t } from '../i18n'

/** 轮询节奏与桌面端一致（`ui/zcode-claim-verification.js`）：有任务时 5s，空闲 30s。 */
const POLL_MS = 5000
const IDLE_MS = 30000
/** 一次验证最多等 50 秒；失败后 5 分钟不再重试，避免反复弹验证码。 */
const MAX_WAIT_MS = 50000
const PAUSE_MS = 5 * 60000

type Notice = { accountName: string; planName: string; phase: string }

/**
 * ZCode 定时领取的「验证任务」常驻提示。
 *
 * ── 为什么要有它 ──────────────────────────────────────────────
 * 领取有些套餐时上游会要求过一次风控验证。后端会把"正在等待验证的任务"挂在
 * `POST /api/zcode/claim-verification` 上；客户端**必须主动轮询**并把它做完，
 * 否则那次领取就一直卡着。桌面上这份逻辑在 `ui/zcode-claim-verification.js`，
 * 手机端此前完全没有 —— 结果是在手机上触发这类领取就只能失败。
 *
 * ── 协议（逐字对齐桌面端，不自己发明）──────────────────────────
 *   poll     → `{action:'poll', clientId, ready}`，回 `{supported, task}`
 *   complete → `{action:'complete', …, status:'verified'|'timeout'|'cancelled'|'failed', param?}`
 * 验证码令牌复用主程序的阿里云实现（`wbAliyunCaptcha`，见 `api/zcode.ts`）。
 *
 * ── 三条必须遵守的行为 ────────────────────────────────────────
 *  1. **失败也要回传**（timeout / cancelled / failed），否则后端会一直派同一个任务；
 *  2. 提示卡**不抢焦点**：阿里云弹出的滑块仍由用户自己完成；
 *  3. 用户点「取消验证」只是放弃这一次，不应把轮询停掉。
 */
export function ZcodeClaimVerification() {
  const [notice, setNotice] = useState<Notice | null>(null)
  const activeRef = useRef<{ controller: AbortController; submitting: boolean } | null>(null)
  const pausedUntilRef = useRef(0)
  const clientIdRef = useRef('')

  useEffect(() => {
    let stopped = false
    let timer = 0
    clientIdRef.current ||= window.crypto?.randomUUID?.() || `claim-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const publish = (next: Notice | null) => {
      if (!stopped) setNotice(next)
    }

    const schedule = (delay: number) => {
      window.clearTimeout(timer)
      if (!stopped) timer = window.setTimeout(() => void tick(), delay)
    }

    const verify = async (task: ClaimVerificationTask) => {
      if (!task.requestId || !task.accountId || !task.planId || !task.config) return
      const remaining = Math.min(MAX_WAIT_MS, Number(task.remainingMs) || 0)
      if (remaining <= 1000) return

      const account = store.accounts().find(item => item.id === task.accountId)
      const accountName = account?.displayName || account?.name || task.accountId
      const planName = task.planName || task.planId

      const controller = new AbortController()
      const flow = { controller, submitting: false }
      activeRef.current = flow
      let expired = false
      const setPhase = (phase: string) => {
        if (activeRef.current === flow) publish({ accountName, planName, phase })
      }
      setPhase('preparing')

      const timeout = window.setTimeout(() => {
        expired = true
        controller.abort()
      }, remaining - 750)

      const settle = async (status: 'timeout' | 'cancelled' | 'failed', message: string) => {
        try {
          await completeClaimVerification({
            clientId: clientIdRef.current, requestId: task.requestId!, accountId: task.accountId!,
            planId: task.planId!, status, message: message.slice(0, 240),
          })
        } catch {
          /* 交不回去也不影响本地收尾；下一轮轮询会拿到状态 */
        }
      }

      try {
        const token = await requestClaimCaptchaToken(
          task.config, controller.signal, phase => setPhase(phase),
        )
        if (controller.signal.aborted || activeRef.current !== flow) throw new DOMException('请求已取消', 'AbortError')
        flow.submitting = true
        setPhase('submitting')
        const result = await completeClaimVerification({
          clientId: clientIdRef.current, requestId: task.requestId, accountId: task.accountId,
          planId: task.planId, status: 'verified', param: token.param,
        })
        if (result?.accepted !== true) store.toast(t('领取验证任务已结束，请到套餐明细查看结果'), 'warn')
      } catch (error) {
        // 用户主动取消 / 滑块关掉：不打扰，只静默回传；其他失败才提示。
        pausedUntilRef.current = Date.now() + PAUSE_MS
        const name = (error as { name?: string } | null)?.name || ''
        const cancelled = controller.signal.aborted || name === 'AbortError' || name === 'CaptchaCancelledError'
        if (!flow.submitting) {
          await settle(expired ? 'timeout' : cancelled ? 'cancelled' : 'failed',
            cancelled ? '' : String((error as Error)?.message || error || ''))
        }
        if (!cancelled) {
          store.toast(flow.submitting
            ? t('验证提交结果未确认，请查看签到记录，勿重复领取')
            : t('本次自动领取未完成验证，请在套餐明细中手动领取'), 'warn')
        }
      } finally {
        window.clearTimeout(timeout)
        if (activeRef.current === flow) {
          activeRef.current = null
          publish(null)
        }
      }
    }

    const tick = async () => {
      let delay = POLL_MS
      if (Date.now() < pausedUntilRef.current) {
        schedule(IDLE_MS)
        return
      }
      try {
        const result = await pollClaimVerification(clientIdRef.current, !activeRef.current)
        if (stopped) return
        // 插件不支持这个动作：退回空闲节奏，别反复问。
        if (result?.supported === false) {
          delay = IDLE_MS
          activeRef.current?.controller.abort()
          return
        }
        if (!activeRef.current && result?.task) void verify(result.task)
      } catch {
        delay = IDLE_MS
      } finally {
        schedule(delay)
      }
    }

    schedule(4000)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      activeRef.current?.controller.abort()
      activeRef.current = null
    }
  }, [])

  if (!notice) return null
  const submitting = notice.phase === 'submitting'

  return (
    <Card className='m-card m-card-pad' style={{
      position: 'fixed', left: 12, right: 12, bottom: 74, zIndex: 40,
      boxShadow: '0 8px 28px rgba(0,0,0,.18)',
    }}>
      <div className='m-ck-toolbar'>
        <Spinner className='size-4 shrink-0' />
        <div className='m-ck-grow'>
          <div className='m-ck-title'>{t('ZCode 自动领取验证')}</div>
          <div className='m-ck-note'>{notice.accountName} · {notice.planName}</div>
        </div>
        <Button variant='outline' size='sm' disabled={submitting} onClick={() => cancelPlanCaptcha()}>
          {t('取消验证')}
        </Button>
      </div>
      <p className='m-ck-note'>
        {submitting
          ? t('验证凭据正在提交，领取结果请查看签到记录')
          : t('正在为本次领取验证；若出现滑块，请手动完成')}
      </p>
    </Card>
  )
}
