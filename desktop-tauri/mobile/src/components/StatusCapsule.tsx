import { useEffect, useRef, useState } from 'react'
import { Button, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@ui'
import { Icon } from './Icon'
import { usePwa } from '../lib/usePwa'
import { supervisorStatus } from '../api/supervisor'
import { fetchLogs, type LogEntry } from '../api/gateway'
import { store, useStore } from '../state/store'
import { t } from '../i18n'

/**
 * 状态胶囊 + 出错小日志窗。
 *
 * ── 为什么是「胶囊」而不是原来的通栏细条 ──────────────────────
 * 通栏细条贴着屏幕上下边缘，视觉上像系统横幅、占满一整行；这里要的是
 * 一枚**只在有话说时才出现**的小胶囊：状态用颜色区分，点一下才展开日志。
 * 形态与悬浮底栏一致（整圆角 + 毛玻璃 + 细描边），两者同属"浮起来的 chrome"。
 *
 * ── 状态与颜色（一一对应，不混用）────────────────────────────
 *   · 已离线            → 琥珀色：页面还能看，但数字不再更新
 *   · 网关已停止        → 红色：这次是真的不工作，需要用户去启动
 *   · 其它（正常/拿不到）→ **不显示**：常驻一个「运行中」胶囊只是噪音
 *
 * ── 为什么只有离线与"网关已停止"两种状态 ────────────────────
 * 面板本身就是网关发出来的页面 —— 页面能加载，就说明网关在跑。真正需要
 * 告诉用户的只有两件事：**网络断了**（离线）与**supervisor 说网关停了**。
 * 后者的数据来自原生桥（跨端口 fetch 会被 CORS 拦），桥不存在就直接
 * 不显示这一条，而不是显示一个猜出来的状态。
 *
 * ── 出错就直接弹窗 ──────────────────────────────────────────
 * 轻提示（toast）3.5 秒就没了，错误往往来不及看清就被下一条顶掉。所以
 * 这里订阅同一条 `toast`：**tone 为 err 时自动开窗**，把最近若干条错误
 * 留在窗里，并附带网关侧最近的 error 级日志（`GET /api/logs?level=error`）。
 */
type Line = { at: number; text: string }

function clock(at: number): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function StatusCapsule() {
  const pwa = usePwa()
  const { toast } = useStore()
  const [gateway, setGateway] = useState<string>('')
  const [bridgeMissing, setBridgeMissing] = useState(false)
  const [open, setOpen] = useState(false)
  const [errors, setErrors] = useState<Line[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const lastToast = useRef<unknown>(null)

  // 网关状态：能拿到桥才轮询，拿不到就永久停手（不刷屏、不假装知道）
  useEffect(() => {
    if (bridgeMissing) return
    let cancelled = false
    const load = async () => {
      try {
        const { status } = await supervisorStatus()
        if (!cancelled) setGateway(String(status?.gateway || ''))
      } catch {
        // 没有原生桥（浏览器 / 桌面面板）—— 这一条状态整块不显示
        if (!cancelled) setBridgeMissing(true)
      }
    }
    void load()
    const timer = window.setInterval(load, 15000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [bridgeMissing])

  // 出错自动开窗：比较对象身份，避免同一条 toast 反复触发
  useEffect(() => {
    if (!toast || toast === lastToast.current) return
    lastToast.current = toast
    if (toast.tone !== 'err') return
    setErrors(current => [{ at: Date.now(), text: toast.text }, ...current].slice(0, 20))
    setOpen(true)
  }, [toast])

  // 开窗时顺带取网关侧 error 级日志（只读，失败不打扰）
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const page = await fetchLogs({ level: 'error', limit: 20 })
        if (!cancelled) setLogs(page?.entries || [])
      } catch {
        if (!cancelled) setLogs([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  const stopped = !bridgeMissing && Boolean(gateway) && gateway !== 'running'
  const tone = pwa.offline ? 'warn' : stopped ? 'danger' : ''
  if (!tone) return null

  return (
    <>
      <button
        type='button'
        className={`m-capsule m-capsule-${tone}`}
        role='status'
        onClick={() => setOpen(true)}
      >
        <Icon name={pwa.offline ? 'alert' : 'info'} />
        <span>{pwa.offline ? t('已离线 · 显示缓存内容') : t('网关已停止')}</span>
        <span className='m-capsule-more'>{t('详情')}</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent showCloseButton>
          <SheetHeader><SheetTitle>{t('运行日志 · 最近的问题')}</SheetTitle></SheetHeader>
          <SheetBody>
            <div className='m-logbox'>
              {errors.length ? errors.map((line, index) => (
                <div key={`${line.at}-${index}`} className='m-logline'>
                  <span className='m-logtime'>{clock(line.at)}</span>
                  <span className='m-logtext'>{line.text}</span>
                </div>
              )) : <div className='m-logempty'>{t('本次会话没有记录到错误。')}</div>}

              <div className='m-logsep'>{t('网关侧 error 级日志')}</div>
              {loading ? <div className='m-logempty'>{t('读取中…')}</div>
                : logs.length ? logs.map((entry, index) => (
                  <div key={entry.id ?? index} className='m-logline'>
                    <span className='m-logtime'>{entry.ts ? clock(entry.ts) : '—'}</span>
                    <span className='m-logtext'>{entry.message || entry.category || ''}</span>
                  </div>
                )) : <div className='m-logempty'>{t('网关侧没有 error 级日志。')}</div>}
            </div>
          </SheetBody>
          <SheetFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>{t('关闭')}</Button>
            <Button onClick={() => { setOpen(false); store.go('logs') }}>{t('打开日志页')}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
