import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { apiCall, url } from '../api/client'
import { store } from '../state/store'
import { Button, Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@ui'
import type { HostFile, HostTransport } from '../lib/plugin-host'
import { startPluginHost, type PluginHostSession } from '../lib/plugin-host-session'
import { unpackTarGz, readLoginStart, readUserCode, pollLogin, type LoginStart } from '../lib/plugin-login'

/**
 * 「在本机跑这支脚本插件并登录」——iOS 上没有 Bun（`plugin_host/script/bun.rs` 的
 * `asset()` 没有 ios 分支），所以网关侧装不起来。这里走另一条路：把宿主与插件
 * 放进手机自己的 Worker 里跑，插件的网络请求经宿主回给网关出网。
 *
 * ── 与网关的分工 ──────────────────────────────────────────────
 * · 宿主源码（29 个 .mjs）由**网关**提供，保证与网关版本一致（不给手机自带一份，
 *   否则两边会各自漂移）；
 * · 插件包从 Magpie 的 dist 取（实测这些包已是构建好的产物、dependencies 为空，
 *   故手机上不需要 npm 解析）；
 * · 插件登录成功后由宿主自己把凭证写进网关（`store.update`），本组件不碰凭证。
 *
 * ── 为什么先探测再报错 ────────────────────────────────────────
 * 宿主源码接口（网关侧）属于随本功能一起加的补丁。旧网关没有它时，要说清楚
 * 「缺的是哪一块」，而不是笼统地报「登录失败」。
 */
export type ScriptPluginRef = {
  /** 脚本插件包 id，例如 @magpie-community/opencode-nous-auth */
  id: string
  name?: string
  /** 安装来源：Magpie 分发（tgz）或 npm 包名 */
  version?: string
}

/** 从 Magpie dist 取包并解出文件表 */
async function loadPluginFiles(ref: ScriptPluginRef): Promise<HostFile[]> {
  const index = await fetch('https://api.github.com/repos/magpie-community/plugins/contents/dist/index.json?ref=dist')
    .then(response => response.json())
  const packages = (index?.packages || {}) as Record<string, { latest?: string; versions?: Record<string, { file?: string }> }>
  const entry = packages[ref.id]
  if (!entry) throw new Error(t('Magpie 分发里没有这支插件：{id}', { id: ref.id }))
  const version = ref.version || entry.latest || ''
  const file = entry.versions?.[version]?.file
  if (!file) throw new Error(t('这支插件没有可用的版本（{v}）', { v: version }))
  const response = await fetch(`https://api.github.com/repos/magpie-community/plugins/contents/dist/${file}?ref=dist`)
  if (!response.ok) throw new Error(t('下载插件包失败（HTTP {code}）', { code: String(response.status) }))
  const payload = await response.json()
  const binary = Uint8Array.from(atob(String(payload.content || '').replace(/\n/g, '')), character => character.charCodeAt(0))
  const files = await unpackTarGz(binary)
  if (!files.some(file => file.path === 'package.json')) throw new Error(t('插件包里没有 package.json'))
  return files
}

/** 取网关侧的宿主源码；旧网关没有这条接口时给出可执行的提示 */
async function loadHostFiles(): Promise<HostFile[]> {
  const result = await apiCall<{ files?: Array<{ path: string; text: string }> }>('/api/plugins/host/source')
  const files = result?.files
  if (!Array.isArray(files) || !files.length) {
    throw new Error(t('这台网关没有提供脚本宿主源码（需要网关补丁 0008）；装上新版网关后再试'))
  }
  return files.map(file => ({ path: file.path, text: file.text }))
}

/** 用网关的 WS 桥当传输层：帧就是宿主 stdin/stdout 上的一行 JSON */
function gatewayTransport(provider: string, onNotice: (text: string) => void): HostTransport {
  const base = url('/api/plugins/host/stream').replace(/^http/, 'ws')
  const socket = new WebSocket(base, ['agent2api-plugin-host'])
  const lineHandlers: Array<(line: string) => void> = []
  const closeHandlers: Array<(reason: string) => void> = []
  // WS 建好之前的帧先排队：宿主会立刻发 init，丢掉就会卡在握手
  const queued: string[] = []
  socket.addEventListener('open', () => {
    for (const line of queued.splice(0)) socket.send(line)
  })
  socket.addEventListener('message', event => {
    for (const handler of lineHandlers) handler(String(event.data))
  })
  socket.addEventListener('close', () => {
    for (const handler of closeHandlers) handler(t('与网关的连接已断开'))
  })
  socket.addEventListener('error', () => onNotice(t('与网关的插件通道建立失败')))
  return {
    send(line) {
      if (socket.readyState === WebSocket.OPEN) socket.send(line)
      else queued.push(line)
    },
    onLine(handler) { lineHandlers.push(handler) },
    onClose(handler) { closeHandlers.push(handler) },
  }
}

export function ScriptPluginLoginSheet({ plugin, onClose }: { plugin: ScriptPluginRef | null; onClose: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'waiting' | 'done' | 'failed'>('idle')
  const [detail, setDetail] = useState('')
  const [login, setLogin] = useState<LoginStart | null>(null)
  const sessionRef = useRef<PluginHostSession | null>(null)
  const providerRef = useRef('')

  const stop = useCallback(() => {
    sessionRef.current?.close()
    sessionRef.current = null
  }, [])

  useEffect(() => {
    if (!plugin) return
    let cancelled = false
    setPhase('preparing')
    setDetail('')
    setLogin(null)
    void (async () => {
      try {
        const [hostFiles, pluginFiles] = await Promise.all([loadHostFiles(), loadPluginFiles(plugin)])
        if (cancelled) return
        const transport = gatewayTransport(plugin.id, text => setDetail(text))
        const session = await startPluginHost({ hostFiles, pluginFiles, transport })
        sessionRef.current = session
        // 对端侧（网关）负责 script.http.* / store.*；网关自己没有的应答要如实回错，
        // 否则宿主会一直等（表现为界面卡住而不是报错）。
        session.onRequest((method, params, id) => {
          void apiCall('/api/plugins/host/call', { method: 'POST', body: { method, params, id } })
            .then(result => session.reply(id, { result }))
            .catch(error => session.reply(id, {
              error: { code: 'unsupported', message: error instanceof Error ? error.message : String(error) },
            }))
        })
        session.onEvent(event => {
          if (event.event === 'startup') setDetail(t('正在装载插件…'))
        })
        const loaded = await session.call('init', { packages: [{ id: plugin.id, directory: `packages/${plugin.id}` }], env: { data_dir: '/tmp' } })
        if (cancelled) return
        const providers = Array.isArray(loaded) ? loaded as Array<Record<string, unknown>> : []
        const provider = String(providers[0]?.id || '')
        if (!provider) throw new Error(t('插件没有注册任何提供商'))
        providerRef.current = provider
        const started = await session.call('login.start', { provider, account: '' })
        if (cancelled) return
        setLogin(readLoginStart(started))
        setPhase('waiting')
      } catch (failure) {
        if (cancelled) return
        setPhase('failed')
        setDetail(failure instanceof Error ? failure.message : String(failure))
      }
    })()
    return () => { cancelled = true; stop() }
  }, [plugin, stop, t])

  // 轮询：宿主成功后会把凭证写进网关，这里只等它给出结论
  useEffect(() => {
    if (phase !== 'waiting' || !login || !plugin) return
    let stopped = false
    const timer = window.setInterval(() => {
      void (async () => {
        const session = sessionRef.current
        if (!session || stopped) return
        try {
          const outcome = await pollLogin(session, providerRef.current, '', login.flow)
          if (outcome.status === 'success') {
            stopped = true
            window.clearInterval(timer)
            setPhase('done')
            store.toast(t('登录成功，凭证已由网关保存'))
            onClose()
          } else if (outcome.status === 'failed') {
            stopped = true
            window.clearInterval(timer)
            setPhase('failed')
            setDetail(outcome.message)
          }
        } catch (failure) {
          stopped = true
          window.clearInterval(timer)
          setPhase('failed')
          setDetail(failure instanceof Error ? failure.message : String(failure))
        }
      })()
    }, Math.max(1000, login.pollIntervalMs))
    return () => { window.clearInterval(timer) }
  }, [phase, login, plugin, onClose, t])

  const code = login ? readUserCode(login.instructions) : null
  return (
    <Sheet open={Boolean(plugin)} onOpenChange={open => { if (!open) { stop(); onClose() } }}>
      <SheetContent>
        <SheetHeader><SheetTitle>{t('在本机登录（实验）')}</SheetTitle></SheetHeader>
        <SheetBody>
      {plugin ? <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className='m-ck-note'>{t('这支脚本插件在手机上无法交给网关运行（网关侧没有 iOS 版运行时），改为在手机本地执行。')}</div>
        <div style={{ fontWeight: 600 }}>{plugin.name || plugin.id}</div>
        {phase === 'preparing' ? <div className='m-ck-note'>{t('正在准备插件运行环境…')}</div> : null}
        {login ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {code ? <div style={{
            fontSize: 26, fontWeight: 700, letterSpacing: 2, textAlign: 'center',
            padding: '10px 0', borderRadius: 10, background: 'var(--m-surface-2)', border: '1px solid var(--m-line-strong)',
          }}>{code}</div> : null}
          <div className='m-ck-note'>{login.instructions}</div>
          <Button onClick={() => window.open(login.url, '_blank')}>{t('打开授权页面')}</Button>
          {phase === 'waiting' ? <div className='m-ck-note'>{t('在浏览器里确认后，这里会自动完成…')}</div> : null}
        </div> : null}
        {detail ? <div className='m-ck-note' style={{ color: phase === 'failed' ? 'var(--m-danger)' : undefined }}>{detail}</div> : null}
        {phase === 'done' ? <div>{t('登录成功')}</div> : null}
        <Button variant='ghost' onClick={() => { stop(); onClose() }}>{t('关闭')}</Button>
      </div> : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
