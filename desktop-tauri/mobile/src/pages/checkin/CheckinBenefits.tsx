import { useEffect, useState } from 'react'
import { Button , Card } from '@ui'
import { Badge, Empty, SectionHead } from '../../components/ui'
import { ProviderLogo } from '../../components/ProviderLogo'
import { claimOnboarding, getCheckinStatus, getCreditsSummary, getOnboarding, type CheckinActivityStatus, type CheckinCenter, type CheckinSection, type CreditsSummary, type OnboardingEntry, type OnboardingResult } from '../../api/checkin'
import { claimedPlansToday } from '../../lib/checkin'
import { formatStamp } from '../../lib/format'
import type { CheckinAction } from '../CheckinPage'
import { CheckinGrowth } from './CheckinGrowth'
import { CheckinPlansSheet } from './CheckinPlansSheet'
import { store } from '../../state/store'
import { t } from '../../i18n'

export function CheckinBenefits({ center, section, busy, action, onChange }: {
  center: CheckinCenter; section: CheckinSection; busy: string; action: CheckinAction; onChange: () => void
}) {
  const [planId, setPlanId] = useState('')
  const plan = center.extras?.plans?.find(item => item.id === planId)
  return (
    <>
      <div hidden={section !== 'onboarding'}>
        {center.extras?.onboarding?.length ? <div className='m-section'>
          <SectionHead title={t('新手福利')} />
          <Card className='m-card'>
            {center.extras.onboarding.map(row => <OnboardingRow key={row.id} row={row} busy={busy} action={action} />)}
          </Card>
        </div> : <Empty text={t('没有支持新手福利的账号')} />}
      </div>
      <div hidden={section !== 'plans'}>
        <CreditsCard />
        {center.extras?.plans?.length ? <div className='m-section'>
          <SectionHead title={t('活动福利')} />
          <Card className='m-card'>
            {center.extras.plans.map(row => {
              const claimed = claimedPlansToday(row.claimPlans)
              return <div className='m-card-pad m-ck-account' key={row.id}>
                <div className='m-ck-toolbar'>
                  <ProviderLogo id={row.provider} />
                  <div className='m-ck-grow'>
                    <div className='m-ck-title'>{row.name || row.id}</div>
                    <div className='m-ck-note'>{claimed.length ? t('今天已领取 {n} 份', { n: claimed.length }) : t('今天还没有领取')}</div>
                  </div>
                  <Button variant='outline' size='sm' disabled={Boolean(busy)} onClick={() => setPlanId(row.id)}>{t('套餐明细')}</Button>
                </div>
              </div>
            })}
          </Card>
        </div> : <Empty text={t('没有可领套餐的账号（ZCode 未添加）。')} />}
      </div>
      <div hidden={section !== 'growth'}>
        {center.extras?.growth?.length ? <div className='m-section'>
          <SectionHead title={t('成长任务')} />
          <Card className='m-card'>
            {center.extras.growth.map(row => <CheckinGrowth key={row.id} row={row} busy={busy} action={action} />)}
          </Card>
        </div> : <Empty text={t('没有支持成长任务的账号（需要 WorkBuddy 国内版）。')} />}
      </div>
      {plan ? <CheckinPlansSheet key={plan.id} entry={plan} onClose={() => setPlanId('')} onChange={onChange} /> : null}
    </>
  )
}

/**
 * 积分简报 + 签到活动状态（`GET /api/usage`、`GET /api/checkin/status`）。
 *
 * 这两个读数**都可能取不到**，而且原因各不相同，必须分开说清（不能显示成 0）：
 *   · `/api/usage` 400 —— 当前没有活动账号会话；503 —— 该提供商要装插件才有积分查询；
 *   · `/api/checkin/status` 200 但 **null** —— 没有活动 / 没有数据（这不是错误）。
 *
 * 放在「活动福利」段里：它与"今天能领什么"是同一件事的两个读数（余额与活动开关）。
 */
