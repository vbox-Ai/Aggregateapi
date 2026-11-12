import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Label, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Textarea } from '@ui'
import { PageHead, Empty, ErrorNote, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import { usePullToRefresh, PullIndicator } from '../components/PullToRefresh'
import { usePolling } from '../lib/usePolling'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { t } from '../i18n'
import { formProtocol, takeProviderPreset, type ProviderPreset } from '../lib/preset-request'
import { useAccountProxy } from '../components/account-proxy-fields'
import { confirmDialog } from '@ui'
import {
  PROTOCOL_OPTIONS,
  createCustomProvider,
  fetchCustomProviderModels,
  fetchCustomProviders,
  removeCustomProvider,
  saveCustomProviderModels,
  updateCustomProvider,
  type CustomProvider,
} from '../api/custom-providers'

/**
 * 自定义提供商。
 *
 * 网关把「建提供商 + 建首个账号」做成一个事务（`api/custom_providers.rs`），
 * 手机端照这份契约走：填名称 / 协议 / 地址 / API Key，一次提交。
 *
 * 模型清单两步式：拉取（不落盘）→ 勾选 → 保存（整表替换）。两步之间没有
 * 服务端状态，弹窗关掉即丢弃，重开重新拉。
 */
export function CustomProvidersPage() {
  const identity = serverIdentity()
  const [providers, setProviders] = useState<CustomProvider[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [creating, setCreating] = useState(false)
  /** 从「API 模板」跳过来时带上的预置：表单初值，并在标题上说明用的是哪个模板 */
  const [presetSeed, setPresetSeed] = useState<ProviderPreset | null>(null)
  const [editing, setEditing] = useState<CustomProvider | null>(null)
  const [fetching, setFetching] = useState<CustomProvider | null>(null)

  // 从「API 模板」跳过来：直接打开新建表单并预填模板的名称/协议/Base URL。
  // 与桌面同一流程（点模板 ⇒ 弹出预填表单 ⇒ 填 Key ⇒ 创建并添加账号）。
  useEffect(() => {
    const preset = takeProviderPreset()
    if (!preset) return
    setPresetSeed(preset)
    setCreating(true)
  }, [])

  const load = useCallback(async () => {
    try {
      const data = await fetchCustomProviders()
      if (serverIdentity() === identity) setProviders(data.providers || [])
    } catch (cause) {
      if (serverIdentity() === identity) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }, [identity])

  useEffect(() => { void load() }, [load])
  usePolling(load, 30_000)

  const pull = usePullToRefresh({ onRefresh: load })

  const remove = async (provider: CustomProvider) => {
    if (busy) return
    if (!await confirmDialog(t('确定删除自定义提供商「{name}」？名下 {n} 个账号会被一并删除，且不可恢复。', {
      name: provider.name,
      n: provider.models.length,
    }))) return
    setBusy('remove')
    try {
      await removeCustomProvider(provider.id)
      if (serverIdentity() !== identity) return
      store.toast(t('已删除自定义提供商'))
      await load()
    } catch (cause) {
      if (serverIdentity() === identity) store.toast(cause instanceof Error ? cause.message : String(cause), 'err')
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  return (
    <div className='m-page' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <PageHead
        title={t('自定义提供商')}
        subtitle={t('{n} 个 · 新建会同时创建该家第一个账号', { n: providers.length })}
        actions={
          <Button variant='outline' size='sm' disabled={Boolean(busy)}
            onClick={() => { setPresetSeed(null); setCreating(true) }}>
            <Icon name='plus' style={{ width: 14, height: 14 }} />
            {t('新建')}
          </Button>
        }
      />

      <div className='m-section' style={{ marginTop: 0 }}>
        <SectionHead title={t('已配置')} />
        {error ? <ErrorNote text={error} /> : null}
        {providers.length === 0 && !error ? (
          <Card className='m-card'><Empty text={t('还没有自定义提供商，点右上角「新建」连一个上游')} /></Card>
        ) : null}
        {providers.map(provider => (
          <Card key={provider.id} className='m-card m-card-pad'>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center',
                background: 'var(--m-surface-2)', color: provider.enabled ? 'var(--m-ok)' : 'var(--m-text-3)',
              }}>
                <Icon name='model' />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {provider.name}
                </div>
                <div className='m-mono' style={{ fontSize: 11.5, color: 'var(--m-text-3)' }}>
                  {provider.protocol} · {provider.baseUrl}
                </div>
              </div>
              <span style={{
                fontSize: 10.5, padding: '2px 8px', borderRadius: 8,
                background: provider.enabled ? 'var(--m-ok-soft)' : 'var(--m-surface-2)',
                color: provider.enabled ? 'var(--m-ok)' : 'var(--m-text-3)',
              }}>
                {provider.enabled ? t('启用') : t('停用')}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Button size='sm' variant='outline' disabled={Boolean(busy)}
                onClick={() => setEditing(provider)}>{t('编辑')}</Button>
              <Button size='sm' variant='outline' disabled={Boolean(busy)}
                onClick={() => setFetching(provider)}>{t('拉取模型')}</Button>
              <Button size='sm' variant='ghost' disabled={Boolean(busy)}
                onClick={() => void remove(provider)}>{t('删除')}</Button>
            </div>
          </Card>
        ))}
      </div>

      {creating ? <CreateProviderSheet
        initial={presetSeed}
        onClose={() => { setCreating(false); setPresetSeed(null) }}
        onCreated={async () => { setCreating(false); setPresetSeed(null); await load() }}
      /> : null}
      {editing ? <EditProviderSheet
        provider={editing}
        onClose={() => setEditing(null)}
        onChanged={async () => { setEditing(null); await load() }}
      /> : null}
      {fetching ? <FetchModelsSheet
        provider={fetching}
        onClose={() => setFetching(null)}
        onSaved={async () => { setFetching(null); await load() }}
      /> : null}
    </div>
  )
}

/** 新建：名称 / 协议 / 地址 / API Key 一次提交，网关同时建好首个账号 */
function CreateProviderSheet({ initial, onClose, onCreated }: {
  /** 从「API 模板」带来的预置（可空 = 手建） */
  initial: ProviderPreset | null
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  // 协议要把预置的后端值映射成表单的三档（chat_completions → openai），否则下拉会是空选
  const [protocol, setProtocol] = useState<string>(initial ? formProtocol(initial.protocol) : 'openai')
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  /** 该上游无需鉴权：不发送鉴权头，也就不需要（也不该）填 API Key */
  const [noAuth, setNoAuth] = useState(false)
  const [userAgent, setUserAgent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const identity = serverIdentity()
  /** 出网线路是**网关那台机器**的（请求由网关发出），与手机自身代理无关 */
  const proxy = useAccountProxy({ locked: busy })

  const save = async () => {
    if (busy) return
    if (!name.trim()) { setError(t('请填写提供商名称')); return }
    if (!baseUrl.trim()) { setError(t('请填写 Base URL')); return }
    // 网关侧 `noAuth` 与 `apiKey` 互斥：无需鉴权的上游不该被逼着填一个假 Key
    if (!noAuth && !apiKey.trim()) { setError(t('请填写 API Key（会作为该家第一个账号的凭证）')); return }
    setBusy(true)
    setError('')
    try {
      const proxyBody = proxy.payload()
      await createCustomProvider({
        name: name.trim(), protocol, baseUrl: baseUrl.trim(),
        ...(noAuth ? { noAuth: true } : { apiKey: apiKey.trim() }),
        ...(userAgent.trim() ? { userAgent: userAgent.trim() } : {}),
        proxy: proxyBody,
      })
      if (serverIdentity() !== identity) return
      store.toast(t('已创建自定义提供商「{name}」并添加账号', { name: name.trim() }))
      await onCreated()
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open, details) => {
      if (open) return
      if (busy) { details.cancel(); return }
      onClose()
    }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader><SheetTitle>
          {initial ? t('使用 {name} 模板新建提供商', { name: initial.name }) : t('新建自定义提供商')}
        </SheetTitle></SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            {initial ? <p style={{ fontSize: 12, color: 'var(--m-subtle)' }}>
              {t('已按模板预填；填好 API Key 即可创建 —— 网关会同时建好该家的第一个账号。')}
            </p> : null}
            <div>
              <Label htmlFor='cp-name'>{t('名称')}</Label>
              <Input id='cp-name' value={name} onChange={event => setName(event.currentTarget.value)} placeholder={t('例如：某家 OpenAI 兼容上游')} />
            </div>
            <div>
              <Label htmlFor='cp-protocol'>{t('协议')}</Label>
              <Select value={protocol} onValueChange={value => setProtocol(String(value))}>
                <SelectTrigger className='w-full' aria-label={t('协议')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROTOCOL_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor='cp-baseurl'>{t('Base URL')}</Label>
              <Input id='cp-baseurl' value={baseUrl} onChange={event => setBaseUrl(event.currentTarget.value)} placeholder='https://api.example.com/v1' />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Label htmlFor='cp-noauth'>{t('该上游无需鉴权（不发送鉴权头）')}</Label>
              <Switch id='cp-noauth' checked={noAuth} disabled={busy} aria-label={t('该上游无需鉴权（不发送鉴权头）')}
                onCheckedChange={value => setNoAuth(value === true)} />
            </div>
            {noAuth ? <p style={{ fontSize: 12, color: 'var(--m-subtle)' }}>
              {t('选了「无需鉴权」就不会创建带 Key 的账号，也不需要填 API Key。')}
            </p> : <div>
              <Label htmlFor='cp-apikey'>{t('API Key')}</Label>
              <Input id='cp-apikey' type='password' value={apiKey} onChange={event => setApiKey(event.currentTarget.value)} placeholder={t('这把 Key 会成为该家第一个账号的凭证')} />
            </div>}
            <div>
              <Label htmlFor='cp-ua'>{t('User-Agent（可选）')}</Label>
              <Input id='cp-ua' value={userAgent} spellCheck={false} autoComplete='off' onChange={event => setUserAgent(event.currentTarget.value)} placeholder={t('留空用默认；只作用于这一家的账号')} />
            </div>
            {proxy.node}
            {error ? <p style={{ fontSize: 12, color: 'var(--m-danger)' }}>{error}</p> : null}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>{t('取消')}</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy ? t('创建中…') : t('创建')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** 编辑：名称 / 协议 / 地址 / 启停；字段缺省不动 */
function EditProviderSheet({ provider, onClose, onChanged }: { provider: CustomProvider; onClose: () => void; onChanged: () => Promise<void> }) {
  const [name, setName] = useState(provider.name)
  const [protocol, setProtocol] = useState(provider.protocol)
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl)
  const [enabled, setEnabled] = useState(provider.enabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const identity = serverIdentity()

  const save = async () => {
    if (busy) return
    if (!name.trim()) { setError(t('请填写提供商名称')); return }
    setBusy(true)
    setError('')
    try {
      await updateCustomProvider(provider.id, { name: name.trim(), protocol, baseUrl: baseUrl.trim(), enabled })
      if (serverIdentity() !== identity) return
      store.toast(t('提供商已更新'))
      await onChanged()
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open, details) => {
      if (open) return
      if (busy) { details.cancel(); return }
      onClose()
    }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader><SheetTitle>{t('编辑提供商')}</SheetTitle></SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <div>
              <Label htmlFor='cp-edit-name'>{t('名称')}</Label>
              <Input id='cp-edit-name' value={name} onChange={event => setName(event.currentTarget.value)} />
            </div>
            <div>
              <Label htmlFor='cp-edit-protocol'>{t('协议')}</Label>
              <Select value={protocol} onValueChange={value => setProtocol(String(value))}>
                <SelectTrigger className='w-full' aria-label={t('协议')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROTOCOL_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor='cp-edit-baseurl'>{t('Base URL')}</Label>
              <Input id='cp-edit-baseurl' value={baseUrl} onChange={event => setBaseUrl(event.currentTarget.value)} />
            </div>
            <div>
              <Label htmlFor='cp-edit-enabled'>{t('启用')}</Label>
              <Button size='sm' variant='outline' type='button' onClick={() => setEnabled(!enabled)}>
                {enabled ? t('当前：启用，点击停用') : t('当前：停用，点击启用')}
              </Button>
            </div>
            {error ? <p style={{ fontSize: 12, color: 'var(--m-danger)' }}>{error}</p> : null}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>{t('取消')}</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy ? t('保存中…') : t('保存')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** 拉取模型 → 勾选 → 整表保存 */
function FetchModelsSheet({ provider, onClose, onSaved }: { provider: CustomProvider; onClose: () => void; onSaved: () => Promise<void> }) {
  const [models, setModels] = useState<Array<{ id: string; enabled: boolean }>>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const identity = serverIdentity()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchCustomProviderModels(provider.id)
      .then(data => {
        if (cancelled || serverIdentity() !== identity) return
        const list = (data.models || []).map(id => ({ id, enabled: true }))
        setModels(list)
        setLoading(false)
      })
      .catch(cause => {
        if (cancelled || serverIdentity() !== identity) return
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [provider.id, identity])

  const save = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await saveCustomProviderModels(
        provider.id,
        models.map(m => ({ id: m.id, enabled: m.enabled, reasoning: '' })),
        provider.mappings || [],
      )
      if (serverIdentity() !== identity) return
      store.toast(t('已保存 {n} 个模型', { n: models.filter(m => m.enabled).length }))
      await onSaved()
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open, details) => {
      if (open) return
      if (busy) { details.cancel(); return }
      onClose()
    }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader><SheetTitle>{t('拉取模型清单')}</SheetTitle></SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 8 }}>
            <p className='m-ck-note'>{t('服务端代理拉取上游清单，不落盘；勾掉的不会被保存。')}</p>
            {loading ? <p style={{ fontSize: 12.5, color: 'var(--m-text-3)' }}>{t('正在拉取…')}</p> : null}
            {error ? <p style={{ fontSize: 12, color: 'var(--m-danger)' }}>{error}</p> : null}
            {!loading && !error && models.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--m-text-3)' }}>{t('上游没有返回模型清单。')}</p>
            ) : null}
            {models.map(model => (
              <div key={model.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Button size='sm' variant='outline' type='button'
                  className='m-btn m-ghost m-sm'
                  onClick={() => setModels(prev => prev.map(m => m.id === model.id ? { ...m, enabled: !m.enabled } : m))}>
                  {model.enabled ? t('启用') : t('停用')}
                </Button>
                <span className='m-mono' style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {model.id}
                </span>
              </div>
            ))}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>{t('取消')}</Button>
          <Button disabled={busy || loading || models.length === 0} onClick={() => void save()}>
            {busy ? t('保存中…') : t('保存 {n} 个模型', { n: models.filter(m => m.enabled).length })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
