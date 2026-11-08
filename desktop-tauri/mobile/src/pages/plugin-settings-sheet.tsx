import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Label, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, confirmDialog } from '@ui'
import { Empty, ErrorNote } from '../components/ui'
import { Icon } from '../components/Icon'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { t } from '../i18n'
import { getPlugins } from '../api/plugins'
import {
  CAPTCHA_POOL_FIELDS,
  CLINE_FIXED_HEADERS,
  CLINE_LIMITS,
  fetchCaptchaPool,
  fetchClineHeaders,
  fetchZcodeVersion,
  putCaptchaPool,
  putClineHeaders,
  putZcodeVersion,
  validateClineHeaders,
  validateZcodeVersion,
  type CaptchaPoolSettings,
  type ClineHeadersState,
  type ZcodeVersionState,
} from '../api/plugin-settings'

/**
 * 插件出站设置：ZCode 版本号 / 验证码令牌池 / Cline 伪装头。
 *
 * 后两项在桌面端是**由插件申报才会出现**的管理面板（`GET /api/plugins` 的
 * `adminPanels` 含 `captcha_pool` / `upstream_headers`）。手机端沿用同一口径：
 * 插件没装就不渲染这些块 —— 否则用户会对着一个「改了没反应」的开关发呆。
 *
 * ZCode 版本号不属申报面板，任何形态都能改：它只影响出站 URL 里的 `?app_version=`。
 */