function CreditsCard() {
  const [credits, setCredits] = useState<CreditsSummary | null>(null)
  const [activity, setActivity] = useState<CheckinActivityStatus | null>(null)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [summary, status] = await Promise.allSettled([getCreditsSummary(), getCheckinStatus()])
      if (cancelled) return
      if (summary.status === 'fulfilled') setCredits(summary.value)
      else setNote(summary.reason instanceof Error ? summary.reason.message : String(summary.reason))
      if (status.status === 'fulfilled') setActivity(status.value)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : '—')

  return (
    <div className='m-section'>
      <SectionHead title={t('积分与活动')} />
      <Card className='m-card m-card-pad'>
        {loading ? (
          <div className='m-ck-note'>{t('读取中…')}</div>
        ) : credits ? (
          <>
            <div className='m-ck-toolbar'>
              <div className='m-ck-grow'>
                <div className='m-ck-title'>{t('剩余积分')}</div>
                <div className='m-ck-note'>
                  {credits.unlimited
                    ? t('该账号积分不限量')
                    : t('套餐 {plan} · 赠送 {bonus}', { plan: number(credits.planLeft), bonus: number(credits.bonusLeft) })}
                </div>
              </div>
              <Badge tone='brand'>{credits.unlimited ? t('不限量') : number(credits.totalLeft)}</Badge>
            </div>
            {activity ? (
              <div className='m-ck-note'>
                {activity.active === false
                  ? t('当前没有进行中的签到活动')
                  : activity.todayCheckedIn
                    ? t('签到活动进行中 · 今天已签到')
                    : t('签到活动进行中 · 今天还没签到')}
              </div>
            ) : (
              <div className='m-ck-note'>{t('读不到签到活动状态')}</div>
            )}
          </>
        ) : (
          <div className='m-ck-note'>{note || t('读不到积分简报（可能需要给该账号装提供商插件）')}</div>
        )}
      </Card>
    </div>
  )
}

function settledResult(row: OnboardingEntry): OnboardingResult | null {
  if (!row.settled) return null
  return {
    tasks: row.settled.tasks,
    earned: row.settled.earned ?? undefined,
    total: row.settled.total ?? undefined,
    unclaimed: 0,
    settled: true,
    settledAt: row.settled.at,
  }
}

function OnboardingRow({ row, busy, action }: { row: OnboardingEntry; busy: string; action: CheckinAction }) {
  const [data, setData] = useState<OnboardingResult | null>(() => settledResult(row))
  const [error, setError] = useState('')
  const settled = data ? data.settled === true : Boolean(row.settled)
  const settledAt = data?.settledAt || row.settled?.at

  useEffect(() => {
    const snapshot = settledResult(row)
    setData(previous => snapshot ?? (previous?.settled ? null : previous))
  }, [row.settled])

  const query = async () => {
    setError('')
    const result = await action(`onboarding-query:${row.id}`, () => getOnboarding(row.id, true))
    if (result) setData(result)
  }

  const claim = async () => {
    const result = await action(`onboarding-claim:${row.id}`, () => claimOnboarding(row.id))
    if (!result) return
    setData(result)
    const failed = Number(result.failed) || 0
    const text = result.message || t('领取完成：{n} 项，+{points} 积分，{failed} 项失败', {
      n: Number(result.claimed) || 0, points: Number(result.claimedPoints) || 0, failed,
    })
    setError(failed > 0 ? text : '')
    store.toast(text, failed > 0 ? 'err' : 'ok')
  }

  return (
    <div className='m-card-pad m-ck-account'>
      <div className='m-ck-toolbar'>
        <ProviderLogo id={row.provider} />
        <div className='m-ck-title m-ck-grow'>{row.name || row.id}</div>
        {settled ? <Badge tone='ok'>{t('已领取')}</Badge> : null}
      </div>
      <div className='m-ck-actions'>
        <Button variant='outline' size='sm' disabled={Boolean(busy)} onClick={() => void query()}>
          {busy === `onboarding-query:${row.id}` ? t('查询中…') : t('查询任务')}
        </Button>
        <Button size='sm' disabled={Boolean(busy) || settled || !data || !data.tasks?.some(task => !task.done && !task.blocked)} onClick={() => void claim()}>
          {busy === `onboarding-claim:${row.id}` ? t('领取中…') : t('领取福利')}
        </Button>
      </div>
      {settled ? <p className='m-ck-note'>
        {t('一次性福利已结清，无需重复查询')}
        {settledAt ? ` · ${t('结算于 {time}', { time: formatStamp(settledAt) })}` : ''}
      </p> : null}
      {error ? <p className='m-ck-error'>{error}</p> : null}
      {data?.tasks?.map(task => <div className='m-ck-task' key={task.key}>
        <span className='m-ck-grow'>{task.title || task.key}{task.points ? ` · +${task.points}` : ''}</span>
        <Badge tone={task.done ? 'ok' : task.blocked ? 'mute' : 'warn'}>{task.done ? t('已领取') : task.blocked ? t('未解锁') : t('待领取')}</Badge>
      </div>)}
      {!data && !settled ? <p className='m-ck-note'>{t('点击查询后查看任务，领取操作由网关执行')}</p> : null}
    </div>
  )
}
