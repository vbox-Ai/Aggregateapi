import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Label, SegmentedControl, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Switch, confirmDialog } from '@ui'
import { Badge, Empty, ErrorNote, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import { serverIdentity } from '../lib/servers'
import { providerLabel } from '../lib/providers'
import { t } from '../i18n'
import { apiCall } from '../api/client'
import { fetchRouting, stickyLabel, strategyLabel } from '../api/routing'

/**
 * 路由参与范围与顺序（`PUT /api/routing/profile`）。
 *
 * ── 这是这一板块**唯一会写全局配置**的一屏，所以规矩比别处严 ──────────
 * 1. **只发变过的键**：后端对不认识的键静默忽略，全量发会掩盖键名写错
 *    （路由设置那次就是这么被掩盖的，见记忆点步骤 13）；
 * 2. **带上 `revision`**：桌面端也传，后端据此做乐观锁 —— 别人（桌面端 / 另一台
 *    手机）改过之后我们这一份就过期了，宁可报冲突也不要覆盖；
 * 3. **保存前有一次明确的确认**：它影响的是真实转发的账号集合；
 * 4. **保存后用服务端返回值回填**，不拿本地草稿当准。
 *
 * ── 两档参与语义（与桌面端 `routing-provider-card.tsx` 同一口径）────
 * · `providerScope === 'selected'` 时逐家开关，写 `providers` / `disabledProviders`；
 * · 逐条账号开关写 `excludedAccounts`；
 * · 顺序写 `accountOrder[providerId]`，有效顺序 =
 *   `[...new Set([...(已存顺序), ...全部账号])]` 再滤掉不存在的账号。
 *
 * `profile: null` 是「删除独立配置、回落到继承全局」——单独一个动作，要二次确认。
 */

type WorkspaceProvider = { id: string; label?: string; accountCount?: number; custom?: boolean; available?: boolean }
type WorkspaceAccount = { id: string; provider?: string; name?: string; nickname?: string; enabled?: boolean; hasCredentials?: boolean }

type RouteProfile = {
  providerScope?: 'all' | 'selected'
  providers?: string[]
  disabledProviders?: string[]
  accountOrder?: Record<string, string[]>
  excludedAccounts?: string[]
  strategy?: string
  sticky?: string
}

type Workspace = {
  model?: string | null
  customized?: boolean
  globalCustomized?: boolean
  globalAccountControl?: boolean
  profile?: RouteProfile
  inheritedProfile?: RouteProfile
  providers?: WorkspaceProvider[]
  accounts?: WorkspaceAccount[]
  revision?: string
}

const EMPTY: RouteProfile = {
  providerScope: 'all',
  providers: [],
  disabledProviders: [],
  accountOrder: {},
  excludedAccounts: [],
}

export function RoutingProfileSheet({ scope, onClose }: { scope: string; onClose: () => void }) {
  const identity = serverIdentity()
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [baseline, setBaseline] = useState<RouteProfile | null>(null)
  const [draft, setDraft] = useState<RouteProfile>(EMPTY)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await apiCall<Workspace>(`/api/routing/workspace${scope ? `?model=${encodeURIComponent(scope)}` : ''}`)
      if (serverIdentity() !== identity) return
      // 该模型没做过独立配置时，服务端给的是 inheritedProfile（继承来的那份）
      const effective: RouteProfile = next.profile || next.inheritedProfile || EMPTY
      setWorkspace(next)
      setBaseline({
        providerScope: effective.providerScope || 'all',
        providers: [...(effective.providers || [])],
        disabledProviders: [...(effective.disabledProviders || [])],
        accountOrder: { ...(effective.accountOrder || {}) },
        excludedAccounts: [...(effective.excludedAccounts || [])],
        strategy: effective.strategy,
        sticky: effective.sticky,
      })
      setDraft({
        providerScope: effective.providerScope || 'all',
        providers: [...(effective.providers || [])],
        disabledProviders: [...(effective.disabledProviders || [])],
        accountOrder: { ...(effective.accountOrder || {}) },
        excludedAccounts: [...(effective.excludedAccounts || [])],
        strategy: effective.strategy,
        sticky: effective.sticky,
      })
      setError('')
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setLoading(false)
    }
  }, [identity, scope])

  useEffect(() => { void load() }, [load])

  const accounts = workspace?.accounts || []
  const providers = workspace?.providers || []
  const independent = scope ? workspace?.customized === true : workspace?.globalCustomized === true

  const accountsOf = useMemo(() => {
    const map = new Map<string, WorkspaceAccount[]>()
    for (const account of accounts) {
      const id = account.provider || ''
      map.set(id, [...(map.get(id) || []), account])
    }
    return map
  }, [accounts])

  /** 有效顺序：已存顺序在前，其余按账号表顺序补齐，再滤掉不存在的账号（与桌面端一致） */
  const orderOf = (providerId: string): WorkspaceAccount[] => {
    const rows = accountsOf.get(providerId) || []
    const stored = draft.accountOrder?.[providerId] || []
    const seen = new Set<string>()
    const ordered: WorkspaceAccount[] = []
    for (const id of [...stored, ...rows.map(row => row.id)]) {
      if (seen.has(id)) continue
      seen.add(id)
      const found = rows.find(row => row.id === id)
      if (found) ordered.push(found)
    }
    return ordered
  }

  const setOrder = (providerId: string, ids: string[]) => {
    setDraft(current => ({ ...current, accountOrder: { ...(current.accountOrder || {}), [providerId]: ids } }))
  }

  const moveAccount = (providerId: string, id: string, delta: number) => {
    const rows = orderOf(providerId)
    const ids = rows.map(row => row.id)
    const index = ids.indexOf(id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= ids.length) return
    const next = [...ids]
    next.splice(index, 1)
    next.splice(target, 0, id)
    setOrder(providerId, next)
  }

  const toggleProvider = (providerId: string) => {
    setDraft(current => {
      const scopeMode = current.providerScope || 'all'
      const providersList = current.providers || []
      const disabled = current.disabledProviders || []
      if (scopeMode === 'selected') {
        // 选定模式：在 providers 里加减
        return {
          ...current,
          providers: providersList.includes(providerId)
            ? providersList.filter(id => id !== providerId)
            : [...providersList, providerId],
        }
      }
      // 全部模式：在 disabledProviders 里加减（取反表示排除）
      return {
        ...current,
        disabledProviders: disabled.includes(providerId)
          ? disabled.filter(id => id !== providerId)
          : [...disabled, providerId],
      }
    })
  }

  const toggleAccount = (accountId: string) => {
    setDraft(current => {
      const excluded = current.excludedAccounts || []
      return {
        ...current,
        excludedAccounts: excluded.includes(accountId)
          ? excluded.filter(id => id !== accountId)
          : [...excluded, accountId],
      }
    })
  }

  /** 变化的键（含数组/对象的浅比较）；没有变化就返回空 */
  const changed = useMemo(() => {
    if (!baseline) return {} as RouteProfile
    const patch: RouteProfile = {}
    const sameArray = (left?: string[], right?: string[]) =>
      JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort())
    if ((draft.providerScope || 'all') !== (baseline.providerScope || 'all')) patch.providerScope = draft.providerScope
    if (!sameArray(draft.providers, baseline.providers)) patch.providers = draft.providers || []
    if (!sameArray(draft.disabledProviders, baseline.disabledProviders)) patch.disabledProviders = draft.disabledProviders || []
    if (!sameArray(draft.excludedAccounts, baseline.excludedAccounts)) patch.excludedAccounts = draft.excludedAccounts || []
    if (JSON.stringify(draft.accountOrder || {}) !== JSON.stringify(baseline.accountOrder || {})) patch.accountOrder = draft.accountOrder || {}
    if ((draft.strategy || '') !== (baseline.strategy || '')) patch.strategy = draft.strategy
    if ((draft.sticky || '') !== (baseline.sticky || '')) patch.sticky = draft.sticky
    return patch
  }, [baseline, draft])

  const dirty = Object.keys(changed).length > 0

  const save = async () => {
    if (busy || !dirty) return
    if (Object.keys(changed).length === 0) {
      setError('')
      return
    }
    const where = scope || t('全局默认')
    const ok = await confirmDialog(
      t('要保存 {where} 的路由参与范围吗？它会改变真实转发时使用的账号集合，保存后对下一个请求生效。', { where }),
      { title: t('保存参与范围'), confirmText: t('保存') },
    )
    if (!ok) return
    setBusy('save')
    setError('')
    try {
      // 传完整 profile：后端按整份覆盖该模型这一档，语义比「补丁」清楚
      const body = {
        model: scope || null,
        profile: { ...(baseline || EMPTY), ...draft },
        revision: workspace?.revision,
      }
      const next = await apiCall<Workspace>('/api/routing/profile', { method: 'PUT', body })
      if (serverIdentity() !== identity) return
      setWorkspace(next)
      const effective: RouteProfile = next.profile || next.inheritedProfile || EMPTY
      setBaseline({ ...effective, providers: [...(effective.providers || [])], disabledProviders: [...(effective.disabledProviders || [])], excludedAccounts: [...(effective.excludedAccounts || [])], accountOrder: { ...(effective.accountOrder || {}) } })
      setDraft({ ...effective, providers: [...(effective.providers || [])], disabledProviders: [...(effective.disabledProviders || [])], excludedAccounts: [...(effective.excludedAccounts || [])], accountOrder: { ...(effective.accountOrder || {}) } })
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const removeIndependent = async () => {
    const ok = await confirmDialog(
      t('删除 {where} 的独立配置，它会回落到继承全局。真实转发会立刻按继承来的那份走。', { where: scope }),
      { title: t('删除独立配置'), confirmText: t('删除'), destructive: true },
    )
    if (!ok) return
    setBusy('remove')
    setError('')
    try {
      // profile: null = 删除独立配置（后端据此回落继承）
      await apiCall<Workspace>('/api/routing/profile', { method: 'PUT', body: { model: scope, profile: null, revision: workspace?.revision } })
      if (serverIdentity() !== identity) return
      await load()
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const scopeMode = draft.providerScope || 'all'

  return (
    <Sheet open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>{t('参与范围')} · {scope || t('全局默认')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}

          {loading ? <Card className='m-card'><Empty text={t('正在读取路由配置…')} /></Card> : null}

          {!loading && baseline ? (
            <>
              <Card className='m-card m-card-pad'>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Badge tone={independent ? 'ok' : 'mute'}>
                    {independent ? t('独立配置') : t('继承全局')}
                  </Badge>
                  {draft.strategy ? <Badge tone='mute'>{strategyLabel(draft.strategy)}</Badge> : null}
                  {draft.sticky ? <Badge tone='mute'>{stickyLabel(draft.sticky)}</Badge> : null}
                </div>
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 8 }}>
                  {scope
                    ? t('这里是这个模型自己的参与范围；保存后它就不再跟随全局。')
                    : t('这里是全局默认，所有没有独立配置的模型都按它走。')}
                </p>
              </Card>

              <div className='m-section' style={{ marginTop: 14 }}>
                <SectionHead title={t('参与的家')} />
                <Card className='m-card m-card-pad'>
                  <SegmentedControl
                    options={[
                      { value: 'all', label: t('全部家') },
                      { value: 'selected', label: t('仅选定的家') },
                    ]}
                    value={scopeMode}
                    aria-label={t('参与的家')}
                    onValueChange={value => setDraft({ ...draft, providerScope: value as 'all' | 'selected' })}
                  />
                  <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 8 }}>
                    {scopeMode === 'selected'
                      ? t('只有下面打开的家参与这个范围；关掉的家整体不参与。')
                      : t('所有家都参与，除非在下面把它关掉。')}
                  </p>
                  {providers.map(provider => {
                    const inList = (draft.providers || []).includes(provider.id)
                    const outList = (draft.disabledProviders || []).includes(provider.id)
                    const on = scopeMode === 'selected' ? inList : !outList
                    const count = accountsOf.get(provider.id)?.length || 0
                    return (
                      <div key={provider.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--m-line)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className='m-t1' style={{ fontSize: 12.5 }}>{provider.label || providerLabel(provider.id, provider.id)}</div>
                          <div className='m-t2'>
                            {t('{n} 个账号', { n: count })}
                            {provider.available === false ? ` · ${t('模型绑定不可用')}` : ''}
                          </div>
                        </div>
                        <Switch
                          checked={on}
                          aria-label={t('让这家参与')}
                          onCheckedChange={() => toggleProvider(provider.id)}
                        />
                      </div>
                    )
                  })}
                </Card>
              </div>

              <div className='m-section' style={{ marginTop: 14 }}>
                <SectionHead title={t('账号与顺序')} />
                <p className='m-ck-note'>{t('关掉的账号不参与这个范围；上下箭头调顺序，顺序决定同一家内部的优先次序。')}</p>
                {providers.map(provider => {
                  const rows = orderOf(provider.id)
                  if (!rows.length) return null
                  return (
                    <Card key={provider.id} className='m-card' style={{ marginBottom: 10 }}>
                      <div style={{ padding: '10px 14px' }}>
                        <div className='m-t1' style={{ fontSize: 12.5 }}>{provider.label || providerLabel(provider.id, provider.id)}</div>
                      </div>
                      {rows.map((account, index) => {
                        const excluded = (draft.excludedAccounts || []).includes(account.id)
                        return (
                          <div key={account.id} style={{ padding: '9px 14px', borderTop: '1px solid var(--m-line)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className='m-mono' style={{ width: 20, flex: 'none', fontSize: 11, color: 'var(--m-text-3)' }}>{index + 1}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className='m-t1' style={{ fontSize: 12.5, opacity: excluded ? 0.5 : 1 }}>
                                  {account.name || account.nickname || account.id}
                                </div>
                                {account.hasCredentials === false ? (
                                  <div className='m-t2'>{t('未配置凭证（会被静默跳过）')}</div>
                                ) : account.enabled === false ? (
                                  <div className='m-t2'>{t('账号已禁用')}</div>
                                ) : null}
                              </div>
                              <Button size='sm' variant='ghost' type='button' aria-label={t('上移')}
                                disabled={index === 0} onClick={() => moveAccount(provider.id, account.id, -1)}>
                                <Icon name='up' />
                              </Button>
                              <Button size='sm' variant='ghost' type='button' aria-label={t('下移')}
                                disabled={index === rows.length - 1} onClick={() => moveAccount(provider.id, account.id, 1)}>
                                <Icon name='down' />
                              </Button>
                              <Switch
                                checked={!excluded}
                                aria-label={t('让这个账号参与')}
                                onCheckedChange={() => toggleAccount(account.id)}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </Card>
                  )
                })}
              </div>
            </>
          ) : null}
        </SheetBody>
        <SheetFooter>
          {scope && independent && !dirty ? (
            <Button variant='outline' disabled={Boolean(busy)} onClick={() => void removeIndependent()}>
              {busy === 'remove' ? t('删除中…') : t('删除独立配置')}
            </Button>
          ) : null}
          <Button variant='outline' disabled={Boolean(busy)} onClick={onClose}>{t('关闭')}</Button>
          <Button disabled={Boolean(busy) || !dirty} onClick={() => void save()}>
            {busy === 'save' ? t('保存中…') : dirty ? t('保存 {n} 处改动', { n: Object.keys(changed).length }) : t('没有改动')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
