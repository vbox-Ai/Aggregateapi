import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle , Card, Collapsible, CollapsibleTrigger, CollapsibleContent } from '@ui'
import { Input } from '@ui'
import { PageIntro, ErrorNote, Empty, SectionHead } from '../components/ui'
import { PullIndicator, usePullToRefresh } from '../components/PullToRefresh'
import {
  checkPluginUpdates, getPlugins, installPluginPack, pluginErrorMessage, refreshPluginCatalog,
  setPluginEnabled, setPluginProvider, startPluginInstall, uninstallPlugin,
  type PackSummary, type PluginMutation, type PluginsPayload,
} from '../api/plugins'
import { usePolling } from '../lib/usePolling'
import { serverIdentity } from '../lib/servers'
import { store, useStore } from '../state/store'
import { PluginCard, StorePluginCard } from './plugins/PluginCards'
import { PluginSettingsSheet } from './plugins/PluginSettingsSheet'
import { t } from '../i18n'
import { apiCall } from '../api/client'
import { ScriptPluginsPanel } from '../../../ui-shared/plugins-scripts'
import { ScriptPluginLoginSheet } from '../components/ScriptPluginLoginSheet'
import { PluginPackSettingsSheet } from './plugins/PluginPackSettingsSheet'
import { PluginStartupDialog, subscribePluginDiagnostics, takePluginDiagnostics } from '../../../ui-shared/plugin-startup-view'
import { refreshPluginStartup } from '../../../ui-shared/plugin-startup'
import { PluginTasks } from '../../../ui-shared/plugin-tasks'
import '../styles/checkin.css'

const MIB = 1024 * 1024
/** 上游的 `MAX_PACK_BYTES`；网关没报上限时按它兜底 */
const LEGACY_MAX_PACK_BYTES = 24 * MIB
/** 再大也不信（网关报了个离谱的数字时别把手机拖死） */
const HARD_MAX_PACK_BYTES = 96 * MIB

function clampMaxPackBytes(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, HARD_MAX_PACK_BYTES) : LEGACY_MAX_PACK_BYTES
}

function packSizeLimitMessage(maxPackBytes: number): string {
  return t('插件包大小不能超过 {n} MiB', { n: maxPackBytes / MIB })
}

/** 读成 base64（FileReader 给的是 `data:...;base64,xxxx`，只取逗号后面那段） */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(t('读取文件失败')))
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      const index = text.indexOf('base64,')
      resolve(index >= 0 ? text.slice(index + 7) : text)
    }
    reader.readAsDataURL(file)
  })
}

/**
 * 读包并做两道体积闸门（与桌面端逐条一致）。
 *
 * 手机上这一步比桌面更要紧：24 MiB 的包读成 base64 会变成约 32 MiB 的字符串，
 * 一次性进内存 + 一次 POST。所以在**读之前**就用 `file.size` 挡一次，
 * 读完再用 base64 长度挡一次 —— 免得白读一个大文件才发现要被拒。
 */
async function readPackBase64(file: File, maxPackBytes: number): Promise<string> {
  if (file.size > maxPackBytes) throw new Error(packSizeLimitMessage(maxPackBytes))
  const packB64 = await readBase64(file)
  if (packB64.length > Math.ceil(maxPackBytes / 3) * 4) {
    throw new Error(packSizeLimitMessage(maxPackBytes))
  }
  return packB64
}

