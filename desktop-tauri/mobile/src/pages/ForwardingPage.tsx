import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Label, Switch } from '@ui'
import { PageHead, SectionHead, ErrorNote, Empty } from '../components/ui'
import { Icon } from '../components/Icon'
import { usePullToRefresh, PullIndicator } from '../components/PullToRefresh'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { t } from '../i18n'
import {
  changedKeys,
  fetchDebug,
  fetchImageCompress,
  fetchQueue,
  fetchRetry,
  fetchRoleCompat,
  fetchTimeouts,
  putDebug,
  putImageCompress,
  putQueue,
  putRetry,
  putRoleCompat,
  putTimeouts,
  IMAGE_COMPRESS_LIMITS,
  QUEUE_LIMITS,
  RETRY_LIMITS,
  TIMEOUT_FALLBACK,
  TIMEOUT_LIMITS,
  type DebugSettings,
  type ImageCompressSettings,
  type QueueSettings,
  type RetrySettings,
  type TimeoutSettings,
} from '../api/forwarding'

/**
 * 转发设置。手机端当唯一面板时，「请求成功还是失败、等多久、失败怎么重试」这几件事
 * 全在这里 —— 桌面面板把它们摊在「网关 / 重试 / 超时」三个分类里，手机端收成一页。
 *
 * 交互约定（与设置页其余部分一致）：
 *  · **数值**改动后用区块自己的「保存」：一处校验失败不牵连其它区块；
 *  · **开关**点一下立即生效（iOS 设置页的习惯），失败回滚开关并报错；
 *  · 保存只发**改动过的键** —— 这些端点都是「省略 = 不改」的部分更新，
 *    发整份 draft 会拿本地默认值覆盖服务端当前值。
 */
