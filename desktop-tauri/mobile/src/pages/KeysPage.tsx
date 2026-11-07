import { useMemo, useState } from 'react'
import { PageIntro, IconButton, Empty, ErrorNote, SkeletonList, copyWithToast } from '../components/ui'
import { GlyphLogo } from '../components/ProviderLogo'
import { Icon } from '../components/Icon'
import { PullIndicator, usePullToRefresh } from '../components/PullToRefresh'
import { store } from '../state/store'
import {
  createKey,
  deleteKey,
  fetchKeys,
  setKeyEnabled,
  updateKey,
  type GatewayKey,
  type KeysPayload,
} from '../api/gateway'
import { providerLabel } from '../lib/providers'
import { usePolling } from '../lib/usePolling'
import { t } from '../i18n'
import { Card, Button, Input, Label, MultiSelect } from '@ui'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetBody, SheetFooter } from '@ui'
import { Switch as UiSwitch } from '@ui'
import { confirmDialog } from '@ui'

/**
 * 网关 Key。
 *
 * Key 卡直接展示脱敏后的值与复制按钮 —— 这是这一页最高频的动作（复制给
 * 某个客户端）。明文只在展开后才取，默认只显示掩码，避免肩窥。
 *
 * 手机端已支持新建 Key 与编辑可用范围（提供商 / 模型白名单）。
 */
