import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Textarea } from '@ui'
import { apiCall } from '../api/client'
import { cancelDynamicLogin, submitDynamicCallback, waitDynamicLogin } from '../api/add-account-dynamic'
import { startWebLogin } from '../api/web-login'
import { Icon } from '../components/Icon'
import { copyWithToast } from '../components/ui'
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
  /** 正在等待的网页登录（`state` + 官方登录地址）；用 ref 记 key 以便取消后停止轮询 */
  const [web, setWeb] = useState<{ state: string; url: string } | null>(null)
  const [webBusy, setWebBusy] = useState(false)
  const [webNote, setWebNote] = useState('')
  const [callback, setCallback] = useState('')
  const webStateRef = useRef('')
  /** 组件卸载后不再 setState（轮询是 3 秒一跳的长循环，关窗时必须停手） */
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

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

  /**
   * 网页登录（官方页面登录）。
   *
   * 手机端这条路成立的原因见 `api/web-login.ts`：网关侧是普通 HTTP 流程，回调地址指向
   * `127.0.0.1` —— 打开官方页的是手机自己的浏览器，回到的也是手机自己的本机网关。
   * 手机端的不便只有一处：**WebView 忽略 `window.open`**（与 Tabbit 短信登录同一个坑），
   * 所以除了尽力打开，**一定把地址显示出来并给「复制链接」**。
   */
  async function openWebLogin() {
    if (!config || webBusy) return
    setWebBusy(true)
    setNote('')
    try {
      const started = await startWebLogin({ provider: config.provider })
      const state = String(started.state || '')
      const url = String(started.authUrl || started.url || '')
      if (!state || !url) throw new Error(t('网关没有返回登录地址，请重试'))
      webStateRef.current = state
      setWeb({ state, url })
      window.open(url, '_blank', 'noopener')
      void pollWebLogin(state)
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure)
      setNote(message)
      store.toast(message, 'err')
    } finally {
      setWebBusy(false)
    }
  }

  /** 轮询登录结果：`done` 即完成；`pending` 继续；`error` 停手并显示 */
  async function pollWebLogin(state: string) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, 3000))
      if (!mountedRef.current) return                  // 关窗后停手，别对已卸载组件 setState
      if (webStateRef.current !== state) return        // 已被取消 / 换了一次登录
      let reply: { pending?: boolean; done?: boolean; error?: string; session?: { accountId?: string } | null }
      try {
        reply = await waitDynamicLogin(state)
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : String(failure)
        setWebNote(message)
        return
      }
      if (reply?.error) { setWebNote(String(reply.error)); return }
      if (reply?.done || reply?.session?.accountId) {
        setWeb(null)
        webStateRef.current = ''
        store.toast(t('已添加账号'))
        onAdded?.()
        onClose()
        return
      }
    }
    setWebNote(t('等待超时：可以点「我已完成」再查一次，或重新发起。'))
  }

  /** 「我已完成」：立即查一次结果（不等下一次轮询） */
  async function checkWebLogin() {
    if (!web) return
    try {
      const reply = await waitDynamicLogin(web.state)
      if (reply?.done || reply?.session?.accountId) {
        setWeb(null)
        webStateRef.current = ''
        store.toast(t('已添加账号'))
        onAdded?.()
        onClose()
        return
      }
      setWebNote(reply?.pending ? t('还没看到登录结果，请确认在打开的页面里完成了登录。') : t('还没有结果，稍后再试或重新发起。'))
    } catch (failure) {
      setWebNote(failure instanceof Error ? failure.message : String(failure))
    }
  }

  async function cancelWebLogin() {
    if (!web) return
    const state = web.state
    webStateRef.current = ''
    setWeb(null)
    setWebNote('')
    await cancelDynamicLogin(state).catch(() => {})
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

          {/* ── 网页登录 / OAuth：两者在网关侧是同一套端点（oauth/start + wait + callback），
                 所以共用下面这段流程，只是标题与按钮文案按各家的配置取。── */}
          {plan?.web || plan?.oauth ? (() => {
            const label = plan.web
              ? (config.webLogin?.button || t('打开网页登录'))
              : (config.oauthLogin?.title || t('打开授权页面'))
            const lead = plan.web
              ? (config.webLogin?.noteHtml ? config.webLogin.noteHtml.replace(/<[^>]+>/g, '') : t('在打开的官方登录页里完成登录，成功后会自动加入账号列表。'))
              : (config.oauthLogin?.noteHtml ? config.oauthLogin.noteHtml.replace(/<[^>]+>/g, '') : t('在打开的授权页里完成授权，成功后会自动加入账号列表。'))
            return (
              <>
                <div className='m-sec'>{label}</div>
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginBottom: 8 }}>{lead}</p>
                {!web ? (
                  <Button variant='outline' style={{ width: '100%' }} disabled={webBusy}
                    onClick={() => void openWebLogin()}>
                    <Icon name='link' style={{ marginRight: 6 }} />
                    {webBusy ? t('正在准备…') : label}
                  </Button>
                ) : (
                  <>
                    <p style={{ fontSize: 12, color: 'var(--m-text-2)', lineHeight: 1.6 }}>
                      {t('已发起登录。如果这个页面没有自动打开，请复制下面的地址，用 Safari 打开并完成登录：')}
                    </p>
                    <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', wordBreak: 'break-all', margin: '6px 0' }}>{web.url}</p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Button variant='outline' size='sm' onClick={() => void copyWithToast(web.url, t('登录地址'))}>{t('复制链接')}</Button>
                      <Button variant='outline' size='sm' onClick={() => window.open(web.url, '_blank', 'noopener')}>{t('再打开一次')}</Button>
                      <Button variant='outline' size='sm' onClick={() => void checkWebLogin()}>{t('我已完成')}</Button>
                      <Button variant='ghost' size='sm' onClick={() => void cancelWebLogin()}>{t('取消')}</Button>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <Label htmlFor='web-callback'>{t('粘贴回调地址（兜底）')}</Label>
                      <Input id='web-callback' value={callback} disabled={webBusy}
                        placeholder={t('把官方页最终跳转到的地址整条粘进来')}
                        onChange={event => setCallback(event.currentTarget.value)} />
                      <Button variant='outline' size='sm' style={{ marginTop: 8 }} disabled={!callback.trim()}
                        onClick={() => {
                          void (async () => {
                            try {
                              await submitDynamicCallback(web.state, callback.trim())
                              setCallback('')
                              await checkWebLogin()
                            } catch (failure) {
                              setWebNote(failure instanceof Error ? failure.message : String(failure))
                            }
                          })()
                        }}>{t('提交回调地址')}</Button>
                    </div>
                  </>
                )}
                {webNote ? <p style={{ fontSize: 11.5, color: 'var(--m-warn)', lineHeight: 1.6, marginTop: 8 }}>{webNote}</p> : null}
              </>
            )
          })() : null}

          {/* ── 短信登录：手机端已有独立入口（账号页「手机验证码登录」），这里只做指引 ── */}
          {plan?.sms ? (
            <>
              <div className='m-sec'>{t('手机验证码登录')}</div>
              <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7 }}>
                {t('这家支持手机验证码登录。回到账号页用顶部的「手机验证码登录」（当前支持 AutoClaw 国内版 / Loomy / Tabbit 国内版）。')}
              </p>
            </>
          ) : null}

          {/* ── 访客模式（只有智谱清言有）：手机端暂未接入，如实说明 ── */}
          {plan?.guest ? (
            <>
              <div className='m-sec'>{t('访客凭证')}</div>
              <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7 }}>
                {t('这家可以一键换发访客身份（没有积分体系，余额与签到会如实跳过）。手机端暂未接入这一步：可以改用手填凭证 / 导入凭证文件，或用网页登录（若这家提供）。')}
              </p>
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