export function ForwardingPage() {
  const identity = serverIdentity()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)

  // 基线（服务端当前值）+ 文本草稿（允许空串等中间态，保存时再解析）
  const [queue, setQueue] = useState<QueueSettings>({})
  const [queueText, setQueueText] = useState({ queueMaxWaits: '', queueWaitSeconds: '' })
  const [retry, setRetry] = useState<RetrySettings>({})
  const [retryText, setRetryText] = useState({ retryCount: '', retryCrossProviderCount: '', retryIntervalSeconds: '' })
  const [codes, setCodes] = useState<number[]>([])
  const [codeInput, setCodeInput] = useState('')
  const [timeouts, setTimeouts] = useState<TimeoutSettings>({})
  const [timeoutText, setTimeoutText] = useState({
    connectTimeoutSeconds: '',
    headersTimeoutSeconds: '',
    streamIdleTimeoutSeconds: '',
    bodyTimeoutSeconds: '',
  })
  const [compress, setCompress] = useState<ImageCompressSettings>({})
  const [compressText, setCompressText] = useState({
    imageCompressMaxEdge: '',
    imageCompressQuality: '',
    imageCompressThresholdKb: '',
  })
  const [roleCompat, setRoleCompat] = useState(false)
  const [debug, setDebug] = useState<DebugSettings>({})

  const load = useCallback(async () => {
    try {
      const [nextQueue, nextRetry, nextTimeouts, nextCompress, nextRole, nextDebug] = await Promise.all([
        fetchQueue(),
        fetchRetry(),
        fetchTimeouts(),
        fetchImageCompress(),
        fetchRoleCompat(),
        fetchDebug(),
      ])
      if (serverIdentity() !== identity) return
      setQueue(nextQueue)
      setQueueText({
        queueMaxWaits: String(nextQueue.queueMaxWaits ?? QUEUE_LIMITS.queueMaxWaits.fallback),
        queueWaitSeconds: String(nextQueue.queueWaitSeconds ?? QUEUE_LIMITS.queueWaitSeconds.fallback),
      })
      setRetry(nextRetry)
      setRetryText({
        retryCount: String(nextRetry.retryCount ?? RETRY_LIMITS.retryCount.fallback),
        retryCrossProviderCount: String(
          nextRetry.retryCrossProviderCount ?? RETRY_LIMITS.retryCrossProviderCount.fallback,
        ),
        retryIntervalSeconds: String(nextRetry.retryIntervalSeconds ?? RETRY_LIMITS.retryIntervalSeconds.fallback),
      })
      setCodes(nextRetry.noRetryStatusCodes ?? [])
      setTimeouts(nextTimeouts)
      setTimeoutText({
        connectTimeoutSeconds: String(nextTimeouts.connectTimeoutSeconds ?? TIMEOUT_FALLBACK.connectTimeoutSeconds),
        headersTimeoutSeconds: String(nextTimeouts.headersTimeoutSeconds ?? TIMEOUT_FALLBACK.headersTimeoutSeconds),
        streamIdleTimeoutSeconds: String(
          nextTimeouts.streamIdleTimeoutSeconds ?? TIMEOUT_FALLBACK.streamIdleTimeoutSeconds,
        ),
        bodyTimeoutSeconds: String(nextTimeouts.bodyTimeoutSeconds ?? TIMEOUT_FALLBACK.bodyTimeoutSeconds),
      })
      setCompress(nextCompress)
      setCompressText({
        imageCompressMaxEdge: String(
          nextCompress.imageCompressMaxEdge ?? IMAGE_COMPRESS_LIMITS.imageCompressMaxEdge.fallback,
        ),
        imageCompressQuality: String(
          nextCompress.imageCompressQuality ?? IMAGE_COMPRESS_LIMITS.imageCompressQuality.fallback,
        ),
        imageCompressThresholdKb: String(
          nextCompress.imageCompressThresholdKb ?? IMAGE_COMPRESS_LIMITS.imageCompressThresholdKb.fallback,
        ),
      })
      // 默认是「开」，解析口径只有字面 false 才算关
      setRoleCompat(nextRole.developerRoleCompat !== false)
      setDebug(nextDebug)
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

  const pull = usePullToRefresh({ onRefresh: () => load() })

  /** 解析并校验一个整数输入；不合法时返回 null 并写好错误文案 */
  const parseNumber = (
    raw: string,
    field: string,
    min: number,
    max: number,
  ): number | null => {
    const value = Number(raw.trim())
    if (!raw.trim() || !Number.isFinite(value) || !Number.isInteger(value)) {
      setError(t('{field} 需要填整数', { field }))
      return null
    }
    if (value < min || value > max) {
      setError(t('{field} 需要在 {min}–{max} 之间', { field, min, max }))
      return null
    }
    return value
  }

  // ── 各区块保存 ─────────────────────────────────────────────

  const saveQueue = async () => {
    if (busy) return
    const maxWaits = parseNumber(queueText.queueMaxWaits, t('排队等待次数'), QUEUE_LIMITS.queueMaxWaits.min, QUEUE_LIMITS.queueMaxWaits.max)
    if (maxWaits === null) return
    const waitSeconds = parseNumber(
      queueText.queueWaitSeconds,
      t('排队等待秒数'),
      QUEUE_LIMITS.queueWaitSeconds.min,
      QUEUE_LIMITS.queueWaitSeconds.max,
    )
    if (waitSeconds === null) return
    const patch = changedKeys({ queueMaxWaits: maxWaits, queueWaitSeconds: waitSeconds }, queue)
    await save('queue', () => putQueue(patch), next => {
      setQueue(next)
      setQueueText({
        queueMaxWaits: String(next.queueMaxWaits ?? maxWaits),
        queueWaitSeconds: String(next.queueWaitSeconds ?? waitSeconds),
      })
    })
  }

  const saveRetry = async () => {
    if (busy) return
    const count = parseNumber(retryText.retryCount, t('同一账号重试次数'), RETRY_LIMITS.retryCount.min, RETRY_LIMITS.retryCount.max)
    if (count === null) return
    const cross = parseNumber(
      retryText.retryCrossProviderCount,
      t('切换账号重试次数'),
      RETRY_LIMITS.retryCrossProviderCount.min,
      RETRY_LIMITS.retryCrossProviderCount.max,
    )
    if (cross === null) return
    const interval = parseNumber(
      retryText.retryIntervalSeconds,
      t('重试间隔'),
      RETRY_LIMITS.retryIntervalSeconds.min,
      RETRY_LIMITS.retryIntervalSeconds.max,
    )
    if (interval === null) return
    const patch = changedKeys(
      { retryCount: count, retryCrossProviderCount: cross, retryIntervalSeconds: interval, noRetryStatusCodes: codes },
      retry,
    )
    await save('retry', () => putRetry(patch), next => {
      setRetry(next)
      setRetryText({
        retryCount: String(next.retryCount ?? count),
        retryCrossProviderCount: String(next.retryCrossProviderCount ?? cross),
        retryIntervalSeconds: String(next.retryIntervalSeconds ?? interval),
      })
      setCodes(next.noRetryStatusCodes ?? codes)
    })
  }

  const saveTimeouts = async () => {
    if (busy) return
    const fields: Array<[keyof TimeoutSettings, string]> = [
      ['connectTimeoutSeconds', t('连接中超时')],
      ['headersTimeoutSeconds', t('等待响应超时')],
      ['streamIdleTimeoutSeconds', t('流式响应空闲超时')],
      ['bodyTimeoutSeconds', t('非流式响应超时')],
    ]
    const parsed: TimeoutSettings = {}
    for (const [key, label] of fields) {
      const value = parseNumber(timeoutText[key], label, TIMEOUT_LIMITS.min, TIMEOUT_LIMITS.max)
      if (value === null) return
      parsed[key] = value
    }
    const patch = changedKeys(parsed, timeouts)
    await save('timeouts', () => putTimeouts(patch), next => {
      setTimeouts(next)
      setTimeoutText({
        connectTimeoutSeconds: String(next.connectTimeoutSeconds ?? parsed.connectTimeoutSeconds),
        headersTimeoutSeconds: String(next.headersTimeoutSeconds ?? parsed.headersTimeoutSeconds),
        streamIdleTimeoutSeconds: String(next.streamIdleTimeoutSeconds ?? parsed.streamIdleTimeoutSeconds),
        bodyTimeoutSeconds: String(next.bodyTimeoutSeconds ?? parsed.bodyTimeoutSeconds),
      })
    })
  }

  const saveCompress = async () => {
    if (busy) return
    const maxEdge = parseNumber(
      compressText.imageCompressMaxEdge,
      t('长边像素上限'),
      IMAGE_COMPRESS_LIMITS.imageCompressMaxEdge.min,
      IMAGE_COMPRESS_LIMITS.imageCompressMaxEdge.max,
    )
    if (maxEdge === null) return
    const quality = parseNumber(
      compressText.imageCompressQuality,
      t('重编码质量'),
      IMAGE_COMPRESS_LIMITS.imageCompressQuality.min,
      IMAGE_COMPRESS_LIMITS.imageCompressQuality.max,
    )
    if (quality === null) return
    const threshold = parseNumber(
      compressText.imageCompressThresholdKb,
      t('触发阈值'),
      IMAGE_COMPRESS_LIMITS.imageCompressThresholdKb.min,
      IMAGE_COMPRESS_LIMITS.imageCompressThresholdKb.max,
    )
    if (threshold === null) return
    // 这个端点不接受 null：只发改动过的键，没改的键根本不出现
    const patch = changedKeys(
      {
        imageCompressMaxEdge: maxEdge,
        imageCompressQuality: quality,
        imageCompressThresholdKb: threshold,
      },
      compress,
    )
    await save('compress', () => putImageCompress(patch), next => {
      setCompress(next)
      setCompressText({
        imageCompressMaxEdge: String(next.imageCompressMaxEdge ?? maxEdge),
        imageCompressQuality: String(next.imageCompressQuality ?? quality),
        imageCompressThresholdKb: String(next.imageCompressThresholdKb ?? threshold),
      })
    })
  }

  /** 区块保存的公共壳：busy 标记、身份守卫、用后端返回值回填 */
  const save = async <T,>(section: string, action: () => Promise<T>, apply: (next: T) => void) => {
    setBusy(section)
    setError('')
    try {
      const next = await action()
      if (serverIdentity() !== identity) return
      apply(next)
      store.toast(t('已保存，下一个请求生效'))
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  /** 图片压缩开关：点一下立即生效，失败回滚 */
  const toggleCompress = async (next: boolean) => {
    if (busy) return
    const previous = compress
    setCompress({ ...compress, imageCompressEnabled: next })
    setError('')
    try {
      const saved = await putImageCompress({ imageCompressEnabled: next })
      if (serverIdentity() !== identity) return
      setCompress(saved)
      setCompressText({
        imageCompressMaxEdge: String(saved.imageCompressMaxEdge ?? compressText.imageCompressMaxEdge),
        imageCompressQuality: String(saved.imageCompressQuality ?? compressText.imageCompressQuality),
        imageCompressThresholdKb: String(saved.imageCompressThresholdKb ?? compressText.imageCompressThresholdKb),
      })
      store.toast(next ? t('已开启图片压缩') : t('已关闭图片压缩'))
    } catch (cause) {
      if (serverIdentity() === identity) {
        setCompress(previous)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }

  /** 开关类：点一下立即生效，失败回滚 */
  const toggleRoleCompat = async (next: boolean) => {
    if (busy) return
    const previous = roleCompat
    setRoleCompat(next)
    setError('')
    try {
      const saved = await putRoleCompat(next)
      if (serverIdentity() !== identity) return
      setRoleCompat(saved.developerRoleCompat !== false)
      store.toast(next ? t('已开启开发者角色兼容') : t('已关闭开发者角色兼容'))
    } catch (cause) {
      if (serverIdentity() === identity) {
        setRoleCompat(previous)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }

  const toggleDebug = async (next: boolean) => {
    if (busy) return
    const previous = debug
    setDebug({ ...debug, debugMode: next })
    setError('')
    try {
      const saved = await putDebug(next)
      if (serverIdentity() !== identity) return
      // 合并而不是替换：这个端点的响应只带开关，替换会把 count/limit 读数抹掉
      setDebug(current => ({ ...current, ...saved, debugMode: saved.debugMode !== false }))
      store.toast(next ? t('已开启调试模式') : t('已关闭调试模式'))
    } catch (cause) {
      if (serverIdentity() === identity) {
        setDebug(previous)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }

  const addCode = () => {
    const value = Number(codeInput.trim())
    if (!Number.isInteger(value) || value < RETRY_LIMITS.statusCode.min || value > RETRY_LIMITS.statusCode.max) {
      setError(t('错误码需要在 {min}–{max} 之间', { min: RETRY_LIMITS.statusCode.min, max: RETRY_LIMITS.statusCode.max }))
      return
    }
    if (codes.includes(value)) {
      setCodeInput('')
      return
    }
    if (codes.length >= RETRY_LIMITS.maxStatusCodes) {
      setError(t('最多 {max} 个错误码', { max: RETRY_LIMITS.maxStatusCodes }))
      return
    }
    setCodes([...codes, value].sort((a, b) => a - b))
    setCodeInput('')
    setError('')
  }

  const debugMode = debug.debugMode !== false

  return (
    <div className='m-page' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <PageHead
        title={t('转发设置')}
        subtitle={t('排队 · 重试 · 超时 · 压缩 · 排障')}
      />

      <div className='m-section' style={{ marginTop: 0 }}>
        {error ? <ErrorNote text={error} /> : null}
        {loading ? (
          <Card className='m-card'>
            <Empty text={t('正在读取转发设置…')} />
          </Card>
        ) : null}
      </div>

      {!loading ? (
        <>
          {/* 排队等待 */}
          <div className='m-section'>
            <SectionHead
              title={t('排队等待')}
              action={{ label: busy === 'queue' ? t('保存中…') : t('保存'), onClick: () => void saveQueue() }}
            />
            <Card className='m-card m-card-pad'>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <NumberField
                  id='queue-max-waits'
                  label={t('排队等待次数')}
                  hint={t('上游忙时最多排几次，0 = 不排队直接换号')}
                  value={queueText.queueMaxWaits}
                  onChange={value => setQueueText({ ...queueText, queueMaxWaits: value })}
                />
                <NumberField
                  id='queue-wait-seconds'
                  label={t('排队等待秒数')}
                  hint={t('每次等待的秒数，0 = 跟随上游建议')}
                  value={queueText.queueWaitSeconds}
                  onChange={value => setQueueText({ ...queueText, queueWaitSeconds: value })}
                />
              </div>
            </Card>
          </div>

          {/* 重试 */}
          <div className='m-section'>
            <SectionHead
              title={t('重试')}
              action={{ label: busy === 'retry' ? t('保存中…') : t('保存'), onClick: () => void saveRetry() }}
            />
            <Card className='m-card m-card-pad'>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <NumberField
                  id='retry-count'
                  label={t('同一账号重试次数')}
                  hint={t('0 = 失败后直接换账号')}
                  value={retryText.retryCount}
                  onChange={value => setRetryText({ ...retryText, retryCount: value })}
                />
                <NumberField
                  id='retry-cross'
                  label={t('切换账号重试次数')}
                  hint={t('换号次数上限；到顶就返回失败')}
                  value={retryText.retryCrossProviderCount}
                  onChange={value => setRetryText({ ...retryText, retryCrossProviderCount: value })}
                />
                <NumberField
                  id='retry-interval'
                  label={t('重试间隔')}
                  hint={t('秒')}
                  value={retryText.retryIntervalSeconds}
                  onChange={value => setRetryText({ ...retryText, retryIntervalSeconds: value })}
                />
                <div>
                  <Label htmlFor='retry-codes'>{t('指定错误码直接换号')}</Label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Input
                      id='retry-codes'
                      inputMode='numeric'
                      placeholder={t('如 402')}
                      value={codeInput}
                      onChange={event => setCodeInput(event.currentTarget.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ',') {
                          event.preventDefault()
                          addCode()
                        }
                      }}
                    />
                    <Button variant='outline' size='sm' type='button' onClick={addCode}>
                      {t('添加')}
                    </Button>
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6, marginTop: 6 }}>
                    {t('命中这些状态码就不再重试，直接换下一个账号（默认 402 = 余额不足）。')}
                  </p>
                  {codes.length ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {codes.map(code => (
                        <Button
                          key={code}
                          variant='outline'
                          size='sm'
                          type='button'
                          className='m-mono'
                          onClick={() => setCodes(codes.filter(item => item !== code))}
                        >
                          {code} ×
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', marginTop: 8 }}>{t('当前没有指定错误码。')}</p>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* 超时 */}
          <div className='m-section'>
            <SectionHead
              title={t('上游超时')}
              action={{ label: busy === 'timeouts' ? t('保存中…') : t('保存'), onClick: () => void saveTimeouts() }}
            />
            <Card className='m-card m-card-pad'>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <NumberField
                  id='timeout-connect'
                  label={t('连接中超时')}
                  hint={t('建立连接最多等多久（秒）')}
                  value={timeoutText.connectTimeoutSeconds}
                  onChange={value => setTimeoutText({ ...timeoutText, connectTimeoutSeconds: value })}
                />
                <NumberField
                  id='timeout-headers'
                  label={t('等待响应超时')}
                  hint={t('发出请求到收到响应头（秒）')}
                  value={timeoutText.headersTimeoutSeconds}
                  onChange={value => setTimeoutText({ ...timeoutText, headersTimeoutSeconds: value })}
                />
                <NumberField
                  id='timeout-stream'
                  label={t('流式响应空闲超时')}
                  hint={t('流式输出两次数据之间的最长间隔（秒）')}
                  value={timeoutText.streamIdleTimeoutSeconds}
                  onChange={value => setTimeoutText({ ...timeoutText, streamIdleTimeoutSeconds: value })}
                />
                <NumberField
                  id='timeout-body'
                  label={t('非流式响应超时')}
                  hint={t('整段响应体的最长等待（秒）')}
                  value={timeoutText.bodyTimeoutSeconds}
                  onChange={value => setTimeoutText({ ...timeoutText, bodyTimeoutSeconds: value })}
                />
              </div>
            </Card>
          </div>

          {/* 图片压缩 */}
          <div className='m-section'>
            <SectionHead
              title={t('请求图片压缩')}
              action={{ label: busy === 'compress' ? t('保存中…') : t('保存'), onClick: () => void saveCompress() }}
            />
            <Card className='m-card'>
              <div className='m-row'>
                <span className='m-logo'>
                  <Icon name='download' />
                </span>
                <div className='m-grow'>
                  <div className='m-t1'>{t('压缩对话里内嵌的大图')}</div>
                  <div className='m-t2'>{t('只改发给上游的副本；生图与图片编辑不受影响')}</div>
                </div>
                <Switch
                  checked={compress.imageCompressEnabled !== false}
                  aria-label={t('压缩对话里内嵌的大图')}
                  onCheckedChange={value => void toggleCompress(value === true)}
                />
              </div>
              <div className='m-card-pad' style={{ borderTop: '1px solid var(--m-line)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <NumberField
                    id='compress-edge'
                    label={t('长边像素上限')}
                    hint={t('256–8192')}
                    value={compressText.imageCompressMaxEdge}
                    onChange={value => setCompressText({ ...compressText, imageCompressMaxEdge: value })}
                  />
                  <NumberField
                    id='compress-quality'
                    label={t('重编码质量')}
                    hint={t('40–95，越低越省流量')}
                    value={compressText.imageCompressQuality}
                    onChange={value => setCompressText({ ...compressText, imageCompressQuality: value })}
                  />
                  <NumberField
                    id='compress-threshold'
                    label={t('触发阈值')}
                    hint={t('超过这个大小（KB）才压缩，0 = 全都压')}
                    value={compressText.imageCompressThresholdKb}
                    onChange={value => setCompressText({ ...compressText, imageCompressThresholdKb: value })}
                  />
                </div>
              </div>
            </Card>
          </div>

          {/* 兼容与排障 */}
          <div className='m-section'>
            <SectionHead title={t('兼容与排障')} />
            <Card className='m-card'>
              <div className='m-row'>
                <span className='m-logo'>
                  <Icon name='shield' />
                </span>
                <div className='m-grow'>
                  <div className='m-t1'>{t('开发者角色兼容')}</div>
                  <div className='m-t2'>{t('把 developer 角色转成 system，兼容不支持它的上游')}</div>
                </div>
                <Switch
                  checked={roleCompat}
                  aria-label={t('开发者角色兼容')}
                  onCheckedChange={value => void toggleRoleCompat(value === true)}
                />
              </div>
              <div className='m-row'>
                <span className='m-logo'>
                  <Icon name='log' />
                </span>
                <div className='m-grow'>
                  <div className='m-t1'>{t('调试模式')}</div>
                  <div className='m-t2'>
                    {t('保存上游原始报文，排障时才开')}
                    {typeof debug.count === 'number'
                      ? t('　已存 {count}/{limit} 条', { count: debug.count, limit: debug.limit ?? 0 })
                      : ''}
                  </div>
                </div>
                <Switch
                  checked={debugMode}
                  aria-label={t('调试模式')}
                  onCheckedChange={value => void toggleDebug(value === true)}
                />
              </div>
            </Card>
            <Card className='m-card m-card-pad' style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7 }}>
              {t('调试模式会把上游请求头/请求体/响应头/响应体原样存进库，占空间且包含对话内容；不排障时请关掉。在「请求日志」里能看每一次转发命中了哪条链路。')}
            </Card>
          </div>
        </>
      ) : null}
    </div>
  )
}

/** 数字输入：标签 + 输入 + 一句范围说明（越界由保存时统一报错，不静默改值） */
function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode='numeric'
        value={value}
        onChange={event => onChange(event.currentTarget.value)}
      />
      <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.6, marginTop: 4 }}>{hint}</p>
    </div>
  )
}
