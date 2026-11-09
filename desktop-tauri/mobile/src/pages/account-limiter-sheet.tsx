import { useEffect, useMemo, useState } from 'react'
import {
  Button, Card, Label, MultiSelect, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Switch, Input,
} from '@ui'
import { Empty, SectionHead } from '../components/ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { fetchUsageSnapshot, type Account } from '../api/gateway'
import { saveLimiterGroups } from '../api/limiter'
import {
  adoptLimiterSnapshot, conditionText, defaultCondition, expressionText, groupsOf, metricLabel, modelsOf,
  readingText, sourceLabel, sourcesOf, statesOf, useLimiterSnapshot, windowLabel,
  type LimiterAccountFields, type LimiterComparison, type LimiterCondition, type LimiterGroup, type LimiterMetric,
  type LimiterSnapshot, type LimiterWindow,
} from '../lib/limiter'
import { t } from '../i18n'

const METRICS: LimiterMetric[] = ['remaining', 'remaining_percent', 'used', 'used_percent', 'tokens', 'requests']
const COMPARISONS: Array<{ value: LimiterComparison; label: string }> = [
  { value: 'lt', label: '<' }, { value: 'lte', label: '≤' }, { value: 'gte', label: '≥' },
]
const WINDOW_PRESETS: Array<LimiterWindow['reset']> = ['fixed', 'rolling', 'daily', 'weekly', 'monthly', 'total']

/**
 * 账号限流规则编辑。
 *
 * ── 它做什么 ──────────────────────────────────────────────────
 * 限流规则 = 「当某个额度读数满足某组条件时，跳过这个账号（或直接停用它）」。
 * 一组规则里可以有多条条件、用「与 / 或」串起来；每条条件指定
 * **额度来源 + 模型范围 + 指标 + 比较 + 阈值 + 统计窗口**。
 *
 * ── 与桌面端的关系（有意的范围界定）──────────────────────────
 * 手机端 `AccountSheet` 原本写着「账号的凭证、代理、限流规则都是多字段表单，
 * 编辑仍回桌面端」。这一项把**限流规则**单独做出来，因为它最常被临时改
 * （账号被上游限了，想先让它跳过），而凭证/代理那种一次性配置留在桌面端更合理。
 * 条件里的字段与桌面端一一对应，标签与描述文案也用同一批（`lib/limiter.ts` 移植）。
 *
 * ── 两条不破坏数据的做法 ──────────────────────────────────────
 *  1. **改字段用展开**（`{...condition, threshold}`）：`condition.source` 是一整份
 *     额度来源的快照，界面不认识它的全部字段，也不需要认识 —— 展开能原样带回去。
 *  2. **保存整组**：`PATCH` 的 `limiterGroups` 是**整块替换**，所以面板始终持有
 *     完整草稿（读出来就是完整的一组），不做增量提交。
 */
