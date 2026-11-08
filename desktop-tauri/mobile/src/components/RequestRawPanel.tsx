import { useEffect, useState } from 'react'
import { Button, Card } from '@ui'
import { Badge, Empty, ErrorNote } from './ui'
import { TextBlock } from './TextBlock'
import { serverIdentity } from '../lib/servers'
import { t } from '../i18n'
import { fetchRequestRaw, prettify, type RawBodyResult } from '../api/request-raw'

/**
 * 请求与响应正文（`/api/stats/requests/raw?id=`）。
 *
 * ── 名字为什么和桌面端不一样 ─────────────────────────────────
 * 桌面端把这个端点放在请求详情的**「预览对话」**标签页里：它拿两侧正文，
 * 交给 `window.wbConversationPreview.render()` 拼成一段对话预览的 HTML
 * （那个渲染器是面板侧的脚本，按各家格式解析消息）。
 *
 * 手机端**不搬那个渲染器**：它要按提供商解析请求/响应结构，属于「另做一套
 * 对话 UI」的量级；而排查问题时真正要看的是**原文**。所以这里如实显示两段
 * 正文，标签也叫「请求与响应正文」——不叫「原始报文」，因为那是另一个面板
 * （`DebugTrafficPanel`，含头部四段）。
 *
 * 按需加载：正文上限 32MB，一点开就拉会拖慢抽屉、白花流量。
 */
export function RequestRawPanel({ id }: { id: string }) {
  const identity = serverIdentity()
  const [state, setState] = useState<RawBodyResult | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // 换了一条请求就丢掉上一条的正文，否则会短暂显示错的内容
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
            <div className='m-t1' style={{ fontSize: 12.5 }}>{t('请求与响应正文')}</div>
            <div className='m-t2' style={{ lineHeight: 1.6 }}>
              {t('两侧正文的原文。只在调试模式开启期间采集，不一定会保存。')}
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
        <div className='m-t1' style={{ fontSize: 12.5 }}>{t('请求与响应正文')}</div>
        <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 4 }}>
          {t('这条请求没有保存正文。正文只在「调试模式」开启期间的请求上采集，也可能已被清理——两者都是正常情况。')}
        </p>
      </Card>
    )
  }

  const request = prettify(state.body.requestBody)
  const response = prettify(state.body.responseBody)

  return (
    <Card className='m-card m-card-pad'>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className='m-t1' style={{ fontSize: 12.5, flex: 1 }}>{t('请求与响应正文')}</div>
        {state.body.truncated ? <Badge tone='warn'>{t('旧版本保存，可能不完整')}</Badge> : null}
      </div>
      {request || response ? (
        <>
          <TextBlock label={t('请求体')} text={request} />
          <TextBlock label={t('响应体')} text={response} />
        </>
      ) : (
        <Empty text={t('这条请求的两侧正文都是空的。')} />
      )}
    </Card>
  )
}
