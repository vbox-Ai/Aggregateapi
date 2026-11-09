import { useEffect, useMemo, useState } from 'react'
import {
  Button, Card, Input, Label, MultiSelect, Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle,
  Switch, confirmDialog,
} from '@ui'
import { Badge, Empty, ErrorNote } from '../components/ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { providerLabel } from '../lib/providers'
import { t } from '../i18n'
import { ApiError, apiCall } from '../api/client'
import {
  deleteRoutingGroup, previewRoutingGroup, putRoutingGroup,
  type RoutingGroupBody, type RoutingGroupMember, type RoutingGroupsPayload, type RoutingPreview,
} from '../api/routing'
import { fetchAccounts, type Account } from '../api/gateway'

/** 目录里的一条可用模型（`GET /api/routing/groups` 的 `catalog`） */
export type RouteChoice = { provider: string; providerLabel?: string; model: string; name?: string }

/** 策略取值（上游 `RouteStrategy::from_id`；未知值回落顺序优先） */
const STRATEGIES = ['order', 'rotate', 'provider'] as const
/** 粘性取值（上游 `StickyMode::from_id`；未知值回落 auto） */
const STICKY_MODES = ['off', 'turn', 'session', 'auto'] as const

function strategyLabel(value: string): string {
  switch (value) {
    case 'order': return t('顺序优先')
    case 'rotate': return t('负载均衡')
    case 'provider': return t('家内轮询')
    default: return value
  }
}

function stickyLabel(value: string): string {
  switch (value) {
    case 'off': return t('不粘（每次都可能换号）')
    case 'turn': return t('一轮内不换号')
    case 'session': return t('会话内不换号（6 小时）')
    case 'auto': return t('自动（默认，5 分钟）')
    default: return value
  }
}

/**
 * 编辑一个路由组。
 *
 * ── 结构性编辑为什么要带三条护栏（见 `docs/mobile-ui/M2.7-ROUTING-EDIT-EVALUATION.md`）
 *  1. **原样 round-trip**：组与成员都是 `deny_unknown_fields`，多一个键少一个键都 400。
 *     所以草稿一律从读到的对象**展开**，只覆盖用户动过的字段 —— 本页不认识的字段
 *     逐字带回去。这既是「不越权」，也是唯一能通过校验的做法。
 *  2. **保存前预览**（`POST /api/routing/preview`，无副作用）：先看会选中谁、谁被挡、
 *     为什么，再决定存不存。改模型/策略/成员这类改动最需要它。
 *  3. **改「对外模型 ID」显式确认**：它是对外入口名，改了两件事会变 ——
 *     ① 客户端请求里的 `model` 必须跟着改；② 保存后**该模型（旧的）的会话粘性会被清掉**
 *     （上游 `put_group` 里写死的 `clear_route_sticky`）。这两句必须说在确认框里，
 *     不能塞进「保存成功」的提示里轻描淡写。
 *
 * ── revision 与并发 ─────────────────────────────────────────
 * `revision` 是整组内容的 SHA-256。保存时回传**打开抽屉时读到的**那个值；
 * 若别的设备/桌面端在这中间改过，后端返回 **409**。这不是错误而是并发保护，
 * 所以这里把它当成正常分支：重新拉一次清单、取回最新 revision 顶上来，
 * 让用户确认后再存 —— 而不是让草稿变成一个永远存不进去的死局。
 */
