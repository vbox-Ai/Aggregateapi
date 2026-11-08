import { useEffect, useState } from 'react'
import { Button, Card } from '@ui'
import { Badge, ErrorNote } from './ui'
import { TextBlock } from './TextBlock'
import { serverIdentity } from '../lib/servers'
import { t } from '../i18n'
import { fetchDebugTraffic, trafficSections, type DebugTrafficResult } from '../api/debug-traffic'

/**
 * 调试报文（`/api/debug/traffic?id=`）。
 *
 * 与「请求与响应正文」的区别见 `api/debug-traffic.ts` 的表：这一份是**四段**
 * （请求头 / 请求体 / 响应头 / 响应体）+ URL、提供商、上游状态码，请求头里的凭据
 * 已被网关替换成 `[redacted]`。桌面端把它放在请求详情的「原始报文」标签页里。
 *
 * 按需加载（报文可能很大，一点开就拉会拖慢抽屉）。
 */
export function DebugTrafficPanel({ id }: { id: string }) {
  const identity = serverIdentity()
  const [state, setState] = useState<DebugTrafficResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => { setState(null); setError('') }, [id])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const next = await fetchDebugTraffic(id)
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
            <div className='m-t1' style={{ fontSize: 12.5 }}>{t('调试报文')}</div>
            <div className='m-t2' style={{ lineHeight: 1.6 }}>
              {t('请求头 / 请求体 / 响应头 / 响应体四段。请求头里的凭据已由网关替换为 [redacted]。')}
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
        <div className='m-t1' style={{ fontSize: 12.5 }}>{t('调试报文')}</div>
        <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 4 }}>
          {t('这条请求没有保存调试报文。在转发设置里开启「调试模式」之后，新发生的请求才会保存报文（含头部）。')}
        </p>
      </Card>
    )
  }

  const data = state.data
  const sections = trafficSections(data)
  const status = data.status === null || data.status === undefined ? '—' : String(data.status)

  return (
    <Card className='m-card m-card-pad'>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className='m-t1' style={{ fontSize: 12.5, flex: 1 }}>{t('调试报文')}</div>
        {data.truncated ? <Badge tone='warn'>{t('旧版本保存，缺失内容无法恢复')}</Badge> : null}
      </div>

      <div className='m-rows' style={{ marginTop: 8 }}>
        {data.url ? (
          <div className='m-row'>
            <span className='m-k'>URL</span>
            <span className='m-v m-mono' style={{ fontSize: 11, wordBreak: 'break-all' }}>{data.url}</span>
          </div>
        ) : null}
        {data.provider ? (
          <div className='m-row'>
            <span className='m-k'>{t('提供商')}</span>
            <span className='m-v'>{data.provider}</span>
          </div>
        ) : null}
        <div className='m-row'>
          <span className='m-k'>{t('上游状态码')}</span>
          <span className='m-v m-mono'>{status}</span>
        </div>
      </div>

      {sections.map(section => (
        <TextBlock
          key={section.label}
          label={section.label}
          text={section.text}
          note={t('这段没有保存')}
        />
      ))}
    </Card>
  )
}
