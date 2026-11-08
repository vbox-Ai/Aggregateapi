import { useMemo, useState } from 'react'
import { Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@ui'
import { Empty, ErrorNote } from '../components/ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { providerLabel } from '../lib/providers'
import { t } from '../i18n'
import { addCustomModel, type ManageModel, type ManageView } from '../api/gateway'

/**
 * 登记一个自定义模型（`POST /api/models/custom { provider, id }`）。
 *
 * ── 两条校验是从面板侧抄的，不是自创的 ────────────────────────
 * 面板侧 `WI(provider, id)`：
 *   ① 清单里已有同 id → 「模型 ID「{id}」已存在，请使用已有模型」；
 *   ② 该提供商里这个 id 已有**启用中的绑定** → 「模型 ID「{id}」在该提供商已有启用绑定，
 *      请先关闭它再添加」。
 * 判重口径也照抄：面板侧比对时**忽略大小写**（`ss()` 把两边都小写化），
 * 手机端同样按小写比较 —— 否则会出现「手机说能加、网关说已存在」。
 *
 * ── 为什么只列内置家 ─────────────────────────────────────────
 * 自定义提供商的模型清单是**整表保存**的（走 `/api/custom-providers/models`），
 * 从这个入口加会和「自定义提供商」页打架。界面上写明这句。
 */
export function AddCustomModelSheet({
  models,
  providers,
  onClose,
  onSaved,
}: {
  models: ManageModel[]
  providers: Array<{ id: string; label?: string }>
  onClose: () => void
  onSaved: (view: ManageView) => void
}) {
  const identity = serverIdentity()
  const [provider, setProvider] = useState(providers[0]?.id || '')
  const [id, setId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const providerModels = useMemo(
    () => models.filter(model => (model.provider || '') === provider),
    [models, provider],
  )

  /** 与面板侧 `WI` 同一顺序、同一文案 */
  const validate = (): string => {
    const value = id.trim()
    if (!value) return t('请填写模型 ID')
    const lowered = value.toLowerCase()
    if (providerModels.some(model => String(model.id || '').toLowerCase() === lowered)) {
      return t('模型 ID「{id}」已存在，请使用已有模型', { id: value })
    }
    // 已有「启用中的别名指向自己」= 已有启用绑定
    const bound = providerModels.some(model => {
      if (String(model.id || '').toLowerCase() !== lowered) return false
      return model.enabled !== false
    })
    if (bound) {
      return t('模型 ID「{id}」在该提供商已有启用绑定，请先关闭它再添加', { id: value })
    }
    return ''
  }

  const submit = async () => {
    if (busy) return
    const invalid = validate()
    if (invalid) {
      setError(invalid)
      return
    }
    if (!provider) {
      setError(t('请选择提供商'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const view = await addCustomModel({ provider, id: id.trim() })
      if (serverIdentity() !== identity) return
      onSaved(view)
      store.toast(t('已登记模型「{id}」', { id: id.trim() }))
      onClose()
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>{t('登记自定义模型')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}
          {!providers.length ? <Empty text={t('还没有可选的提供商。')} /> : null}

          {providers.length ? (
            <>
              <div>
                <Label htmlFor='custom-model-provider'>{t('提供商')}</Label>
                <Select value={provider || '__none__'} onValueChange={value => setProvider(!value || value === '__none__' ? '' : value)}>
                  <SelectTrigger id='custom-model-provider' className='w-full' aria-label={t('提供商')}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {providers.map(item => (
                      <SelectItem key={item.id} value={item.id}>{item.label || providerLabel(item.id, item.id)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div style={{ marginTop: 12 }}>
                <Label htmlFor='custom-model-id'>{t('模型 ID')}</Label>
                <Input
                  id='custom-model-id'
                  className='m-mono'
                  value={id}
                  placeholder={t('例如：gpt-5.2-preview')}
                  onChange={event => setId(event.currentTarget.value)}
                />
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 4 }}>
                  {t('要填上游真实接受的模型 ID。判重忽略大小写；登记后它出现在清单里，可像内置模型一样启停。')}
                </p>
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 8 }}>
                {t('自定义提供商的模型清单请在「自定义提供商」页里改 —— 那边是整表保存，和这里不是一条路。')}
              </p>
            </>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>{t('取消')}</Button>
          <Button disabled={busy || !providers.length} onClick={() => void submit()}>
            {busy ? t('登记中…') : t('登记')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
