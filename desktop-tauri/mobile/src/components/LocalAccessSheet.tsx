import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Label, SegmentedControl, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Switch, confirmDialog, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ui'
import { Badge, Empty, ErrorNote, SectionHead } from './ui'
import { copyText } from './ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { t } from '../i18n'
import {
  fetchInstallInfo,
  fetchInstallTargets,
  fetchToolApiKeys,
  installMcp,
  installSkill,
  splitOutcomes,
  uninstallMcp,
  uninstallSkill,
  type InstallInfo,
  type InstallTarget,
  type ToolApiKey,
} from '../api/tools-install'

/**
 * 本机接入：接入信息（只读）+ 安装向导。
 *
 * ── 为什么先给「接入信息」 ───────────────────────────────────
 * `install-info` 给出的是**远程 MCP 地址**与工具清单 —— 这段是纯只读的，
 * 在任何设备上都有用：把地址填进任意客户端的 MCP 配置即可（手机上的客户端也行）。
 *
 * ── 安装向导写的是**网关所在主机**的文件 ──────────────────────
 * skill 会写进网关主机的客户端目录、mcp 会改那边的客户端配置。所以：
 * · 手机端直连自己的网关（iOS 上网关就在手机里）→ 那些目录通常不存在，装了没用；
 * · 手机端连**桌面网关** → 这才是它的用武之地。
 * 这句提示必须留在界面上，否则用户会以为「手机上装完就有用了」。
 *
 * `bridge` 档只对视觉分析开放（Rust 侧校验），且面板原文写明「推荐在桌面端使用」。
 */