export function KeysPage() {
  const [data, setData] = useState<KeysPayload | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<GatewayKey | 'new' | null>(null)

  const load = async () => {
    try {
      const next = await fetchKeys()
      setData(next)
      setError('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    }
  }

  usePolling(load, 120_000)

  const pull = usePullToRefresh({ onRefresh: load })

  const keys = data?.keys || []

  const toggle = async (key: GatewayKey, next: boolean) => {
    if (!key.id) return
    setBusy(key.id)
    try {
      const payload = await setKeyEnabled(key.id, next)
      setData(payload)
      store.toast(next ? t('已启用「{name}」', { name: key.name || key.id }) : t('已禁用「{name}」', { name: key.name || key.id }))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const remove = async (key: GatewayKey) => {
    if (!key.id) return
    if (!await confirmDialog(t('确定删除「{name}」？用这把 Key 的客户端会立即失效。', { name: key.name || key.id }))) return
    setBusy(key.id)
    try {
      const payload = await deleteKey(key.id)
      setData(payload)
      store.toast(t('已删除'))
    } catch (failure) {
      store.toast(failure instanceof Error ? failure.message : String(failure), 'err')
    } finally {
      setBusy('')
    }
  }

  const toggleReveal = (id: string) => {
    const next = new Set(revealed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setRevealed(next)
  }

  return (
    <div className='m-page' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <PageIntro
        actions={
          <>
            <Button size='sm' variant='outline' disabled={!data} onClick={() => setEditing('new')}>
              <Icon name='plus' style={{ width: 14, height: 14 }} /> {t('新建 Key')}
            </Button>
            <IconButton name='refresh' label={t('刷新')} onClick={() => void load()} />
          </>
        }
      />

      <div className='m-section' style={{ marginTop: 0 }}>
        <Card
          className='m-card m-card-pad'
          style={{ background: 'var(--m-primary-soft)', borderColor: 'var(--m-primary-line)' }}
        >
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--m-text-2)' }}>
            {t('客户端请求带上 ')}
            <span className='m-mono' style={{ fontSize: 11.5, color: 'var(--m-primary)' }}>
              Authorization: Bearer &lt;Key&gt;
            </span>
            {t('；当前必须带 Key。')}
          </div>
        </Card>
      </div>

      {error ? <ErrorNote text={error} /> : null}
      {!data ? <SkeletonList rows={3} height={120} /> : null}

      {data && !keys.length ? (
        <div className='m-section'>
          <Card className='m-card'>
            <Empty text={t('还没有 Key，点右上角「新建 Key」创建一把。')} />
          </Card>
        </div>
      ) : null}

      {keys.map(key => {
        const id = String(key.id || '')
        const shown = revealed.has(id)
        const value = shown ? key.key || '' : key.masked || maskKey(key.key)
        return (
          <div key={id} className='m-section' style={{ marginTop: 10 }}>
            <Card className='m-card m-card-pad'>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <GlyphLogo name='key' />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {key.name || t('未命名')}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 2 }}>
                    {scopeText(key)}
                  </div>
                </div>
                <SwitchSmall
                  checked={Boolean(key.enabled)}
                  disabled={busy === id}
                  label={key.name || id}
                  onChange={next => void toggle(key, next)}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 10,
                  padding: '8px 10px',
                  borderRadius: 9,
                  background: 'var(--m-surface-2)',
                  border: '1px solid var(--m-line)',
                }}
              >
                <span
                  className='m-mono'
                  style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--m-text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {value}
                </span>
                <Button size='default' variant='ghost'
                  type='button'
                  onClick={() => toggleReveal(id)}
                  aria-label={shown ? t('隐藏') : t('显示')}
                  style={{ display: 'flex', border: 0, background: 'none', color: 'var(--m-text-3)', padding: 2 }}
                >
                  <Icon name='eye' style={{ width: 15, height: 15, opacity: shown ? 1 : 0.55 }} />
                </Button>
                <Button size='default' variant='ghost'
                  type='button'
                  onClick={() => void copyWithToast(key.key || '', key.name || t('网关 Key'))}
                  aria-label={t('复制')}
                  style={{ display: 'flex', border: 0, background: 'none', color: 'var(--m-primary)', padding: 2 }}
                >
                  <Icon name='copy' style={{ width: 15, height: 15 }} />
                </Button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 9, fontSize: 11.5, color: 'var(--m-text-3)' }}>
                <span>{key.enabled ? t('已启用') : t('已停用')}</span>
                <span>{t('创建于 {time}', { time: key.createdAt ? new Date(key.createdAt).toLocaleDateString('zh-CN') : '—' })}</span>
                <Button size='default' variant='ghost'
                  type='button'
                  onClick={() => setEditing(key)}
                  disabled={busy === id}
                  style={{
                    marginLeft: 'auto',
                    border: 0,
                    background: 'none',
                    color: 'var(--m-primary)',
                    fontSize: 11.5,
                    padding: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Icon name='settings' style={{ width: 13, height: 13 }} />
                  {t('可用范围')}
                </Button>
                <Button size='default' variant='ghost'
                  type='button'
                  onClick={() => void remove(key)}
                  disabled={busy === id}
                  style={{
                    border: 0,
                    background: 'none',
                    color: 'var(--m-danger)',
                    fontSize: 11.5,
                    padding: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Icon name='trash' style={{ width: 13, height: 13 }} />
                  {t('删除')}
                </Button>
              </div>
            </Card>
          </div>
        )
      })}

      {editing ? (
        <KeyEditorSheet
          data={data}
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={payload => {
            setData(payload)
            setEditing(null)
            void load()
          }}
        />
      ) : null}
    </div>
  )
}

function KeyEditorSheet({
  data,
  target,
  onClose,
  onSaved,
}: {
  data: KeysPayload | null
  target: GatewayKey | 'new'
  onClose: () => void
  onSaved: (payload: KeysPayload) => void
}) {
  const isNew = target === 'new'
  const existing = !isNew ? target as GatewayKey : undefined
  const existingId = existing?.id
  const [name, setName] = useState(existing?.name || '')
  const [keyValue, setKeyValue] = useState('')
  const [providers, setProviders] = useState<string[]>(existing?.allowedProviders || [])
  const [models, setModels] = useState<string[]>(existing?.allowedModels || [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const providerOptions = useMemo(
    () => (data?.providers || []).filter(p => p.id).map(p => ({ value: p.id as string, label: p.label || providerLabel(p.id as string) })),
    [data]
  )

  const modelOptions = useMemo(() => {
    const map = data?.modelsByProvider || {}
    const out: Array<{ value: string; label: string }> = []
    for (const [provider, models] of Object.entries(map)) {
      for (const model of models || []) out.push({ value: model, label: `${providerLabel(provider)} · ${model}` })
    }
    return out
  }, [data])

  const save = async () => {
    if (saving) return
    if (!isNew && !existingId) return
    setSaving(true)
    setError('')
    try {
      if (isNew) {
        const trimmed = keyValue.trim()
        if (trimmed && trimmed.length < 8) {
          setError(t('Key 至少需要 8 个字符'))
          setSaving(false)
          return
        }
        const payload = await createKey({
          name: name.trim() || undefined,
          key: trimmed || undefined,
          allowedProviders: providers,
          allowedModels: models,
        })
        onSaved(payload)
        store.toast(t('Key 已创建，记得复制给客户端'))
      } else if (existingId) {
        const payload = await updateKey(existingId, {
          name: name.trim() || undefined,
          allowedProviders: providers,
          allowedModels: models,
        })
        onSaved(payload)
        store.toast(t('可用范围已保存'))
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open, details) => {
      if (open) return
      if (saving) { details.cancel(); return }
      onClose()
    }}>
      <SheetContent showCloseButton={!saving}>
        <SheetHeader>
          <SheetTitle>{isNew ? t('新建 API Key') : t('可用范围 · {name}', { name: existing?.name || t('未命名') })}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <div>
              <Label htmlFor='key-name'>{t('名称')}</Label>
              <Input id='key-name' type='text' maxLength={60} placeholder={t('例如 Cursor / 公司电脑')} autoComplete='off' value={name} onChange={event => setName(event.currentTarget.value)} />
            </div>
            {isNew ? (
              <div>
                <Label htmlFor='key-value'>{t('Key 值（留空自动生成）')}</Label>
                <Input id='key-value' type='text' autoComplete='off' placeholder='sk-…' value={keyValue} onChange={event => setKeyValue(event.currentTarget.value)} />
              </div>
            ) : null}
            <div>
              <Label>{t('可用提供商（留空 = 不限制）')}</Label>
              <MultiSelect
                value={providers}
                onValueChange={setProviders}
                options={providerOptions}
                placeholder={t('留空 = 不限制')}
                searchPlaceholder={t('搜索提供商…')}
                aria-label={t('可用提供商')}
              />
            </div>
            <div>
              <Label>{t('可用模型（留空 = 不限制）')}</Label>
              <MultiSelect
                value={models}
                onValueChange={setModels}
                options={modelOptions}
                placeholder={t('留空 = 不限制')}
                searchPlaceholder={t('搜索模型…')}
                aria-label={t('可用模型')}
              />
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6 }}>
              {t('限制后，这把 Key 只能请求范围内的提供商与模型；留空表示全部可用。')}
            </p>
            {error ? <p style={{ fontSize: 12, color: 'var(--m-danger)' }}>{error}</p> : null}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={saving} onClick={onClose}>{t('取消')}</Button>
          <Button disabled={saving} onClick={() => void save()}>{saving ? t('保存中…') : t('保存')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function scopeText(key: GatewayKey): string {
  const providers = key.allowedProviders || []
  const models = key.allowedModels || []
  if (!providers.length && !models.length) return t('不限制提供商与模型')
  const parts: string[] = []
  if (providers.length) parts.push(providers.map(id => providerLabel(id)).join('、'))
  if (models.length) parts.push(t('{n} 个模型', { n: models.length }))
  return t('限制：{text}', { text: parts.join(' / ') })
}

function maskKey(key?: string): string {
  if (!key) return '—'
  if (key.length <= 10) return '••••••'
  return `${key.slice(0, 7)}••••••${key.slice(-4)}`
}

function SwitchSmall({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <UiSwitch size='touch' variant='success' checked={checked} aria-label={label} disabled={disabled} onCheckedChange={onChange} />
  )
}
