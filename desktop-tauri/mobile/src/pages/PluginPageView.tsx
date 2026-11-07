import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@ui'
import { Icon } from '../components/Icon'
import { PageHead } from '../components/ui'
import { getPlugins, type PackUiSummary } from '../api/plugins'
import { authHeaders } from '../api/client'
import { serverIdentity } from '../lib/servers'
import { t } from '../i18n'

/**
 * 插件自定义页面。
 *
 * 页面本体由网关托管（`GET /plugins/{pack}/ui/{*rest}`，见 `api/plugin_ui.rs`）：
 * 只有网关知道包装在哪，手机端看不到那台机器的文件系统。iframe 里的插件页面
 * 拿不到面板令牌头，所以宿主在页面加载后用 postMessage 把鉴权信息送进去。
 *
 * ── 安全 ────────────────────────────────────────────────────
 * `url` 是网关给的，`resolve_ui_file` 只服务已启用包的 `ui/` 目录且拒绝 `..`；
 * 这里再兜一层：只允许同 origin 下的 `/plugins/` 路径。
 * iframe 的 sandbox 只给 `allow-scripts allow-forms allow-same-origin allow-popups`，
 * 不加 `allow-top-navigation` —— 插件页面不能跳走宿主。
 */
export function PluginPageView({ pack, page, onBack }: { pack: string; page: string; onBack: () => void }) {
  const identity = serverIdentity()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [detail, setDetail] = useState<PackUiSummary | null>(null)
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getPlugins()
      .then(payload => {
        if (cancelled || serverIdentity() !== identity) return
        const packSummary = (payload.packs || []).find(item => item.id === pack)
        const entry = (packSummary?.ui || []).find(item => item.id === page)
        if (!entry) {
          setError(t('插件页面「{page}」不存在或未启用', { page }))
          setLoading(false)
          return
        }
        setTitle(entry.title)
        setUrl(entry.url)
        setDetail(entry)
        setLoading(false)
      })
      .catch(cause => {
        if (cancelled || serverIdentity() !== identity) return
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pack, page, identity])

  // 页面加载完成后把鉴权信息送进 iframe：插件页面里的 /api/* 请求要带头
  const sendAuth = () => {
    const frame = frameRef.current
    if (!frame || !url) return
    const target = frame.contentWindow
    if (!target) return
    try {
      target.postMessage({ type: 'a2a-auth', access: authHeaders() }, location.origin)
    } catch {
      /* 跨 origin 的 iframe 抛错是常态：插件页面自己回 origin 取 /api/panel/token */
    }
  }

  const safeUrl = useMemo(() => {
    if (!url) return ''
    try {
      const parsed = new URL(url, location.origin)
      if (parsed.origin !== location.origin) return ''
      if (!parsed.pathname.startsWith('/plugins/')) return ''
      return url
    } catch {
      return ''
    }
  }, [url])

  const loaded = !loading && !error && Boolean(safeUrl)

  return (
    <div className='m-page'>
      <PageHead
        title={title || t('插件页面')}
        subtitle={detail ? `${pack} · ${detail.id}` : pack}
        actions={<Button variant='ghost' size='sm' onClick={onBack}>{t('返回')}</Button>}
      />
      <div className='m-body' style={{ minHeight: 0, flex: 1 }}>
        {loading ? <div className='m-section' style={{ textAlign: 'center', color: 'var(--m-text-3)' }}>{t('正在加载插件页面…')}</div> : null}
        {error ? <div className='m-section'><Button variant='outline' className='w-full' onClick={onBack}>{t('返回插件页')}</Button></div> : null}
        {loaded ? <div
          style={{
            position: 'relative',
            height: 'calc(100vh - 150px)',
            background: '#fff',
            borderRadius: 14,
            overflow: 'hidden',
          }}
        >
          <iframe
            ref={frameRef}
            src={safeUrl}
            title={title || pack}
            sandbox='allow-scripts allow-forms allow-same-origin allow-popups allow-downloads'
            referrerPolicy='no-referrer'
            onLoad={sendAuth}
            style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
          />
        </div> : null}
      </div>

      {error ? (
        <Sheet open onOpenChange={open => { if (!open) onBack() }}>
          <SheetContent>
            <SheetHeader><SheetTitle>{t('插件页面不可用')}</SheetTitle></SheetHeader>
            <SheetBody>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--m-text-2)' }}>{error}</p>
              <p style={{ fontSize: 12, color: 'var(--m-text-3)' }}>
                {t('检查该插件是否启用、是否刚装完需要重装，或回到插件页查看最近失败原因。')}
              </p>
            </SheetBody>
          </SheetContent>
        </Sheet>
      ) : null}
    </div>
  )
}