export function LocalAccessSheet({ serviceId, serviceName, onClose }: { serviceId: string; serviceName: string; onClose: () => void }) {
  const identity = serverIdentity()
  const [info, setInfo] = useState<InstallInfo | null>(null)
  const [protocol, setProtocol] = useState<'skill' | 'mcp'>('skill')
  const [targets, setTargets] = useState<InstallTarget[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [keys, setKeys] = useState<ToolApiKey[]>([])
  const [keyId, setKeyId] = useState('')
  const [variant, setVariant] = useState('')
  const [mode, setMode] = useState<'http' | 'bridge'>('http')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [failed, setFailed] = useState<Array<{ label: string; error: string }>>([])
  const [loading, setLoading] = useState(true)

  const hasSkill = Boolean(info?.skill)
  const effectiveProtocol: 'skill' | 'mcp' = hasSkill ? protocol : 'mcp'

  // 网络搜索有 skill 档；视觉分析只有 mcp。默认给可用的那一档
  useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true)
      try {
        const [nextInfo, keyPayload] = await Promise.all([fetchInstallInfo(serviceId), fetchToolApiKeys()])
        if (!alive || serverIdentity() !== identity) return
        setInfo(nextInfo)
        const variants = nextInfo?.skill?.variants || []
        const recommended = nextInfo?.skill?.recommended_variant
        setVariant(String(recommended || variants[0]?.id || ''))
        setProtocol(nextInfo?.skill ? 'skill' : 'mcp')
        setKeys(keyPayload.keys || [])
        setKeyId(String((keyPayload.keys || [])[0]?.id || ''))
        setError('')
      } catch (cause) {
        if (alive && serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (alive && serverIdentity() === identity) setLoading(false)
      }
    }
    void run()
    return () => { alive = false }
  }, [identity, serviceId])

  /** 目标清单随协议变；默认勾选「已安装」的（与面板侧卸载对话框同一口径） */
  const loadTargets = useCallback(async (next: 'skill' | 'mcp') => {
    try {
      const result = await fetchInstallTargets(serviceId, next)
      if (serverIdentity() !== identity) return
      const list = result.targets || []
      setTargets(list)
      setPicked(list.filter(item => item.installed).map(item => item.key))
      setError('')
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [identity, serviceId])

  useEffect(() => { void loadTargets(effectiveProtocol) }, [loadTargets, effectiveProtocol])

  const installed = targets.filter(item => item.installed)
  const pickedInstalled = picked.filter(key => installed.some(item => item.key === key))

  const run = async (kind: 'install' | 'uninstall') => {
    if (busy) return
    if (!picked.length) {
      setError(t('请至少选择一个目标'))
      return
    }
    if (kind === 'install' && !keyId) {
      setError(t('请选择一把可用的网关 Key'))
      return
    }
    setBusy(kind)
    setError('')
    setFailed([])
    try {
      const result = kind === 'install'
        ? effectiveProtocol === 'skill'
          ? await installSkill({ api_key_id: keyId, variant, clients: picked })
          : await installMcp({ service_id: serviceId, mode, api_key_id: keyId, clients: picked })
        : effectiveProtocol === 'skill'
          ? await uninstallSkill({ service_id: serviceId, clients: picked })
          : await uninstallMcp({ service_id: serviceId, clients: picked })
      if (serverIdentity() !== identity) return
      const summary = splitOutcomes(result.results)
      setFailed(summary.failed)
      if (summary.ok) {
        store.toast(kind === 'install' ? t('已处理 {count} 个目标', { count: summary.ok }) : t('已移除 {count} 个目标配置', { count: summary.ok }))
      }
      await loadTargets(effectiveProtocol)
    } catch (cause) {
      if (serverIdentity() === identity) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (serverIdentity() === identity) setBusy('')
    }
  }

  const confirmUninstall = async () => {
    const ok = await confirmDialog(
      t('从选中的目标移除 {name} 的配置？未勾选的客户端保持不变。', { name: serviceName }),
      { title: t('移除配置'), confirmText: t('移除'), destructive: true },
    )
    if (ok) void run('uninstall')
  }

  const mcpUrl = info?.mcp?.url || ''

  return (
    <Sheet open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>{t('本机接入')} · {serviceName}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}
          {loading ? <Card className='m-card'><Empty text={t('正在读取接入信息…')} /></Card> : null}

          {!loading && info ? (
            <>
              {/* 只读：接入信息 */}
              <Card className='m-card m-card-pad'>
                <div className='m-rows'>
                  <div className='m-row'>
                    <span className='m-k'>{t('名称')}</span>
                    <span className='m-v'>{info.name || serviceId}</span>
                  </div>
                  {info.version ? (
                    <div className='m-row'>
                      <span className='m-k'>{t('版本')}</span>
                      <span className='m-v m-mono'>{info.version}</span>
                    </div>
                  ) : null}
                  {info.timeout_seconds ? (
                    <div className='m-row'>
                      <span className='m-k'>{t('超时')}</span>
                      <span className='m-v m-mono'>{t('{n} 秒', { n: info.timeout_seconds })}</span>
                    </div>
                  ) : null}
                </div>
                {mcpUrl ? (
                  <>
                    <div className='m-t2' style={{ marginTop: 10 }}>{t('远程 MCP 地址（填进任意支持 MCP 的客户端）')}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span className='m-mono' style={{ fontSize: 11, flex: 1, wordBreak: 'break-all' }}>{mcpUrl}</span>
                      <Button variant='ghost' size='sm' onClick={() => void copyText(mcpUrl).then(() => store.toast(t('已复制')))}>
                        {t('复制')}
                      </Button>
                    </div>
                    {info.mcp?.tools?.length ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                        {info.mcp.tools.map(tool => <Badge key={tool} tone='mute'>{tool}</Badge>)}
                      </div>
                    ) : null}
                  </>
                ) : null}
                {info.mcp?.bridge_url ? (
                  <p style={{ fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 8 }}>
                    {t('本地桥接脚本：{url}（本地桥接会在网关主机上跑一个 node 脚本，面板原文建议桌面端使用）', { url: info.mcp.bridge_url })}
                  </p>
                ) : null}
              </Card>

              {/* 协议 */}
              {hasSkill ? (
                <div className='m-section' style={{ marginTop: 14 }}>
                  <SectionHead title={t('接入方式')} />
                  <SegmentedControl
                    options={[
                      { value: 'skill', label: t('Skill') },
                      { value: 'mcp', label: 'MCP' },
                    ]}
                    value={effectiveProtocol}
                    aria-label={t('接入方式')}
                    onValueChange={value => setProtocol(value as 'skill' | 'mcp')}
                  />
                  <p className='m-ck-note' style={{ marginTop: 6 }}>
                    {effectiveProtocol === 'skill'
                      ? t('打包为 Agent Skill，安装到客户端的技能目录。')
                      : t('往客户端的 MCP 配置里写一段；也可以直接把上面的地址手工填进去。')}
                  </p>
                </div>
              ) : null}

              {/* 目标 */}
              <div className='m-section' style={{ marginTop: 14 }}>
                <SectionHead title={t('目标客户端')} />
                <p className='m-ck-note'>
                  {t('目标是**网关所在主机**上的客户端目录 —— 手机连桌面网关时才有意义；网关就跑在手机上时那些目录通常不存在。')}
                </p>
                {targets.length ? (
                  <Card className='m-card'>
                    {targets.map((target, index) => {
                      const on = picked.includes(target.key)
                      return (
                        <div key={target.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: index ? '1px solid var(--m-line)' : undefined }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className='m-t1' style={{ fontSize: 12.5 }}>{target.label || target.key}</div>
                            {target.installed ? <div className='m-t2'>{t('已安装 / 已配置')}</div> : null}
                          </div>
                          <Switch
                            checked={on}
                            aria-label={target.label || target.key}
                            onCheckedChange={next => setPicked(current => (next ? [...current, target.key] : current.filter(item => item !== target.key)))}
                          />
                        </div>
                      )
                    })}
                  </Card>
                ) : (
                  <Card className='m-card'><Empty text={t('这个协议下没有可用的目标客户端。')} /></Card>
                )}
              </div>

              {/* 参数 */}
              <div className='m-section' style={{ marginTop: 14 }}>
                <SectionHead title={t('安装参数')} />
                <Card className='m-card m-card-pad'>
                  <Label htmlFor='access-key'>{t('网关 Key')}</Label>
                  <Select value={keyId || '__none__'} onValueChange={value => setKeyId(!value || value === '__none__' ? '' : value)}>
                    <SelectTrigger id='access-key' className='w-full' aria-label={t('网关 Key')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value='__none__'>{t('（没有可用 Key）')}</SelectItem>
                      {keys.map(item => (
                        <SelectItem key={String(item.id)} value={String(item.id)}>
                          {item.name || item.id} {item.masked ? `· ${item.masked}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p style={{ fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 4 }}>
                    {t('只列可用的 Key；安装时会把它写进客户端的配置。')}
                  </p>

                  {effectiveProtocol === 'skill' && info.skill?.variants?.length ? (
                    <div style={{ marginTop: 12 }}>
                      <Label>{t('运行时变体')}</Label>
                      <SegmentedControl
                        options={info.skill.variants.map(item => ({
                          value: String(item.id || ''),
                          label: String(item.label || item.id || ''),
                        }))}
                        value={variant}
                        aria-label={t('运行时变体')}
                        onValueChange={setVariant}
                      />
                      <p style={{ fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 4 }}>
                        {info.skill.recommended_variant
                          ? t('推荐：{id}', { id: info.skill.recommended_variant })
                          : t('Node.js 无需额外依赖，推荐使用；Python 需要本机有 python。')}
                      </p>
                    </div>
                  ) : null}

                  {effectiveProtocol === 'mcp' && serviceId === 'vision' ? (
                    <div style={{ marginTop: 12 }}>
                      <Label>{t('接入方式')}</Label>
                      <SegmentedControl
                        options={[
                          { value: 'http', label: t('远程 HTTP') },
                          { value: 'bridge', label: t('本地桥接') },
                        ]}
                        value={mode}
                        aria-label={t('接入方式')}
                        onValueChange={value => setMode(value as 'http' | 'bridge')}
                      />
                      <p style={{ fontSize: 11, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 4 }}>
                        {mode === 'bridge'
                          ? t('本地桥接在网关主机上跑一个 node 脚本，支持直接传本地图片路径；面板原文建议桌面端使用。')
                          : t('远程 HTTP 只接受图片内容本身（base64 或可访问的 URL）。')}
                      </p>
                    </div>
                  ) : null}
                </Card>
              </div>

              {failed.length ? (
                <Card className='m-card m-card-pad' style={{ marginTop: 12 }}>
                  <div className='m-t1' style={{ fontSize: 12.5 }}>{t('失败的目标')}</div>
                  {failed.map(item => (
                    <p key={item.label} style={{ fontSize: 11.5, color: 'var(--m-danger)', lineHeight: 1.7, margin: '4px 0 0' }}>
                      {item.label}：{item.error}
                    </p>
                  ))}
                </Card>
              ) : null}
            </>
          ) : null}
        </SheetBody>
        <SheetFooter>
          {pickedInstalled.length ? (
            <Button variant='outline' disabled={Boolean(busy)} onClick={() => void confirmUninstall()}>
              {busy === 'uninstall' ? t('移除中…') : t('移除配置')}
            </Button>
          ) : null}
          <Button disabled={Boolean(busy) || !picked.length} onClick={() => void run('install')}>
            {busy === 'install' ? t('处理中…') : effectiveProtocol === 'skill' ? t('安装') : t('写入配置')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