export function PluginSettingsSheet({ onClose }: { onClose: () => void }) {
  const identity = serverIdentity()
  const [panels, setPanels] = useState<string[]>([])
  const [zcode, setZcode] = useState<ZcodeVersionState | null>(null)
  const [zcodeText, setZcodeText] = useState('')
  const [pool, setPool] = useState<CaptchaPoolSettings | null>(null)
  const [poolText, setPoolText] = useState<Record<string, string>>({})
  const [cline, setCline] = useState<ClineHeadersState | null>(null)
  const [headers, setHeaders] = useState<Array<{ name: string; value: string }>>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      // 插件申报先读：决定后面两项要不要拉、要不要显示
      const plugins = await getPlugins().catch(() => null)
      if (serverIdentity() !== identity) return
      const declared = Array.isArray(plugins?.adminPanels) ? plugins!.adminPanels! : []
      setPanels(declared)

      const [nextZcode, nextPool, nextCline] = await Promise.all([
        fetchZcodeVersion(),
        declared.includes('captcha_pool') ? fetchCaptchaPool() : Promise.resolve(null),
        declared.includes('upstream_headers') ? fetchClineHeaders() : Promise.resolve(null),
      ])
      if (serverIdentity() !== identity) return
      setZcode(nextZcode)
      setZcodeText(nextZcode.version || '')
      if (nextPool) {
        setPool(nextPool)
        setPoolText(
          Object.fromEntries(
            CAPTCHA_POOL_FIELDS.map(field => [field.key, String(nextPool[field.key] ?? field.fallback)]),
          ),
        )
      }
      if (nextCline) {
        setCline(nextCline)
        setHeaders(
          Object.entries(nextCline.overrides || {}).map(([name, value]) => ({ name, value: String(value ?? '') })),
        )
      }
      setError('')
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setLoading(false)
    }
  }, [identity])

  useEffect(() => {
    void load()
  }, [load])

  const saveZcode = async () => {
    if (busy) return
    const invalid = validateZcodeVersion(zcodeText, t)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy('zcode')
    setError('')
    try {
      const next = await putZcodeVersion(zcodeText.trim())
      if (serverIdentity() !== identity) return
      setZcode(next)
      setZcodeText(next.version || '')
      store.toast(t('已保存'))
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const savePool = async () => {
    if (busy || !pool) return
    const patch: CaptchaPoolSettings = {}
    for (const field of CAPTCHA_POOL_FIELDS) {
      const raw = (poolText[field.key] || '').trim()
      const value = Number(raw)
      if (!raw || !Number.isFinite(value) || !Number.isInteger(value)) {
        setError(t('{field} 需要填整数', { field: poolLabel(field.key) }))
        return
      }
      if (value < field.min || value > field.max) {
        setError(t('{field} 需要在 {min}–{max} 之间', { field: poolLabel(field.key), min: field.min, max: field.max }))
        return
      }
      if (value !== pool[field.key]) patch[field.key] = value
    }
    if (!Object.keys(patch).length) {
      store.toast(t('没有改动'))
      return
    }
    setBusy('pool')
    setError('')
    try {
      const next = await putCaptchaPool(patch)
      if (serverIdentity() !== identity) return
      setPool(next)
      setPoolText(
        Object.fromEntries(CAPTCHA_POOL_FIELDS.map(field => [field.key, String(next[field.key] ?? field.fallback)])),
      )
      store.toast(t('已保存'))
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const saveHeaders = async () => {
    if (busy || !cline) return
    const invalid = validateClineHeaders(headers, t)
    if (invalid) {
      setError(invalid)
      return
    }
    const next: Record<string, string> = {}
    for (const entry of headers) {
      const name = entry.name.trim()
      if (name) next[name] = entry.value
    }
    const ok = await confirmDialog(
      nextCount(next) === 0
        ? t('这会清空所有自定义伪装头，全部回落到插件默认值。确定吗？')
        : t('伪装头是整体替换：网关会只保留这 {count} 个头。确定吗？', { count: nextCount(next) }),
      { title: t('保存 Cline 伪装头'), confirmText: t('保存并替换'), destructive: false },
    )
    if (!ok) return
    setBusy('cline')
    setError('')
    try {
      const saved = await putClineHeaders(next)
      if (serverIdentity() !== identity) return
      setCline(saved)
      setHeaders(Object.entries(saved.overrides || {}).map(([name, value]) => ({ name, value: String(value ?? '') })))
      store.toast(t('已保存'))
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('插件出站设置')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}
          {loading ? <Card className='m-card'><Empty text={t('正在读取插件设置…')} /></Card> : null}

          {!loading ? (
            <>
              {/* ZCode 版本号 */}
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '2px 2px 6px' }}>
                {t('ZCode 客户端版本号')}
              </div>
              <Card className='m-card m-card-pad'>
                <Label htmlFor='zcode-version'>{t('版本号')}</Label>
                <Input
                  id='zcode-version'
                  className='m-mono'
                  placeholder={t('留空 = 用插件内置默认值')}
                  value={zcodeText}
                  onChange={event => setZcodeText(event.currentTarget.value)}
                />
                <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 4 }}>
                  {t('必须以数字开头，只能包含字母、数字、点、下划线与连字符，最多 {max} 个字符。这个值会拼进出站 URL 的 ?app_version=。', {
                    max: 32,
                  })}
                </p>
                {zcode?.envOverride ? (
                  <p style={{ fontSize: 11.5, color: 'var(--m-warn)', lineHeight: 1.7, marginTop: 4 }}>
                    {t('当前被环境变量 ZCODE_APP_VERSION 覆盖（{value}），界面上的值此刻不生效。', {
                      value: zcode.envOverride,
                    })}
                  </p>
                ) : null}
                <div style={{ marginTop: 10 }}>
                  <Button variant='outline' disabled={Boolean(busy)} onClick={() => void saveZcode()}>
                    {busy === 'zcode' ? t('保存中…') : t('保存版本号')}
                  </Button>
                </div>
              </Card>

              {/* 验证码令牌池（插件申报后才有意义） */}
              {panels.includes('captcha_pool') ? (
                <>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '14px 2px 6px' }}>
                    {t('验证码令牌池')}
                  </div>
                  <Card className='m-card m-card-pad'>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {CAPTCHA_POOL_FIELDS.map(field => (
                        <div key={field.key}>
                          <Label htmlFor={`pool-${field.key}`}>{poolLabel(field.key)}</Label>
                          <Input
                            id={`pool-${field.key}`}
                            inputMode='numeric'
                            value={poolText[field.key] || ''}
                            onChange={event => setPoolText({ ...poolText, [field.key]: event.currentTarget.value })}
                          />
                          <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 4 }}>
                            {t('{min}–{max}，默认 {fallback}', { min: field.min, max: field.max, fallback: field.fallback })}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <Button variant='outline' disabled={Boolean(busy)} onClick={() => void savePool()}>
                        {busy === 'pool' ? t('保存中…') : t('保存补货节奏')}
                      </Button>
                    </div>
                  </Card>
                </>
              ) : null}

              {/* Cline 伪装头（插件申报后才有意义） */}
              {panels.includes('upstream_headers') ? (
                <>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '14px 2px 6px' }}>
                    {t('Cline 伪装头')}
                  </div>
                  <Card className='m-card'>
                    {headers.length ? (
                      headers.map((entry, index) => (
                        <div key={index} className='m-row' style={{ alignItems: 'flex-start', gap: 8 }}>
                          <div className='m-grow' style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <Input
                              className='m-mono'
                              placeholder={t('头名')}
                              value={entry.name}
                              onChange={event => {
                                const next = [...headers]
                                next[index] = { ...next[index], name: event.currentTarget.value }
                                setHeaders(next)
                              }}
                            />
                            <Input
                              className='m-mono'
                              placeholder={t('头值；留空 = 这个头不发')}
                              value={entry.value}
                              onChange={event => {
                                const next = [...headers]
                                next[index] = { ...next[index], value: event.currentTarget.value }
                                setHeaders(next)
                              }}
                            />
                          </div>
                          <Button
                            size='sm'
                            variant='ghost'
                            type='button'
                            aria-label={t('删除这一行')}
                            onClick={() => setHeaders(headers.filter((_, i) => i !== index))}
                          >
                            <Icon name='trash' />
                          </Button>
                        </div>
                      ))
                    ) : (
                      <Empty text={t('当前没有自定义伪装头，全部用插件默认值。')} />
                    )}
                    <div className='m-row' style={{ borderBottom: 0 }}>
                      <Button
                        size='sm'
                        variant='outline'
                        type='button'
                        disabled={headers.length >= CLINE_LIMITS.maxEntries}
                        onClick={() => setHeaders([...headers, { name: '', value: '' }])}
                      >
                        {t('添加自定义头')}
                      </Button>
                    </div>
                  </Card>
                  <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, padding: '6px 2px 0' }}>
                    {t('整体替换（不是 merge）：保存时只保留上面这些头。留空的头值表示「这个头不发」；删掉一行表示回落默认值。固定头不能覆盖：{names}', {
                      names: CLINE_FIXED_HEADERS.join('、'),
                    })}
                  </p>
                  <div style={{ marginTop: 10 }}>
                    <Button variant='outline' disabled={Boolean(busy)} onClick={() => void saveHeaders()}>
                      {busy === 'cline' ? t('保存中…') : t('保存伪装头')}
                    </Button>
                  </div>
                  {cline && Object.keys(cline.effective || {}).length ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--m-text-3)', padding: '0 2px 6px' }}>
                        {t('最终生效的头')}
                      </div>
                      <Card className='m-card'>
                        <div className='m-rows' style={{ borderRadius: 0, border: 0 }}>
                          {Object.entries(cline.effective || {}).map(([name, value]) => (
                            <div className='m-row' key={name}>
                              <span className='m-k m-mono'>{name}</span>
                              <span className='m-v m-mono'>{String(value)}</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    </div>
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' onClick={onClose}>{t('关闭')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function nextCount(map: Record<string, string>): number {
  return Object.keys(map).length
}

function poolLabel(key: keyof CaptchaPoolSettings): string {
  if (key === 'zcodeCaptchaPoolTarget') return t('库存目标')
  if (key === 'zcodeCaptchaPoolPollMs') return t('轮询间隔')
  return t('单轮铸造上限')
}
