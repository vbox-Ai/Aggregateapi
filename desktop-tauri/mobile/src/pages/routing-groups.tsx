import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Label, SegmentedControl, Switch, Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui'
import { Badge, Empty, ErrorNote, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import { serverIdentity } from '../lib/servers'
import { formatInt } from '../lib/format'
import { providerLabel } from '../lib/providers'
import { t } from '../i18n'
import { apiCall } from '../api/client'
import {
  probeRoutingGroupWrite,
  stickyLabel,
  strategyLabel,
  type RoutingGroupBody,
  type RoutingGroupMember,
  type RoutingGroupsPayload,
} from '../api/routing'
import { store } from '../state/store'
import { RoutingGroupEditSheet } from './routing-group-edit-sheet'

/**
 * 路由组（只读）与选路预演。
 *
 * ── 能改什么、不能改什么 ──────────────────────────────────────
 * 保存走 `PUT /api/routing/groups`（上游 v3.4.2 就有这条路由，见
 * `api/routing.ts` 的说明 —— 我早前记的「网关没有写路由」是拿旧二进制推的，错的）。
 * 但手机端**只做安全子集**：组名、说明、成员的参与开关。对外模型 ID、策略、粘性，
 * 以及成员本身的增删都留在桌面端 —— 那几项直接影响真实转发，改错代价大。
 * 旧版网关没有这条路由，所以编辑入口先做**零副作用探测**（`probeRoutingGroupWrite`），
 * 不支持就保持只读并说明原因。
 *
 * ── 预演与「此刻队列」的分工 ──────────────────────────────────
 * `/api/routing/preview` 是**纯预演**：不发送请求、不消耗额度、不推进轮转，
 * 而且能模拟条件（这个模型是否需要工具调用 / 图片 / 视频，以及「首选失败」后
 * 会落到谁）。`/api/routing/queue` 是「此刻队列」——此刻真实会用的顺序。
 * 两者别混：一个是假设，一个是现状。
 *
 * 组预演才有「请求需要」这一档（桌面端同一取舍：没有组时固定按文本对话算）。
 */

/**
 * 组的形状只有一份定义：在上游契约那边（`api/routing.ts`）。这里只做别名，
 * 免得线上字段变了而页面这份没跟着变。
 */
export type RouteMember = RoutingGroupMember
export type RouteGroup = RoutingGroupBody

type RouteModelChoice = {
  provider: string
  providerLabel?: string
  model: string
  name?: string
  accountCount?: number
  capabilities?: {
    supportsToolCall?: boolean | null
    supportsImages?: boolean | null
    supportsVideo?: boolean | null
    supportsReasoning?: boolean | null
    maxInputTokens?: number | null
    maxOutputTokens?: number | null
  }
}

type RouteGroups = RoutingGroupsPayload<RouteModelChoice>

type PreviewEntry = {
  id: string
  name?: string
  provider?: string
  providerLabel?: string
  state?: string
  reason?: string
  resetAt?: number | null
}

type RoutePreview = {
  model?: string | null
  customized?: boolean
  settings?: { routingStrategy?: string; routingSticky?: string }
  queue?: { strategy?: string; sticky?: string; pickedId?: string; ordered?: PreviewEntry[]; blocked?: PreviewEntry[] }
  group?: RouteGroup | null
  preview?: boolean
}

/** 请求需要哪一类能力（影响候选过滤）。没有组时固定按文本对话算，与桌面端一致。 */
type PreviewNeed = 'text' | 'tools' | 'images' | 'video'

export function RoutingGroupsSection({ onPreviewGroup }: { onPreviewGroup: (group: RouteGroup) => void }) {
  const identity = serverIdentity()
  const [data, setData] = useState<RouteGroups | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState('')
  /** 编辑抽屉：正在编辑哪个组（连同打开时读到的 revision） */
  const [editing, setEditing] = useState<{ group: RouteGroup; revision: string } | null>(null)
  /** 写路由探测结果：null = 还没探测过 */
  const [writable, setWritable] = useState<boolean | null>(null)
  const [probeBusy, setProbeBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const next = await apiCall<RouteGroups>('/api/routing/groups')
      if (serverIdentity() !== identity) return
      setData(next)
      setError('')
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [identity])

  useEffect(() => { void load() }, [load])

  /**
   * 打开编辑器。第一次点先做**零副作用探测**（`probeRoutingGroupWrite`：
   * 拿一个不可能的 revision 去 PUT，revision 检查在写入之前，所以只会 409）。
   * 旧版网关没有这条路由 → 404/405 → 保持只读并说明原因，而不是让用户改完存不上。
   * 探测结果缓存起来，之后不再重复问。
   */
  const openEditor = async (group: RouteGroup, revision?: string) => {
    if (probeBusy) return
    let supported = writable
    if (supported === null) {
      setProbeBusy(true)
      try {
        supported = await probeRoutingGroupWrite()
        if (serverIdentity() !== identity) return
        setWritable(supported)
      } catch (cause) {
        if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
        return
      } finally {
        if (serverIdentity() === identity) setProbeBusy(false)
      }
    }
    if (serverIdentity() !== identity) return
    if (!supported) {
      store.toast(t('当前网关不支持保存路由组（缺少 PUT /api/routing/groups），请升级网关后再试'), 'err')
      return
    }
    if (!revision) {
      store.toast(t('这组的版本号缺失，请刷新列表后重试'), 'err')
      return
    }
    setEditing({ group, revision })
  }

  const groups = data?.groups || []
  const catalogModels = useMemo(() => {
    const set = new Set<string>()
    for (const item of data?.catalog || []) set.add(item.model)
    return [...set]
  }, [data])

  return (
    <div className='m-section'>
      <SectionHead title={t('路由组')} />
      <p className='m-ck-note'>
        {t('按模型把候选账号分组。手机端可以改组名、说明与成员是否参与；对外模型 ID、策略、粘性以及成员增删在桌面端「路由」画布上改。')}
      </p>
      {error ? <ErrorNote text={error} /> : null}

      {groups.length ? (
        groups.map(({ group, revision }) => {
          const open = openId === group.id
          return (
            <Card key={group.id} className='m-card' style={{ marginBottom: 10 }}>
              <Button
                size='default'
                variant='ghost'
                type='button'
                className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left'
                onClick={() => setOpenId(open ? '' : group.id)}
              >
                <span className='m-logo'><Icon name='grid' /></span>
                <div className='m-grow'>
                  <div className='m-t1'>{group.name || group.id}</div>
                  <div className='m-t2'>{group.model || t('未绑定模型')}</div>
                </div>
                <span className='m-chev'><Icon name={open ? 'down' : 'chev'} /></span>
              </Button>
              {open ? (
                <div style={{ padding: '0 14px 12px' }}>
                  {group.description ? (
                    <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, margin: '0 0 8px' }}>
                      {group.description}
                    </p>
                  ) : null}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <Badge tone='mute'>{t('策略')} {strategyLabel(group.strategy)}</Badge>
                    <Badge tone='mute'>{t('粘性')} {stickyLabel(group.sticky)}</Badge>
                    <Badge tone='mute'>{t('{n} 个成员', { n: group.members.length })}</Badge>
                  </div>
                  {group.members.length ? (
                    group.members.map(member => (
                      <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className='m-t1' style={{ fontSize: 12.5, opacity: member.included ? 1 : 0.55 }}>
                            {providerLabel(member.provider, member.provider)}
                            {member.model ? ` · ${member.model}` : ''}
                          </div>
                          <div className='m-t2'>{t('{n} 个账号', { n: member.accounts.length })}</div>
                        </div>
                        <Badge tone={member.included ? 'ok' : 'mute'}>
                          {member.included ? t('参与') : t('未参与')}
                        </Badge>
                      </div>
                    ))
                  ) : (
                    <p style={{ fontSize: 11.5, color: 'var(--m-text-3)' }}>{t('这个组还没有成员。')}</p>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <Button variant='outline' size='sm' onClick={() => onPreviewGroup(group)}>
                      {t('预演这个组')}
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      style={{ marginLeft: 8 }}
                      disabled={probeBusy}
                      onClick={() => void openEditor(group, revision)}
                    >
                      {t('编辑')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </Card>
          )
        })
      ) : (
        <Card className='m-card'><Empty text={data ? t('还没有路由组。') : t('正在读取路由组…')} /></Card>
      )}

      {data?.catalog?.length ? (
        <Card className='m-card' style={{ marginTop: 10 }}>
          <div style={{ padding: '10px 14px' }}>
            <div className='m-t1' style={{ fontSize: 12.5 }}>{t('可用模型目录')}</div>
            <div className='m-t2'>
              {t('{models} 个模型 · {choices} 个提供商组合', { models: catalogModels.length, choices: data.catalog.length })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {catalogModels.slice(0, 12).map(model => (
                <Badge key={model} tone='mute'>{model}</Badge>
              ))}
              {catalogModels.length > 12 ? (
                <Badge tone='mute'>{t('还有 {n} 个', { n: catalogModels.length - 12 })}</Badge>
              ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {editing ? (
        <RoutingGroupEditSheet<RouteModelChoice>
          group={editing.group}
          revision={editing.revision}
          onClose={() => setEditing(null)}
          onSaved={next => {
            setData(next)
            setError('')
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * 选路预演。
 *
 * 防抖 200ms + 「结果是否对应当前输入」的守卫 —— 与桌面端同一套：连点开关时
 * 后发的请求可能先回来，不比对输入就会把旧结果画上去。
 */
export function RoutingPreviewSheet({
  group,
  onClose,
}: {
  group?: RouteGroup
  onClose: () => void
}) {
  const identity = serverIdentity()
  const [model, setModel] = useState(group?.model || '')
  const [need, setNeed] = useState<PreviewNeed>('text')
  const [failFirst, setFailFirst] = useState(false)
  const [result, setResult] = useState<RoutePreview | null>(null)
  const [resolvedFor, setResolvedFor] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 没有组时固定按文本对话算（桌面端 `effectiveNeeds = group ? needs : 'text'`）
  const effectiveNeed: PreviewNeed = group ? need : 'text'
  const input = JSON.stringify({
    model,
    group: group || undefined,
    global: !group,
    needs: {
      tools: effectiveNeed === 'tools',
      images: effectiveNeed === 'images',
      video: effectiveNeed === 'video',
    },
    failFirst,
  })

  useEffect(() => {
    let alive = true
    setResult(null)
    setError('')
    if (!model) return
    setLoading(true)
    const timer = window.setTimeout(() => {
      apiCall<RoutePreview>('/api/routing/preview', { method: 'POST', body: JSON.parse(input) })
        .then(next => {
          if (!alive || serverIdentity() !== identity) return
          setResult(next)
          setResolvedFor(input)
        })
        .catch(cause => {
          if (!alive || serverIdentity() !== identity) return
          setError(cause instanceof Error ? cause.message : String(cause))
          setResolvedFor(input)
        })
        .finally(() => {
          if (alive && serverIdentity() === identity) setLoading(false)
        })
    }, 200)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [input, model, identity])

  const current = resolvedFor === input ? result : null
  const failure = resolvedFor === input ? error : ''
  const pending = Boolean(model) && (loading || resolvedFor !== input)
  const queue = current?.queue

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{group ? t('预演：{name}', { name: group.name || group.id }) : t('选路预演')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {failure ? <ErrorNote text={failure} /> : null}

          <Card className='m-card m-card-pad'>
            <Label htmlFor='preview-model'>{t('模型')}</Label>
            <Input
              id='preview-model'
              value={model}
              placeholder={t('例如：gpt-4o-mini')}
              onChange={event => setModel(event.currentTarget.value)}
            />
            {group ? (
              <div style={{ marginTop: 12 }}>
                <Label>{t('请求需要')}</Label>
                <SegmentedControl
                  options={[
                    { value: 'text', label: t('文本对话') },
                    { value: 'tools', label: t('工具调用') },
                    { value: 'images', label: t('图片输入') },
                    { value: 'video', label: t('视频输入') },
                  ]}
                  value={need}
                  aria-label={t('请求需要')}
                  onValueChange={value => setNeed(value as PreviewNeed)}
                />
              </div>
            ) : null}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <div className='m-t1' style={{ fontSize: 12.5 }}>{t('模拟首选失败')}</div>
                <div className='m-t2'>{t('看第一个候选不可用时，请求会落到谁。')}</div>
              </div>
              <Switch checked={failFirst} aria-label={t('模拟首选失败')} onCheckedChange={value => setFailFirst(value === true)} />
            </div>
          </Card>

          <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, margin: '10px 2px' }}>
            {t('按当前配置预演：不发送请求、不消耗额度、不会推进轮转。保存后才会影响真实请求。')}
            {failFirst || effectiveNeed !== 'text' ? ` ${t('（已启用模拟条件）')}` : ''}
          </p>

          {!model ? (
            <Card className='m-card'><Empty text={t('填入模型后开始预演。')} /></Card>
          ) : pending ? (
            <Card className='m-card'><Empty text={t('正在计算…')} /></Card>
          ) : current ? (
            <>
              <Card className='m-card m-card-pad'>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Badge tone={queue?.pickedId ? 'ok' : 'bad'}>
                    {queue?.pickedId ? t('预演首选') : t('没有可用账号')}
                  </Badge>
                  {queue?.strategy ? <Badge tone='mute'>{strategyLabel(queue.strategy)}</Badge> : null}
                  {queue?.sticky ? <Badge tone='mute'>{stickyLabel(queue.sticky)}</Badge> : null}
                  {current.preview ? <Badge tone='mute'>{t('预演')}</Badge> : null}
                </div>
                {queue?.pickedId ? (
                  <div className='m-mono' style={{ fontSize: 12.5 }}>#{queue.pickedId}</div>
                ) : (
                  <p style={{ fontSize: 12, color: 'var(--m-warn)', lineHeight: 1.7, margin: 0 }}>
                    {t('先处理凭证、限额或参与范围。')}
                  </p>
                )}
              </Card>

              <div className='m-section' style={{ marginTop: 14 }}>
                <SectionHead title={t('可用候选（{n}）', { n: queue?.ordered?.length || 0 })} />
                {queue?.ordered?.length ? (
                  <Card className='m-card'>
                    {queue.ordered.map((entry, index) => (
                      <div key={`${entry.id}-${index}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 14px', borderTop: index ? '1px solid var(--m-line)' : undefined }}>
                        <span className='m-mono' style={{ width: 26, flex: 'none', fontSize: 11, color: 'var(--m-text-3)' }}>#{entry.id}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className='m-t1' style={{ fontSize: 12.5 }}>{entry.name || entry.id}</div>
                          <div className='m-t2'>{providerLabel(entry.provider || '', entry.providerLabel)}</div>
                          {entry.reason ? (
                            <p style={{ fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.6, margin: '2px 0 0' }}>{entry.reason}</p>
                          ) : null}
                        </div>
                        {entry.state ? <Badge tone='mute'>{entry.state}</Badge> : null}
                      </div>
                    ))}
                  </Card>
                ) : (
                  <Card className='m-card'><Empty text={t('没有可用候选。')} /></Card>
                )}
              </div>

              {queue?.blocked?.length ? (
                <div className='m-section' style={{ marginTop: 14 }}>
                  <SectionHead title={t('被跳过（{n}）', { n: queue.blocked.length })} />
                  <Card className='m-card'>
                    {queue.blocked.map((entry, index) => (
                      <div key={`${entry.id}-b-${index}`} style={{ padding: '8px 14px', borderTop: index ? '1px solid var(--m-line)' : undefined }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className='m-mono' style={{ width: 26, flex: 'none', fontSize: 11, color: 'var(--m-text-3)' }}>#{entry.id}</span>
                          <span className='m-t1' style={{ flex: 1, fontSize: 12.5 }}>{entry.name || entry.id}</span>
                        </div>
                        {entry.reason ? (
                          <p style={{ fontSize: 11, color: 'var(--m-warn)', lineHeight: 1.7, margin: '2px 0 0 34px' }}>{entry.reason}</p>
                        ) : null}
                      </div>
                    ))}
                  </Card>
                </div>
              ) : null}
            </>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