export function PluginsPage() {
  const { server } = useStore()
  /**
   * 插件启动诊断对话框。卡片上的「诊断」按钮只是往这个通道投一个 id，
   * 由本页订阅后打开 —— 这样卡片不必各自持有对话框状态。
   */
  const [startupId, setStartupId] = useState<string | null>(null)
  useEffect(() => {
    const open = () => { const id = takePluginDiagnostics(); if (id) setStartupId(id) }
    open()
    return subscribePluginDiagnostics(open)
  }, [])
  const [payload, setPayload] = useState<PluginsPayload | null>(null)
  /**
   * 插件包设置抽屉。带上 `server` 是为了切换服务器后不误用上一台的包 ——
   * 下面的 `settingsPack` 只在服务器一致时才找得到，找不到就不渲染。
   */
  const [packSettings, setPackSettings] = useState<{ id: string; server: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [settings, setSettings] = useState(false)
  const [remove, setRemove] = useState<PackSummary | null>(null)
  /** 「在本机运行」的那支脚本插件：iOS 上网关装不起来（没有 iOS 版 Bun），改在手机本地跑 */
  const [localScript, setLocalScript] = useState<{ id: string; name?: string } | null>(null)
  /** 脚本插件搜索词：过滤由共享面板自己完成，这里只负责把词传下去 */
  const [scriptQuery, setScriptQuery] = useState('')
  const [maxPackBytes, setMaxPackBytes] = useState(LEGACY_MAX_PACK_BYTES)
  const fileRef = useRef<HTMLInputElement>(null)
  const locked = useRef(false)
  const signature = useRef('')
  const seenOperations = useRef(new Set<string>())
  const identity = serverIdentity()

  const load = useCallback(async () => {
    try {
      const data = await getPlugins()
      if (serverIdentity() !== identity) return
      const next = JSON.stringify({
        packs: data.packs.map(pack => ({ id: pack.id, version: pack.version, enabled: pack.enabled, providers: pack.providers })),
        host: data.host,
      })
      if (signature.current !== next) {
        signature.current = next
        void store.refresh(true)
      }
      setPayload(data)
      setMaxPackBytes(clampMaxPackBytes((data as PluginsPayload & { maxPackBytes?: unknown }).maxPackBytes))
      setError('')
      for (const operation of data.operations || []) {
        if (operation.active) continue
        const key = `${operation.id}:${operation.updatedAt}`
        if (seenOperations.current.has(key)) continue
        seenOperations.current.add(key)
        if (Date.now() - operation.updatedAt > 30_000) continue
        if (operation.error || operation.hostError) store.toast(pluginErrorMessage(operation.error || operation.hostError), 'err')
        else if (operation.done) store.toast(t('插件包已安装到 v{version}', { version: operation.version }))
      }
    } catch (cause) {
      if (serverIdentity() === identity) setError(pluginErrorMessage(cause))
    }
  }, [identity])

  usePolling(load, payload?.operations?.some(operation => operation.active) ? 1500 : 10_000)
  const pull = usePullToRefresh({ onRefresh: load })

  async function run<T>(key: string, task: () => Promise<T>): Promise<T | undefined> {
    if (locked.current) return undefined
    locked.current = true
    setBusy(key)
    try {
      const result = await task()
      if (serverIdentity() !== identity) return undefined
      await load()
      return result
    } catch (cause) {
      if (serverIdentity() === identity) store.toast(pluginErrorMessage(cause), 'err')
      return undefined
    } finally { locked.current = false; if (serverIdentity() === identity) setBusy('') }
  }

  async function mutation(key: string, task: () => Promise<PluginMutation>): Promise<boolean> {
    const result = await run(key, async () => {
      const result = await task()
      if (serverIdentity() !== identity) return result
      await store.refresh(true)
      if (result.hostError) store.toast(result.hostError, 'err')
      return result
    })
    return result !== undefined
  }

  const refresh = async () => {
    const result = await run('catalog', refreshPluginCatalog)
    if (result?.error) store.toast(pluginErrorMessage(result.reason) || t('读取插件仓库失败'), 'err')
  }
  const check = async () => {
    const result = await run('check', checkPluginUpdates)
    if (result?.error) store.toast(pluginErrorMessage(result.reason) || t('检查更新失败'), 'err')
  }
  const install = async (id: string, update: boolean) => {
    if (!payload?.target) return
    const result = await run(`install:${id}`, () => startPluginInstall(id, payload.target, update))
    if (result) store.toast(t('下载任务已交给网关，关闭手机不影响安装'))
  }

  /**
   * 从手机上选一个插件包上传安装。
   *
   * 与上面那条（从 Release 下载）的区别只在**包从哪来**：这里包在手机的文件里，
   * 装的位置仍然是网关。上传是同步的（网关收完、校验、装完才回），所以一个
   * 20 MiB 的包在手机上会有几秒到十几秒的等待，`busy` 会把按钮与文案都锁住。
   *
   * ⚠️ 真机待验：iOS 的 WebView 里 `<input type="file">` 能否真的拿到文件内容
   * （取决于壳是否实现了文件选择的回调）。这条路径在**浏览器/PWA** 下是确定的，
   * App 里要实测一次。
   */
  const installFromFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > maxPackBytes) {
      store.toast(packSizeLimitMessage(maxPackBytes), 'err')
      return
    }
    let packB64 = ''
    try {
      setBusy('read')
      packB64 = await readPackBase64(file, maxPackBytes)
    } catch (cause) {
      setBusy('')
      store.toast(cause instanceof Error ? cause.message : String(cause), 'err')
      return
    }
    setBusy('')
    const result = await run('install-file', () => installPluginPack(packB64))
    if (result) store.toast(t('插件包已上传给网关，正在安装'))
  }

  const packs = payload?.packs || []
  const catalog = payload?.catalog?.plugins || []
  const uninstalled = catalog.filter(item => !packs.some(pack => pack.id === item.id))
  // 最近一次带失败原因的插件操作（安装/更新/启停失败会记录在这里）
  const failedOperations = (payload?.operations || []).filter(operation => {
    if (operation.active) return false
    const reason = pluginErrorMessage(operation.error || operation.hostError || '')
    return Boolean(reason)
  })
  return (
    <div className='m-page' ref={pull.bindRef}>
      <PullIndicator pull={pull.pull} refreshing={pull.refreshing} />
      <PageIntro subtitle={t('管理所连接网关的插件，不在手机上安装提供商插件')} />
      <div className='m-section' style={{ marginTop: 0 }}>
        <Card className='m-card m-card-pad'>
          <div className='m-ck-title'>{server?.name || server?.base || t('当前网关')}</div>
          <p className='m-ck-note'>{t('安装、更新与启停均作用在这台网关上。插件平台由网关决定，与手机系统无关。')}</p>
          {payload ? <p className='m-ck-note m-mono'>{payload.target}</p> : null}
          <div className='m-ck-actions'>
            <Button size='sm' variant='outline' disabled={Boolean(busy)} onClick={() => void refresh()}>{busy === 'catalog' ? t('读取中…') : t('刷新插件仓库')}</Button>
            <Button size='sm' variant='outline' disabled={Boolean(busy)} onClick={() => void check()}>{busy === 'check' ? t('检查中…') : t('检查更新')}</Button>
            <Button size='sm' variant='outline' disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
              {busy === 'read' ? t('读取中…') : busy === 'install-file' ? t('上传安装中…') : t('从文件安装…')}
            </Button>
            <Button size='sm' variant='ghost' onClick={() => store.push('logs', { category: 'plugin' })}>{t('插件日志')}</Button>
            <Button size='sm' variant='ghost' onClick={() => setSettings(true)}>{t('插件设置')}</Button>
          </div>
          {/* 选包：只收 zip，体积在读取前先按网关报的上限挡一次 */}
          <input ref={fileRef} type='file' accept='.zip,application/zip' style={{ display: 'none' }}
            onChange={event => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              void installFromFile(file)
            }} />
          <p className='m-ck-note'>{t('从文件安装：把手机里的插件包（zip）上传给网关安装，单个包不超过 {n} MiB。', { n: maxPackBytes / MIB })}</p>
        </Card>
      </div>
      {error ? <ErrorNote text={error} /> : null}
      {payload?.host?.lastError ? <ErrorNote text={payload.host.lastError} /> : null}
      {uninstalled.length ? <div className='m-section'><SectionHead title={t('可安装插件')} />
        {uninstalled.map(item => <StorePluginCard key={item.id} item={item} target={payload?.target || ''}
          operation={payload?.operations?.find(operation => operation.id === item.id)} busy={Boolean(busy)} onInstall={() => void install(item.id, false)} />)}
      </div> : null}
      <div className='m-section'>
        <SectionHead title={t('已安装插件')} />
        {(() => {
          const settingsPack = packSettings && packSettings.server === serverIdentity()
            ? packs.find(item => item.id === packSettings.id) : undefined
          return settingsPack ? <PluginPackSettingsSheet key={`${serverIdentity()}:${settingsPack.id}`}
            pack={settingsPack} disabled={Boolean(busy)}
            onClose={() => setPackSettings(null)}
            onEnabled={enabled => void mutation(`enable:${settingsPack.id}`, () => setPluginEnabled(settingsPack.id, enabled))}
            onProvider={(id, enabled) => void mutation(`provider:${id}`, () => setPluginProvider(settingsPack.id, id, enabled))} /> : null
        })()}
        {packs.map(pack => <PluginCard key={pack.id} pack={pack} busy={Boolean(busy)} target={payload?.target || ''}
          update={payload?.updates?.find(update => update.id === pack.id)}
          operation={payload?.operations?.find(operation => operation.id === pack.id)}
          onEnabled={enabled => void mutation(`enable:${pack.id}`, () => setPluginEnabled(pack.id, enabled))}
          onProvider={(provider, enabled) => void mutation(`provider:${provider}`, () => setPluginProvider(pack.id, provider, enabled))}
          onUpdate={() => void install(pack.id, true)} onRemove={() => setRemove(pack)}
          onSettings={() => setPackSettings({ id: pack.id, server: serverIdentity() })} />)}
        {!packs.length ? <Card className='m-card'><Empty text={payload ? t('这台网关还没有安装插件') : t('正在读取插件列表…')} /></Card> : null}
      </div>
      {/* 脚本插件：上游 v3.5.0 新增的第二类插件（Bun 脚本），与上面的进程插件并列展示；
          iOS 沙盒下调不起来，脚本面板的安装动作会被网关的宿主闸门拒绝，属预期行为。 */}
      {payload?.scripts ? <div className='m-section'>
        <SectionHead title={t('脚本插件')} />
        {/* iOS 上脚本插件装不起来：网关侧没有 iOS 版运行时（bun.rs 的 asset() 没有 ios 分支）。
            这里给一条本地运行的出口 —— 宿主与插件放进手机自己的 Worker，网络请求仍经网关出网。
            只加在手机端：ScriptPluginsPanel 是共享组件，桌面端还在用，不动它以免牵连桌面行为。 */}
        {payload.scripts.packages?.length ? <Card className='m-card m-card-pad'>
          <div className='m-ck-note' style={{ paddingBottom: 8 }}>
            {t('手机本地运行（实验）：iOS 上网关装不了脚本插件，可在本机执行并登录。')}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {payload.scripts.packages.map(item => <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name || item.id}</span>
              <Button variant='ghost' onClick={() => setLocalScript({ id: item.id, name: item.name })}>{t('本机登录')}</Button>
            </div>)}
          </div>
        </Card> : null}
        <Card className='m-card m-card-pad'>
          {/* 搜索框：共享面板本来就支持 query（按名称/简介/provider 过滤），只是调用方一直没传
              ⇒ 手机端因此"能过滤但没入口"。这里补上入口，过滤逻辑仍用面板自己那一套，不另写一遍。 */}
          <Input
            value={scriptQuery}
            onChange={event => setScriptQuery(event.target.value)}
            placeholder={t('搜索脚本插件（名称 / 提供商 / 简介）')}
            aria-label={t('搜索脚本插件')}
            style={{ marginBottom: 8 }}
          />
          <ScriptPluginsPanel key={server?.base || payload.target} state={payload.scripts} t={t}
            query={scriptQuery}
            disabled={Boolean(busy)} request={(path, body) => apiCall(path, { method: 'POST', body })}
            refresh={load} />
        </Card>
      </div> : null}
      <ScriptPluginLoginSheet plugin={localScript} onClose={() => setLocalScript(null)} />
      {/* 插件启动诊断：点卡片上的「诊断」后弹出，可在里面重试启动 */}
      {startupId ? <PluginStartupDialog id={startupId}
        name={packs.find(pack => pack.id === startupId)?.name
          || payload?.scripts?.packages.find(pack => pack.id === startupId)?.name || startupId}
        status={packs.find(pack => pack.id === startupId)?.startup
          || payload?.scripts?.packages.find(pack => pack.id === startupId)?.startup || null}
        script={startupId.startsWith('script-')} t={t} onClose={() => setStartupId(null)}
        retry={async () => {
          if (startupId.startsWith('script-')) await apiCall('/api/plugins/scripts/change', { method: 'POST', body: { id: startupId } })
          else await apiCall('/api/plugins/reload', { method: 'POST', body: { id: startupId } })
          refreshPluginStartup()
          await load()
        }} /> : null}
      {/* 插件任务：网关侧的插件后台任务（与脚本插件同一套请求约定） */}
      <div className='m-section'><PluginTasks t={t}
        request={(path, body) => apiCall(path, { method: 'POST', body })} /></div>
      {payload?.catalog?.reason ? <div className='m-section'><p className='m-ck-note'>{pluginErrorMessage(payload.catalog.reason)}</p></div> : null}
      {failedOperations.length ? <div className='m-section'><Collapsible className='m-card m-card-pad'>
        <CollapsibleTrigger className='m-ck-title'>{t('最近失败')}</CollapsibleTrigger>
        <CollapsibleContent keepMounted>
          {failedOperations.slice(0, 6).map(operation => (
            <p key={operation.id} className='m-ck-note'>
              <span className='m-mono'>{operation.id}</span>：
              {pluginErrorMessage(operation.error || operation.hostError || '')}
            </p>
          ))}
        </CollapsibleContent></Collapsible></div> : null}
      {payload ? <div className='m-section'><Collapsible className='m-card m-card-pad'>
        <CollapsibleTrigger className='m-ck-title'>{t('诊断信息')}</CollapsibleTrigger><CollapsibleContent keepMounted>
        <p className='m-ck-note'>{t('插件目录')}：<span className='m-mono'>{payload.pluginsDir}</span></p>
        <p className='m-ck-note'>{t('协议版本')}：{payload.protocol}</p>
      </CollapsibleContent></Collapsible></div> : null}
      {settings ? <PluginSettingsSheet onClose={() => setSettings(false)} onChanged={load} /> : null}
      <Sheet open={Boolean(remove)} onOpenChange={(open, details) => {
        if (open) return
        if (busy) { details.cancel(); return }
        setRemove(null)
      }}>
        <SheetContent showCloseButton={!busy}>
          <SheetHeader><SheetTitle>{t('卸载插件包')}</SheetTitle></SheetHeader>
          <SheetBody><p className='m-ck-note'>{t('确定卸载「{name}」吗？对应提供商将停止转发，账号数据仍然保留，重新安装后恢复。', { name: remove?.name || '' })}</p></SheetBody>
          <SheetFooter>
            <Button variant='outline' disabled={Boolean(busy)} onClick={() => setRemove(null)}>{t('取消')}</Button>
            <Button variant='destructive' disabled={Boolean(busy)} onClick={async () => {
              if (remove && await mutation(`remove:${remove.id}`, () => uninstallPlugin(remove.id))) setRemove(null)
            }}>{busy ? t('卸载中…') : t('卸载')}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
