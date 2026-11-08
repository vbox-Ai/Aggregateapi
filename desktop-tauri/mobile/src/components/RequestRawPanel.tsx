import { useEffect, useState } from 'react'
import { Button, Card } from '@ui'
import { Badge, Empty, ErrorNote } from './ui'
import { copyText } from './ui'
import { serverIdentity } from '../lib/servers'
import { t } from '../i18n'
import { fetchRequestRaw, prettify, type RawBodyResult } from '../api/request-raw'

/**
 * 单条请求的原始报文。
 *
 * ── 为什么按需加载 ───────────────────────────────────────────
 * 正文可能很大（网关单请求上限 32MB）。请求列表一点开就去拉，会让抽屉打开
 * 变慢、流量白花 —— 所以先给一个按钮，用户想看才拉。
 *
 * ── 为什么显示时截断 ────────────────────────────────────────
 * WebView 渲染几万个字符的 `<pre>` 会明显卡顿，手机上更明显。这里只渲染
 * 前 `PREVIEW_LIMIT` 个字符，全文留在内存里给「复制全文」——**要完整内容的
 * 场景是贴给别人看，不是屏上读**。
 */
const PREVIEW_LIMIT = 6000

export function RequestRawPanel({ id }: { id: string }) {
  const identity = serverIdentity()
  const [state, setState] = useState<RawBodyResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 换了一条请求就丢掉上一条的报文，否则会短暂显示错的内容
  useEffect(() => { setState(null); setError('') }, [id])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const next = await fetchRequestRaw(id)
      if (serverIdentity() !== identity) return
      setState(next)
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setLoading(false)
    }
  }

  if (error) return <ErrorNote text={error} />

  if (!state) {
    return (
      <Card className='m-card m-card-pad'>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className='m-t1' style={{ fontSize: 12.5 }}>{t('原始报文')}</div>
            <div className='m-t2' style={{ lineHeight: 1.6 }}>
              {t('请求体与响应体的原文。只在调试模式开启期间采集，不一定会保存。')}
            </div>
          </div>
          <Button variant='outline' size='sm' disabled={loading} onClick={() => void load()}>
            {loading ? t('读取中…') : t('查看')}
          </Button>
        </div>
      </Card>
    )
  }

  if (!state.found) {
    return (
      <Card className='m-card m-card-pad'>
        <div className='m-t1' style={{ fontSize: 12.5 }}>{t('原始报文')}</div>
        <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 4 }}>
          {t('这条请求没有保存原始报文。正文只在「调试模式」开启期间的请求上采集，也可能已被清理——两者都是正常情况。想看后续请求的正文，先去转发设置里打开调试模式。')}
        </p>
      </Card>
    )
  }

  const request = prettify(state.body.requestBody)
  const response = prettify(state.body.responseBody)

  return (
    <Card className='m-card m-card-pad'>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className='m-t1' style={{ fontSize: 12.5, flex: 1 }}>{t('原始报文')}</div>
        {state.body.truncated ? <Badge tone='warn'>{t('旧版本保存，可能不完整')}</Badge> : null}
      </div>
      {request || response ? (
        <>
          <RawBlock label={t('请求体')} text={request} />
          <RawBlock label={t('响应体')} text={response} />
        </>
      ) : (
        <Empty text={t('这条请求的两侧正文都是空的。')} />
      )}
    </Card>
  )
}

function RawBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false)
  if (!text) {
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 11.5, color: 'var(--m-text-3)' }}>{label} · {t('空')}</div>
      </div>
    )
  }
  const clipped = text.length > PREVIEW_LIMIT
  const shown = clipped ? text.slice(0, PREVIEW_LIMIT) : text
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: 'var(--m-text-3)', flex: 1 }}>
          {label} · {text.length.toLocaleString()} {t('字符')}
          {clipped ? ` · ${t('只显示前 {n} 个', { n: PREVIEW_LIMIT.toLocaleString() })}` : ''}
        </span>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => {
            void copyText(text).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? t('已复制') : clipped ? t('复制全文') : t('复制')}
        </Button>
      </div>
      <pre
        className='m-mono'
        style={{
          fontSize: 11,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 320,
          overflow: 'auto',
          margin: '6px 0 0',
          padding: 10,
          background: 'var(--m-surface-2)',
          borderRadius: 8,
        }}
      >
        {shown}
      </pre>
    </div>
  )
}