export function RoutingGroupEditSheet<Catalog extends RouteChoice = RouteChoice>({
  group,
  revision,
  catalog = [],
  canWrite = true,
  onClose,
  onSaved,
  onDeleted,
}: {
  group: RoutingGroupBody
  revision: string
  /** 可用模型目录，用于「加成员」；缺省为空表示拿不到目录（此时不提供新增成员入口） */
  catalog?: Catalog[]
  canWrite?: boolean
  onClose: () => void
  onSaved: (next: RoutingGroupsPayload<Catalog>) => void
  onDeleted?: (next: RoutingGroupsPayload<Catalog>) => void
}) {
  const identity = serverIdentity()
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description)
  const [model, setModel] = useState(group.model)
  const [strategy, setStrategy] = useState(group.strategy)
  const [sticky, setSticky] = useState(group.sticky)
  const [members, setMembers] = useState<RoutingGroupMember[]>(group.members)
  const [currentRevision, setCurrentRevision] = useState(revision)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState<RoutingPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [adding, setAdding] = useState('')

  // 账号列表用于成员的「参与账号」白名单（catalog 里没有账号 id）
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const payload = await fetchAccounts()
        if (!cancelled && serverIdentity() === identity) {
          setAccounts((payload as { accounts?: Account[] }).accounts || [])
        }
      } catch {
        /* 读不到账号列表就不让改白名单（保留原值），不影响其它字段 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [identity])

  /** 当前草稿（每次都从读到的对象展开，未知字段逐字带回） */
  const draft: RoutingGroupBody = useMemo(() => ({
    ...group,
    name: name.trim(),
    description,
    model: model.trim(),
    strategy,
    sticky,
    members,
  }), [group, name, description, model, strategy, sticky, members])

  const modelChanged = draft.model !== group.model

  /** 改动摘要：保存前给用户看，避免「点了保存但不知道改了什么」 */
  const changes: string[] = []
  if (draft.name !== group.name) changes.push(t('组名：{from} → {to}', { from: group.name, to: draft.name }))
  if (description !== group.description) changes.push(t('说明已修改'))
  if (modelChanged) changes.push(t('对外模型 ID：{from} → {to}', { from: group.model, to: draft.model }))
  if (strategy !== group.strategy) changes.push(t('策略：{from} → {to}', { from: strategyLabel(group.strategy), to: strategyLabel(draft.strategy) }))
  if (sticky !== group.sticky) changes.push(t('粘性：{from} → {to}', { from: stickyLabel(group.sticky), to: stickyLabel(draft.sticky) }))
  const memberLabel = (member: RoutingGroupMember) => `${providerLabel(member.provider, member.provider)} · ${member.model}`
  for (const member of group.members) {
    const next = members.find(item => item.id === member.id)
    if (!next) { changes.push(t('移除成员 {name}', { name: memberLabel(member) })); continue }
    if (next.included !== member.included) {
      changes.push(t('成员 {name}：{from} → {to}', {
        name: memberLabel(member),
        from: member.included ? t('参与') : t('不参与'),
        to: next.included ? t('参与') : t('不参与'),
      }))
    }
    if (next.accounts.slice().sort().join() !== member.accounts.slice().sort().join()) {
      changes.push(t('成员 {name} 的参与账号：{from} → {to}', {
        name: memberLabel(member), from: member.accounts.length, to: next.accounts.length,
      }))
    }
  }
  for (const member of members) {
    if (!group.members.some(item => item.id === member.id)) {
      changes.push(t('新增成员 {name}', { name: memberLabel(member) }))
    }
  }

  const patchMember = (id: string, patch: Partial<RoutingGroupMember>) => {
    setMembers(current => current.map(member => member.id === id ? { ...member, ...patch } : member))
  }

  const previewDraft = async () => {
    if (busy) return
    setBusy('preview')
    setPreviewError('')
    try {
      const result = await previewRoutingGroup({ model: draft.model, group: draft })
      if (serverIdentity() !== identity) return
      setPreview(result)
    } catch (cause) {
      if (serverIdentity() === identity) {
        setPreview(null)
        setPreviewError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const save = async () => {
    if (busy) return
    if (!draft.name) {
      setError(t('组名不能为空'))
      return
    }
    if (!draft.model) {
      setError(t('对外模型 ID 不能为空'))
      return
    }
    if (!changes.length) {
      setError(t('没有改动'))
      return
    }
    const lines = [...changes]
    if (modelChanged) {
      lines.push('', t('⚠️ 对外模型 ID 变了：客户端请求里的 model 必须改成「{model}」，否则会落到别的路由或不匹配。', { model: draft.model }))
      lines.push(t('⚠️ 保存后会清空「{model}」的会话粘性，正在进行的会话会重新选号。', { model: group.model }))
    }
    const ok = await confirmDialog(lines.join('\n'), {
      title: t('保存路由组「{name}」？', { name: group.name }),
      confirmText: t('保存'),
    })
    if (!ok) return
    setBusy('save')
    setError('')
    try {
      const result = await putRoutingGroup<Catalog>({ id: group.id, group: draft, revision: currentRevision })
      if (serverIdentity() !== identity) return
      onSaved(result)
      store.toast(t('已保存路由组'))
      onClose()
    } catch (cause) {
      if (serverIdentity() !== identity) return
      const status = cause instanceof ApiError ? cause.status : 0
      if (status === 409) {
        // 并发保护：拉最新的 revision 顶上来，让用户确认后再存
        try {
          const fresh = await apiRefreshGroups<Catalog>()
          if (serverIdentity() === identity) {
            const found = fresh.groups?.find(item => item.group.id === group.id)
            if (found?.revision) setCurrentRevision(found.revision)
            setError(t('这个组在别处被改过：已载入最新版本，请确认改动后再次保存。'))
          }
        } catch {
          setError(t('这个组在别处被改过；请关闭后刷新列表再试。'))
        }
      } else {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const remove = async () => {
    if (busy || !onDeleted) return
    const ok = await confirmDialog(
      t('删除路由组「{name}」？组内的成员与账号范围会一起删掉，客户端将无法再用模型「{model}」访问这个组。删除后「{model}」的会话粘性也会被清空。', {
        name: group.name, model: group.model,
      }),
      { title: t('删除路由组'), confirmText: t('删除'), destructive: true },
    )
    if (!ok) return
    setBusy('delete')
    setError('')
    try {
      const result = await deleteRoutingGroup<Catalog>({ id: group.id, revision: currentRevision })
      if (serverIdentity() !== identity) return
      onDeleted(result)
      store.toast(t('已删除路由组'))
      onClose()
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  /** 可加的成员：目录里去掉当前已存在的 (provider, model) */
  const choices = useMemo(() => {
    const taken = new Set(members.map(member => `${member.provider}:${member.model.toLowerCase()}`))
    return catalog.filter(choice => !taken.has(`${choice.provider}:${choice.model.toLowerCase()}`))
  }, [catalog, members])

  const addMember = (provider: string, choiceModel: string) => {
    // 成员 id 必须匹配 `[A-Za-z0-9-_.]{1,128}` 且组内唯一
    const base = `${provider}-${choiceModel}`.replace(/[^A-Za-z0-9-_.]/g, '-').slice(0, 100)
    let id = base
    let suffix = 1
    while (members.some(member => member.id === id)) id = `${base}-${suffix++}`
    setMembers(current => [...current, { id, provider, model: choiceModel, included: true, accounts: [] }])
    setAdding('')
  }

  const memberAccounts = (member: RoutingGroupMember) =>
    accounts.filter(account => account.provider === member.provider)

  return (
    <Sheet open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>{t('编辑路由组')} · {group.model}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}
          {!canWrite ? <ErrorNote text={t('这个网关不支持保存路由组（版本较旧），下面只能查看。')} /> : null}

          <div>
            <Label htmlFor='group-name'>{t('组名')}</Label>
            <Input id='group-name' value={name} disabled={!canWrite || Boolean(busy)}
              onChange={event => setName(event.currentTarget.value)} />
            <p className='m-ck-note'>{t('最多 64 个字符，不能为空。')}</p>
          </div>

          <div style={{ marginTop: 12 }}>
            <Label htmlFor='group-desc'>{t('说明')}</Label>
            <Input id='group-desc' value={description} disabled={!canWrite || Boolean(busy)}
              onChange={event => setDescription(event.currentTarget.value)} />
            <p className='m-ck-note'>{t('最多 500 个字符，可留空。')}</p>
          </div>

          <div style={{ marginTop: 12 }}>
            <Label htmlFor='group-model'>{t('对外模型 ID')}</Label>
            <Input id='group-model' value={model} disabled={!canWrite || Boolean(busy)}
              onChange={event => setModel(event.currentTarget.value)} />
            <p className='m-ck-note'>
              {t('客户端按这个名字请求这个组。小写英文字母，不能有空首尾空格；改了它，客户端也要跟着改。')}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <Label>{t('策略')}</Label>
              <Select value={strategy} disabled={!canWrite || Boolean(busy)}
                onValueChange={next => { if (typeof next === 'string') setStrategy(next) }}>
                <SelectTrigger className='w-full'><SelectValue>{strategyLabel(strategy)}</SelectValue></SelectTrigger>
                <SelectContent>
                  {STRATEGIES.map(item => <SelectItem key={item} value={item}>{strategyLabel(item)}</SelectItem>)}
                  {/* 不认识的值原样保留，别让一次编辑把配置改掉 */}
                  {STRATEGIES.includes(strategy as typeof STRATEGIES[number]) ? null
                    : <SelectItem value={strategy}>{strategy}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div style={{ flex: 1 }}>
              <Label>{t('会话粘性')}</Label>
              <Select value={sticky} disabled={!canWrite || Boolean(busy)}
                onValueChange={next => { if (typeof next === 'string') setSticky(next) }}>
                <SelectTrigger className='w-full'><SelectValue>{stickyLabel(sticky)}</SelectValue></SelectTrigger>
                <SelectContent>
                  {STICKY_MODES.map(item => <SelectItem key={item} value={item}>{stickyLabel(item)}</SelectItem>)}
                  {STICKY_MODES.includes(sticky as typeof STICKY_MODES[number]) ? null
                    : <SelectItem value={sticky}>{sticky}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <Label>{t('成员')}</Label>
            <p className='m-ck-note'>
              {t('关掉的成员不参与这个组的选路（等价于把它移出候选）；「参与账号」留空表示这个成员名下所有可用账号都参与。')}
            </p>
            {members.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                {members.map(member => {
                  const usable = memberAccounts(member)
                  return (
                    <Card key={member.id} className='m-card m-card-pad'>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className='m-t1' style={{ fontSize: 12.5 }}>{memberLabel(member)}</div>
                          <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                            <Badge tone='mute'>{member.accounts.length ? t('{n} 个账号参与', { n: member.accounts.length }) : t('全部账号')}</Badge>
                            {member.included ? null : <Badge tone='warn'>{t('已排除')}</Badge>}
                          </div>
                        </div>
                        <Switch checked={member.included} disabled={!canWrite || Boolean(busy)}
                          aria-label={`${member.provider} ${member.model}`}
                          onCheckedChange={next => patchMember(member.id, { included: next === true })} />
                        <Button variant='ghost' size='sm' disabled={!canWrite || Boolean(busy)}
                          onClick={() => setMembers(current => current.filter(item => item.id !== member.id))}>
                          {t('移除')}
                        </Button>
                      </div>

                      <div style={{ marginTop: 8 }}>
                        <Label>{t('参与账号（留空=全部）')}</Label>
                        <MultiSelect
                          value={member.accounts}
                          disabled={!canWrite || Boolean(busy) || usable.length === 0}
                          options={usable.map(account => ({
                            value: account.id,
                            label: account.displayName || account.name || account.id,
                          }))}
                          placeholder={usable.length ? t('全部账号') : t('这个提供商没有可用账号')}
                          aria-label={t('参与账号')}
                          onValueChange={items => patchMember(member.id, { accounts: items })}
                        />
                      </div>
                    </Card>
                  )
                })}
              </div>
            ) : (
              <Empty text={t('这个组还没有成员。')} />
            )}

            {canWrite && choices.length ? (
              <div style={{ marginTop: 10 }}>
                {adding ? (
                  <Select value='' onValueChange={next => { if (typeof next === 'string' && next) { const [provider, model] = next.split('\u0000'); addMember(provider, model) } }}>
                    <SelectTrigger className='w-full' aria-label={t('选择要加入的模型')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {choices.map(choice => (
                        <SelectItem key={`${choice.provider}\u0000${choice.model}`} value={`${choice.provider}\u0000${choice.model}`}>
                          {choice.providerLabel || providerLabel(choice.provider, choice.provider)} · {choice.name || choice.model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Button variant='outline' size='sm' className='w-full' disabled={Boolean(busy)}
                    onClick={() => setAdding('pick')}>
                    {t('添加成员')}
                  </Button>
                )}
              </div>
            ) : null}
          </div>

          {/* 预览：无副作用的草稿预演，改结构之前先看会选中谁 */}
          <div style={{ marginTop: 14 }}>
            <Label>{t('预览（不会保存）')}</Label>
            <p className='m-ck-note'>{t('用当前草稿算一遍选路：谁会被选中、谁被挡住、为什么。改模型/策略/成员之前建议先看一次。')}</p>
            <Button variant='outline' size='sm' disabled={Boolean(busy)} onClick={() => void previewDraft()}>
              {busy === 'preview' ? t('预演中…') : t('用当前草稿预演')}
            </Button>
            {previewError ? <ErrorNote text={previewError} /> : null}
            {preview ? (
              <Card className='m-card m-card-pad' style={{ marginTop: 8 }}>
                <div className='m-ck-note'>
                  {t('策略 {strategy} · 粘性 {sticky}', {
                    strategy: strategyLabel(preview.queue?.strategy || draft.strategy),
                    sticky: stickyLabel(preview.queue?.sticky || draft.sticky),
                  })}
                </div>
                <div style={{ marginTop: 6, fontSize: 12.5 }}>{t('候选顺序（前 8 个）')}</div>
                <div style={{ marginTop: 4 }}>
                  {(preview.queue?.ordered || []).slice(0, 8).map((row, index) => (
                    <div key={row.id || index} style={{ fontSize: 12, display: 'flex', gap: 6 }}>
                      <span className='m-mono' style={{ color: 'var(--m-text-3)' }}>{index + 1}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {row.name || row.id} · {row.providerLabel || row.provider}
                      </span>
                      {index === 0 ? <Badge tone='mute'>{t('会选中')}</Badge> : null}
                    </div>
                  ))}
                  {!(preview.queue?.ordered || []).length ? (
                    <div style={{ fontSize: 12, color: 'var(--m-text-3)' }}>{t('没有可用候选')}</div>
                  ) : null}
                </div>
                {(preview.queue?.blocked || []).length ? (
                  <>
                    <div style={{ marginTop: 8, fontSize: 12.5 }}>{t('被挡住（前 5 个）')}</div>
                    <div style={{ marginTop: 4 }}>
                      {(preview.queue?.blocked || []).slice(0, 5).map((row, index) => (
                        <div key={row.id || index} style={{ fontSize: 12, color: 'var(--m-text-2)' }}>
                          {row.name || row.id}：{row.reason || row.state}
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
              </Card>
            ) : null}
          </div>

          {changes.length ? (
            <Card className='m-card m-card-pad' style={{ marginTop: 12 }}>
              <div className='m-ck-title'>{t('本次改动（{n} 项）', { n: changes.length })}</div>
              {changes.map(line => <div key={line} style={{ fontSize: 12, color: 'var(--m-text-2)' }}>{line}</div>)}
              {modelChanged ? (
                <div style={{ fontSize: 12, color: 'var(--m-danger)', marginTop: 6 }}>
                  {t('改对外模型 ID 会清空「{model}」的会话粘性，客户端也要改用新名字。', { model: group.model })}
                </div>
              ) : null}
            </Card>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={Boolean(busy)} onClick={onClose}>{t('取消')}</Button>
          {canWrite && onDeleted ? (
            <Button variant='destructive' disabled={Boolean(busy)} onClick={() => void remove()}>
              {busy === 'delete' ? t('删除中…') : t('删除')}
            </Button>
          ) : null}
          <Button disabled={!canWrite || Boolean(busy) || !changes.length} onClick={() => void save()}>
            {busy === 'save' ? t('保存中…') : changes.length ? t('保存 {n} 项改动', { n: changes.length }) : t('没有改动')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** 409 之后重拉一次清单：拿回最新 revision，让用户确认后还能存进去 */
async function apiRefreshGroups<Catalog>(): Promise<RoutingGroupsPayload<Catalog>> {
  return apiCall<RoutingGroupsPayload<Catalog>>('/api/routing/groups')
}
