import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Textarea } from '@ui'
import { apiCall } from '../api/client'
import { Icon } from '../components/Icon'
import { store } from '../state/store'
import { t } from '../i18n'
import {
  addButtonTextOf, buildStaticPayload, configOf, fieldIdOf, manualNoteOf, manualTitleOf,
  maxLengthOf, missingRequired, planSections, type FieldValues,
} from '../lib/add-account-static'

/**
 * 「添加账号」→ 静态表单（手填凭证 / 导入凭证文件）。
 *
 * 对齐桌面端：字段与文案全部来自共享的 `add-account-configs.ts`（**不另抄一份**），
 * 提交体与桌面同一套语义（见 `lib/add-account-static.ts` 的注释）。
 *
 * 手机端做不到的两段（网页登录 / 读本机客户端登录态）**不渲染但会写明原因** ——
 * 静默少一项会让人以为"这家不支持"，写清原因才知道该改用哪条路。
 */
export function AddAccountStaticSheet({ provider, onClose, onAdded }: {
  provider: string
  onClose: () => void
  onAdded?: () => void
}) {
  const config = useMemo(() => configOf(provider), [provider])
  const [values, setValues] = useState<FieldValues>({})
  const [name, setName] = useState('')
  const [region, setRegion] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setValues({})
    setName('')
    setRegion(config?.regionOptions?.[0]?.value || '')
    setNote('')
  }, [provider, config])

  const plan = useMemo(() => (config ? planSections(config, region) : null), [config, region])
  const missing = config ? missingRequired(config, values) : []
  const manualNote = config ? manualNoteOf(config) : { text: '' }

  async function submit(payload: Record<string, unknown>) {
    if (busy) return
    setBusy(true)
    setNote('')
    try {
      const result = await apiCall<{ account?: { id?: string }; warning?: string }>('/api/accounts', {
        method: 'POST',
        body: payload,
      })
      if (!result?.account?.id) throw new Error(t('网关没有返回已完成的账号，请重试'))
      store.toast(result.warning ? String(result.warning) : t('已添加账号'))
      onAdded?.()
      onClose()
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      setNote(message)
      store.toast(message, 'err')
    } finally {
      setBusy(false)
    }
  }

  /** 从文件导入：文本 → `authFileContent`；二进制 → `authFileB64`（与桌面同一键名） */
  async function importFile(file: File) {
    if (!config?.fileImport || busy) return
    setBusy(true)
    setNote('')
    try {
      const binary = config.fileImport.binary === true
      const payload: Record<string, unknown> = { provider: config.provider }
      if (binary) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => reject(new Error(t('文件读取失败')))
          reader.readAsDataURL(file)
        })
        const comma = dataUrl.indexOf(',')
        if (comma < 0) throw new Error(t('文件读取失败'))
        payload.authFileB64 = dataUrl.slice(comma + 1)
      } else {
        payload.authFileContent = (await file.text()).replace(/^\uFEFF/, '')
      }
      const trimmedName = name.trim()
      if (trimmedName) payload.name = trimmedName
      await submit(payload)
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      setNote(message)
      store.toast(message, 'err')
    } finally {
      setBusy(false)
    }
  }

  if (!config) {
    return (
      <Sheet open onOpenChange={open => { if (!open) onClose() }}>
        <SheetContent showCloseButton>
          <SheetHeader><SheetTitle>{t('添加账号')}</SheetTitle></SheetHeader>
          <SheetBody>
            <p style={{ fontSize: 12.5, color: 'var(--m-text-2)' }}>
              {t('这家在静态表单里没有登记，也没有声明动态登录方式。可以试试「导入凭证」，或在网关桌面面板里添加。')}
            </p>
          </SheetBody>
          <SheetFooter><Button variant='outline' onClick={onClose}>{t('关闭')}</Button></SheetFooter>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Sheet open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader><SheetTitle>{t('登录 / 添加 {name} 账号', { name: config.label })}</SheetTitle></SheetHeader>
        <SheetBody>
          {note ? <p style={{ fontSize: 12, color: 'var(--m-danger)', lineHeight: 1.6, marginBottom: 10 }}>{note}</p> : null}

          {config.regionOptions?.length ? (
            <div style={{ marginBottom: 12 }}>
              <Label htmlFor='add-region'>{t('地区')}</Label>
              <Select value={region} onValueChange={value => setRegion(String(value || ''))}>
                <SelectTrigger id='add-region' aria-label={t('地区')}>
                  <SelectValue>{config.regionOptions.find(item => item.value === region)?.label || region}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {config.regionOptions.map(item => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {/* ── 手填凭证（与桌面同一批字段、同一批键名）── */}
          {plan?.manual ? (
            <>
              <div className='m-sec'>{manualTitleOf(config)}</div>
              {manualNote.text ? (
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginBottom: 8 }}>{manualNote.text}</p>
              ) : null}
              <Label htmlFor='add-name'>{t('备注名（可选）')}</Label>
              <Input id='add-name' value={name} maxLength={64} disabled={busy}
                placeholder={t('可选，留空则用凭证里的账号名')}
                onChange={event => setName(event.currentTarget.value)} />
              {config.fields.map(field => (
                <div key={field.key} style={{ marginTop: 10 }}>
                  <Label htmlFor={fieldIdOf(config, field)}>
                    {field.label}{field.optional ? ` · ${t('可选')}` : ''}
                  </Label>
                  {field.rows && field.rows > 1 ? (
                    <Textarea id={fieldIdOf(config, field)} rows={field.rows} disabled={busy}
                      maxLength={maxLengthOf(field)} placeholder={field.placeholder}
                      value={values[field.key] ?? ''}
                      onChange={event => setValues(current => ({ ...current, [field.key]: event.currentTarget.value }))} />
                  ) : (
                    <Input id={fieldIdOf(config, field)} disabled={busy}
                      maxLength={maxLengthOf(field)} placeholder={field.placeholder}
                      value={values[field.key] ?? ''}
                      onChange={event => setValues(current => ({ ...current, [field.key]: event.currentTarget.value }))} />
                  )}
                </div>
              ))}
              <Button style={{ marginTop: 14, width: '100%' }} disabled={busy || missing.length > 0}
                onClick={() => { void submit(buildStaticPayload(config, values, { name, region })) }}>
                {busy ? t('添加中…') : missing.length ? t('还缺：{fields}', { fields: missing.map(item => item.label).join('、') }) : addButtonTextOf(config)}
              </Button>
            </>
          ) : null}

          {/* ── 从文件导入（文本 → authFileContent / 二进制 → authFileB64）── */}
          {plan?.file ? (
            <>
              <div className='m-sec'>{t('导入凭证文件')}</div>
              {config.fileImport?.note ? (
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginBottom: 8 }}>{config.fileImport.note}</p>
              ) : null}
              <input ref={fileRef} type='file' hidden accept={config.fileImport?.accept || '.json,application/json'}
                onChange={event => {
                  const file = event.currentTarget.files?.[0]
                  if (file) void importFile(file)
                  event.currentTarget.value = ''
                }} />
              <Button variant='outline' style={{ width: '100%' }} disabled={busy}
                onClick={() => fileRef.current?.click()}>
                <Icon name='install' style={{ marginRight: 6 }} />
                {busy ? t('读取中…') : t('选择文件')}
              </Button>
            </>
          ) : null}

          {/* ── 手机端做不到的分段：写明原因，别让人以为这家不支持 ── */}
          {plan?.blocked.length ? (
            <>
              <div className='m-sec'>{t('这些方式在手机上不可用')}</div>
              {plan.blocked.map(item => (
                <div key={item.id} style={{ padding: '8px 0' }}>
                  <div className='m-t1'>{item.label}</div>
                  <div className='m-t2' style={{ lineHeight: 1.6 }}>{item.reason}</div>
                </div>
              ))}
            </>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>{t('取消')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