export function AccountLimiterSheet({ account, onClose, onChanged }: {
  account: Account
  onClose: () => void
  onChanged: () => void
}) {
  const fields = account as Account & LimiterAccountFields
  const [groups, setGroups] = useState<LimiterGroup[] | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const identity = serverIdentity()
  const snapshot = useLimiterSnapshot()

  // 打开时拉一次用量快照：读数、额度来源、可选模型都在里面（只读记录表，不打上游）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await fetchUsageSnapshot()
        // 快照里**确实**带着 `limiterStates` / `quotaSources` / `limiterModels`
        // （上游 `usage_query.rs` 构造的那三个键），只是手机端的 `UsageSnapshot`
        // 类型当初没写全，所以这里显式断言而不是改公共类型。
        if (!cancelled && serverIdentity() === identity) adoptLimiterSnapshot(data as LimiterSnapshot)
      } catch {
        /* 快照读不到不影响编辑：来源退回"账号主额度/本地用量保护"两条默认项 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [identity])

  useEffect(() => {
    setGroups(groupsOf(fields, fields.limiters || []))
    // 只在账号切换时重置草稿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id])

  const sources = useMemo(() => sourcesOf(fields), [fields, snapshot])
  const models = useMemo(() => modelsOf(fields), [fields, snapshot])
  const states = statesOf(fields)

  const patchGroup = (index: number, patch: Partial<LimiterGroup>) => {
    setGroups(current => current?.map((group, position) => position === index ? { ...group, ...patch } : group) ?? current)
  }

  const patchCondition = (groupIndex: number, conditionIndex: number, patch: Partial<LimiterCondition>) => {
    setGroups(current => current?.map((group, position) => position !== groupIndex ? group : {
      ...group,
      conditions: group.conditions.map((condition, index) => index === conditionIndex ? { ...condition, ...patch } : condition),
    }) ?? current)
  }

  const save = async () => {
    if (busy || !groups) return
    setBusy('save')
    setError('')
    try {
      await saveLimiterGroups(account.id, groups)
      if (serverIdentity() !== identity) return
      store.toast(t('限流规则已保存'))
      onChanged()
      onClose()
    } catch (failure) {
      if (serverIdentity() === identity) {
        setError(failure instanceof Error ? failure.message : String(failure))
      }
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const metricOptions = METRICS.map(metric => ({ value: metric, label: metricLabel(metric) }))

  return (
    <Sheet open onOpenChange={(open, details) => {
      if (open) return
      if (busy) { details.cancel(); return }
      onClose()
    }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader><SheetTitle>{t('限流规则')}</SheetTitle></SheetHeader>
        <SheetBody>
          {!groups ? (
            <div style={{ padding: 16 }}><Empty text={t('读取中…')} /></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
              <p style={{ fontSize: 12.5, lineHeight: 1.7, color: 'var(--m-text-2)' }}>
                {t('当额度读数满足条件时，网关会跳过这个账号（或直接停用它）。条件里「本地」指的是本机统计的用量，「账号」指的是上游回报的额度。')}
              </p>

              {groups.length ? groups.map((group, groupIndex) => {
                const state = states[groupIndex]
                return (
                  <Card key={groupIndex} className='m-card m-card-pad'>
                    <div className='m-ck-toolbar'>
                      <div className='m-ck-grow'>
                        <div className='m-ck-title'>
                          {group.action === 'disable' ? t('停用账号') : t('跳过账号')}
                          {' · '}
                          {group.target === 'models' ? t('仅影响列出的模型') : t('影响整个账号')}
                        </div>
                        <div className='m-ck-note'>
                          {group.conditions.length ? expressionText(group.conditions, fields) : t('还没有条件')}
                        </div>
                      </div>
                      <Switch checked={group.enabled} disabled={Boolean(busy)} aria-label={t('启用这组规则')}
                        onCheckedChange={enabled => patchGroup(groupIndex, { enabled })} />
                      <Button variant='ghost' size='sm' disabled={Boolean(busy)}
                        onClick={() => setGroups(current => current?.filter((_, position) => position !== groupIndex) ?? current)}>
                        {t('删除')}
                      </Button>
                    </div>

                    {state?.hit ? (
                      <p style={{ fontSize: 12, color: 'var(--m-danger)' }}>{t('当前已命中：这个账号正在被跳过')}</p>
                    ) : null}

                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                      <div style={{ flex: 1 }}>
                        <Label>{t('动作')}</Label>
                        <Select value={group.action}
                          onValueChange={next => { if (typeof next === 'string') patchGroup(groupIndex, { action: next as LimiterGroup['action'] }) }}>
                          <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value='skip'>{t('跳过账号')}</SelectItem>
                            <SelectItem value='disable'>{t('停用账号')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div style={{ flex: 1 }}>
                        <Label>{t('作用范围')}</Label>
                        <Select value={group.target}
                          onValueChange={next => { if (typeof next === 'string') patchGroup(groupIndex, { target: next as LimiterGroup['target'] }) }}>
                          <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value='account'>{t('整个账号')}</SelectItem>
                            <SelectItem value='models'>{t('仅列出的模型')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {group.conditions.map((condition, conditionIndex) => {
                      const reading = state?.readings?.[conditionIndex]
                      const sourceId = condition.sourceId
                        || (condition.metric === 'tokens' || condition.metric === 'requests' ? 'local' : 'account')
                      return (
                        <div key={conditionIndex} style={{ borderTop: '1px solid var(--m-line)', marginTop: 10, paddingTop: 10 }}>
                          {conditionIndex > 0 ? (
                            <div style={{ marginBottom: 8 }}>
                              <Label>{t('与前一条的关系')}</Label>
                              <Select value={condition.join}
                                onValueChange={next => { if (typeof next === 'string') patchCondition(groupIndex, conditionIndex, { join: next as LimiterCondition['join'] }) }}>
                                <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value='or'>{t('或')}</SelectItem>
                                  <SelectItem value='and'>{t('与')}</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          ) : null}

                          <div>
                            <Label>{t('额度来源')}</Label>
                            <Select value={sourceId}
                              onValueChange={next => { if (typeof next === 'string') patchCondition(groupIndex, conditionIndex, { sourceId: next === 'account' || next === 'local' ? '' : next }) }}>
                              <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {sources.map(source => (
                                  <SelectItem key={source.id} value={source.id}>{sourceLabel(source, source.id)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div style={{ marginTop: 8 }}>
                            <Label>{t('模型范围')}</Label>
                            <MultiSelect value={condition.models} options={models} placeholder={t('全部模型')}
                              aria-label={t('模型范围')}
                              onValueChange={items => patchCondition(groupIndex, conditionIndex, { models: items })} />
                          </div>

                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <div style={{ flex: 1 }}>
                              <Label>{t('指标')}</Label>
                              <Select value={condition.metric}
                                onValueChange={next => { if (typeof next === 'string') patchCondition(groupIndex, conditionIndex, { metric: next as LimiterMetric }) }}>
                                <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {metricOptions.map(option => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div style={{ width: 92 }}>
                              <Label>{t('比较')}</Label>
                              <Select value={condition.comparison}
                                onValueChange={next => { if (typeof next === 'string') patchCondition(groupIndex, conditionIndex, { comparison: next as LimiterComparison }) }}>
                                <SelectTrigger className='w-full'><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {COMPARISONS.map(option => (
                                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div style={{ marginTop: 8 }}>
                            <Label>{t('阈值')}</Label>
                            <Input inputMode='decimal' value={String(condition.threshold ?? '')}
                              disabled={Boolean(busy)}
                              onChange={event => {
                                const parsed = Number(event.currentTarget.value)
                                patchCondition(groupIndex, conditionIndex, {
                                  threshold: Number.isFinite(parsed) ? parsed : 0,
                                })
                              }} />
                          </div>

                          <div style={{ marginTop: 8 }}>
                            <Label>{t('统计窗口')}</Label>
                            <Select value={condition.window?.reset || 'none'}
                              onValueChange={next => {
                                if (typeof next !== 'string') return
                                const window = next === 'none' ? null : {
                                  ...(condition.window || {}), reset: next as LimiterWindow['reset'],
                                  ...(next === 'fixed' || next === 'rolling'
                                    ? { seconds: Number(condition.window?.seconds) || 3600 } : {}),
                                } as LimiterWindow
                                patchCondition(groupIndex, conditionIndex, { window })
                              }}>
                              <SelectTrigger className='w-full'>
                                <SelectValue>{condition.window ? windowLabel(condition.window) : t('不限窗口')}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value='none'>{t('不限窗口')}</SelectItem>
                                {WINDOW_PRESETS.map(preset => (
                                  <SelectItem key={preset} value={preset}>{windowLabel({ reset: preset })}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {condition.window && (condition.window.reset === 'fixed' || condition.window.reset === 'rolling') ? (
                              <Input inputMode='numeric' style={{ marginTop: 6 }} disabled={Boolean(busy)}
                                value={String(condition.window.seconds ?? '')}
                                aria-label={t('窗口秒数')}
                                onChange={event => {
                                  const parsed = Number(event.currentTarget.value)
                                  patchCondition(groupIndex, conditionIndex, {
                                    window: { ...condition.window, seconds: Number.isFinite(parsed) ? parsed : 0 } as LimiterWindow,
                                  })
                                }} />
                            ) : null}
                          </div>

                          <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 8 }}>
                            {conditionText(condition, fields)}
                          </p>
                          <p style={{ fontSize: 11.5, color: 'var(--m-text-2)' }}>
                            {readingText(reading, condition, fields)}
                          </p>

                          <div style={{ marginTop: 8 }}>
                            <Button variant='ghost' size='sm' disabled={Boolean(busy) || group.conditions.length <= 1}
                              onClick={() => setGroups(current => current?.map((item, position) => position !== groupIndex ? item : {
                                ...item, conditions: item.conditions.filter((_, index) => index !== conditionIndex),
                              }) ?? current)}>
                              {t('删除这条条件')}
                            </Button>
                          </div>
                        </div>
                      )
                    })}

                    <Button variant='outline' size='sm' style={{ marginTop: 10 }} disabled={Boolean(busy)}
                      onClick={() => setGroups(current => current?.map((item, position) => position !== groupIndex ? item : {
                        ...item, conditions: [...item.conditions, defaultCondition()],
                      }) ?? current)}>
                      {t('添加条件')}
                    </Button>
                  </Card>
                )
              }) : <Card className='m-card'><Empty text={t('这个账号还没有限流规则')} /></Card>}

              <div className='m-section' style={{ marginTop: 0 }}>
                <SectionHead title={t('新增')} />
                <Button variant='outline' size='sm' className='w-full' disabled={Boolean(busy)}
                  onClick={() => setGroups(current => [...(current || []), {
                    enabled: true, action: 'skip', target: 'account', conditions: [defaultCondition()],
                  }])}>
                  {t('添加一组规则')}
                </Button>
              </div>

              {error ? <p style={{ fontSize: 12, color: 'var(--m-danger)', whiteSpace: 'pre-wrap' }}>{error}</p> : null}
            </div>
          )}
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={Boolean(busy)} onClick={onClose}>{t('取消')}</Button>
          <Button disabled={Boolean(busy) || !groups} onClick={() => void save()}>
            {busy === 'save' ? t('保存中…') : t('保存')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
