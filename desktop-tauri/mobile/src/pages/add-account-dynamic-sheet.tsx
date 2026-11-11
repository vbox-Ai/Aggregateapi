/** 动态登录入口；列表只从 session 实际运行时摘要派生，不登记第二份 provider。 */
import { useEffect, useRef, useState } from 'react'
import {
  Alert, AlertDescription, AlertTitle, Badge, Button, Card, Input, Label, Select,
  SelectContent, SelectItem, SelectTrigger, SelectValue, Sheet, SheetBody, SheetContent,
  SheetHeader, SheetTitle, Spinner,
} from '@ui'
import { ProviderLogo } from '../components/ProviderLogo'
import { providerLabel } from '../lib/providers'
import { serverIdentity } from '../lib/servers'
import { store, useStore } from '../state/store'
import {
  addDynamicApiAccount, cancelDynamicLogin, dynamicLoginError, methodsUnavailable,
  readDynamicMethods, startDynamicLogin, submitDynamicCallback, waitDynamicLogin,
} from '../api/add-account-dynamic'
import {
  loginText, methodLabel, parseCallbackInput, parseMethods, promptEnabled, promptValue, readInputs,
  type CallbackInput, type MethodsState,
} from '../../../ui-islands/src/islands/add-account-dynamic-fields'
import { isAddAccountProviderHidden } from '../../../ui-shared/provider-availability'
import {
  ANTIGRAVITY_ACP_PROVIDER, antigravityLoginProviders, groupAntigravityCards, isAntigravityAccountProvider,
} from '../../../ui-shared/antigravity-login'
import { hasStaticConfig } from '../lib/add-account-static'
import { AddAccountStaticSheet } from './add-account-static-sheet'
import { apiCall } from '../api/client'
import { fetchProxyPool, type PoolItem } from '../api/gateway'
import { readSystemProxy } from '../../../ui-shared/proxy-system'
import { PluginLoginInteraction } from '../../../ui-shared/plugin-login-interaction'
import { t } from '../i18n'

/** 桌面端 `ui/preset-providers.js` 暴露的预置清单（同一份文件，见 apk.html 的 script 标签） */
type PresetProvider = {
  key: string
  name: string
  icon?: string
  protocol: string
  baseUrl: string
  hint?: string
}
declare global {
  interface Window { wbPresetProviders?: { list?: PresetProvider[] } }
}

/**
 * 取预置清单。
 *
 * 正常路径是页面上的 `<script src="preset-providers.js">`（与桌面同一份文件）。
 * 但面板有 Service Worker 缓存，**升级后第一次打开可能仍是旧 HTML**（没有这行标签），
 * 所以这里再兜一次：缺了就动态注入同一路径的脚本，等它挂上 `window.wbPresetProviders`。
 */
async function loadPresets(): Promise<PresetProvider[]> {
  const present = () => window.wbPresetProviders?.list
  if (!present()) {
    await new Promise<void>(resolve => {
      const script = document.createElement('script')
      script.src = 'preset-providers.js'
      script.onload = () => resolve()
      script.onerror = () => resolve()
      document.head.appendChild(script)
    })
  }
  return present() ?? []
}

export function DynamicProviderSheet({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { session, sessionError } = useStore()
  const providers = sessionError ? [] : (session?.accounts?.providers || [])
    .filter(item => Boolean(item.id) && !isAddAccountProviderHidden(item.id || ''))
  /**
   * Antigravity 系有两家插件（网页登录的 `antigravity` 与 ACP 的 `agy-cli`），
   * 上游把两者**并成一张卡**、账号数相加，选中之后再选「添加方式」。
   * 列表与计数都用合并后的卡片，避免同一家出现两张卡、数量各算一半。
   */
  const cards = groupAntigravityCards(providers)
  /** 选中的 Antigravity 添加方式（空 = 跟随卡片默认的那一家） */
  const [agyPicker, setAgyPicker] = useState('')
  const [selected, setSelected] = useState('')
  /**
   * 动态登录回落到静态表单的提供商。
   *
   * 网关对"没实现动态登录"的家回 501，而桌面端对其中 27 家走的是静态表单
   * （`add-account-configs.ts`）。原来手机端遇到 501 直接给一句"未声明动态登录方式"
   * 就结束了 —— 于是**所有资源平台**在手机上都没法加账号。现在改成：
   * **动态优先，501 且这家有静态配置时整块换成静态表单**（字段与提交语义与桌面一致）。
   */
  const [staticProvider, setStaticProvider] = useState('')
  const [search, setSearch] = useState('')
  /**
   * 分类分段：与桌面端第 1 步的「全部 / Agent / Web / API 模板 / 已建 API」对齐。
   *
   * 判据与桌面**同源**，不另立一套：
   *   · `custom-` 前缀 = 自定义提供商（网关 `is_custom_provider_id` 的判据，见 custom_providers.rs）；
   *   · 其余按网关给的 `category`（`web` / `agent`，见 providers/mod.rs 的 provider 摘要）。
   * 「API 模板」在手机端没有模板数据（模板来自桌面壳的 `wbPresetProviders`），所以这一档
   * 不列假数据，而是把用户送到已有的「自定义提供商」页面去新建 —— 那条路手机端本来就有。
   */
  const [kind, setKind] = useState<'all' | 'agent' | 'web' | 'custom' | 'preset'>('all')
  /** 「API 模板」：来自桌面同一份预置清单 */
  const [presets, setPresets] = useState<PresetProvider[]>([])
  const [presetBusy, setPresetBusy] = useState('')
  const [presetError, setPresetError] = useState('')

  useEffect(() => {
    let alive = true
    void loadPresets().then(list => { if (alive) setPresets(list) })
    return () => { alive = false }
  }, [])

  /**
   * 点模板 ⇒ 直接用它的三个字段（名称 / 协议 / Base URL）建好自定义提供商。
   * 桌面端是"选中 ⇒ 预填表单 ⇒ 提交"，手机端少一步填表；落库后与手建的一样是普通自定义提供商，
   * 所以建完切到「已建 API」那一档，用户能立刻给它添加账号。
   */
  const createFromPreset = async (preset: PresetProvider) => {
    setPresetBusy(preset.key)
    setPresetError('')
    try {
      await apiCall('/api/custom-providers', {
        method: 'POST',
        body: { name: preset.name, protocol: preset.protocol, baseUrl: preset.baseUrl },
      })
      onAdded()
      setKind('custom')
    } catch (failure) {
      setPresetError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setPresetBusy('')
    }
  }

  const keyword = search.trim().toLowerCase()
  const kindOf = (item: { id?: string; category?: string }): 'agent' | 'web' | 'custom' => {
    if (String(item.id || '').startsWith('custom-')) return 'custom'
    return item.category === 'web' ? 'web' : 'agent'
  }
  const counts = {
    all: cards.length,
    agent: cards.filter(item => kindOf(item) === 'agent').length,
    web: cards.filter(item => kindOf(item) === 'web').length,
    custom: cards.filter(item => kindOf(item) === 'custom').length,
  }
  const selectedProvider = providers.find(item => item.id === selected)
  /** 当前选中的是 Antigravity 系时，这一家的全部可登录插件（顺序：antigravity → agy-cli） */
  const agyMembers = isAntigravityAccountProvider(selected) ? antigravityLoginProviders(providers) : []
  /** 真正拿去渲染表单的那一家：选了添加方式就用它，否则用卡片默认的那一家 */
  const effectiveProvider = agyMembers.some(item => item.id === agyPicker) ? agyPicker : selected
  const effectiveMember = agyMembers.find(item => item.id === effectiveProvider)
  /** Antigravity 的显示名：ACP 那家用自己的标签，网页登录那家说明是「网页登录 / 填写凭证」 */
  const formLabel = agyMembers.length
    ? (effectiveProvider === ANTIGRAVITY_ACP_PROVIDER
      ? effectiveMember?.label || effectiveProvider
      : t('网页登录 / 填写凭证'))
    : (selectedProvider?.label || selected)
  const identity = serverIdentity()

  return <Sheet open onOpenChange={open => { if (!open) onClose() }}>
    <SheetContent>
      <SheetHeader><SheetTitle>{selectedProvider
        ? t('登录 / 添加 {name} 账号', { name: providerLabel(selected, selectedProvider.label) })
        : t('选择提供商')}</SheetTitle></SheetHeader>
      <SheetBody>
        {staticProvider ? <>
          {/* 这家没有动态登录、但有静态表单（桌面同款）：整块换成静态表单 */}
          <AddAccountStaticSheet provider={staticProvider} onClose={onClose} onAdded={onAdded} />
        </> : selectedProvider ? <>
          <Button size='sm' variant='outline' className='self-start' onClick={() => setSelected('')}>{t('返回提供商列表')}</Button>
          {agyMembers.length > 1 ? <>
            <Label>{t('添加方式')}</Label>
            <Select value={effectiveProvider} onValueChange={value => { if (value) setAgyPicker(value) }}>
              <SelectTrigger className='w-full' aria-label={t('添加方式')}><SelectValue>{formLabel}</SelectValue></SelectTrigger>
              <SelectContent>{agyMembers.map(item => <SelectItem key={item.id} value={item.id || ''}>
                {item.id === ANTIGRAVITY_ACP_PROVIDER ? item.label || item.id : t('网页登录 / 填写凭证')}
              </SelectItem>)}</SelectContent>
            </Select>
          </> : null}
          <DynamicForm key={`${identity}:${effectiveProvider}`} provider={effectiveProvider} label={formLabel}
            source={(effectiveMember || selectedProvider)?.source} onAdded={onAdded}
            hideMethodPicker={effectiveProvider === ANTIGRAVITY_ACP_PROVIDER}
            onStaticFallback={() => setStaticProvider(effectiveProvider)} />
        </> : <>
          <p className='text-xs text-subtle'>{t('提供商仅在已启用且加载后出现。登录与本机引用均作用在所连接网关，不是手机。')}</p>
          <Input type='search' value={search} placeholder={t('搜索提供商…')}
            onChange={event => setSearch(event.currentTarget.value)} />
          {sessionError ? <Alert variant='destructive'><AlertDescription>{sessionError}</AlertDescription></Alert> : null}
          {/* 分类分段（与桌面端第 1 步一致）：全部 / Agent / Web / 已建 API / API 模板 */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {([
              ['all', t('全部'), counts.all],
              ['agent', 'Agent', counts.agent],
              ['web', 'Web', counts.web],
              ['custom', t('已建 API'), counts.custom],
              ['preset', t('API 模板'), -1],
            ] as const).map(([id, label, count]) => (
              <Button key={id} size='sm' variant={kind === id ? 'default' : 'outline'}
                style={{ flex: 'none' }} onClick={() => setKind(id)}>
                {label}{count >= 0 ? ` ${count}` : ''}
              </Button>
            ))}
          </div>
          {kind === 'preset' ? (
            <div style={{ padding: '8px 0 4px' }}>
              {/* 模板清单来自桌面同一份 preset-providers.js（见 apk.html 的 script 标签）。
                  桌面端是"选中模板 ⇒ 预填表单 ⇒ 提交"；手机端少一步：点一下就用该模板的值
                  （名称 / 协议 / Base URL，正是自定义提供商的三个字段）直接建好，
                  之后回这个面板就能给它添加账号。 */}
              {presets.length ? presets.map(preset => (
                <Button key={preset.key} variant='outline'
                  className='h-auto min-h-16 justify-start whitespace-normal text-left'
                  style={{ width: '100%', marginBottom: 6 }}
                  disabled={presetBusy !== ''}
                  onClick={() => void createFromPreset(preset)}>
                  <span className='block'>
                    <span className='block text-sm'>{preset.name}</span>
                    {preset.hint ? <span className='block text-xs text-subtle'>{preset.hint}</span> : null}
                    <span className='block text-xs text-subtle'>{preset.baseUrl}</span>
                    {presetBusy === preset.key ? <span className='block text-xs'>{t('正在新建…')}</span> : null}
                  </span>
                </Button>
              )) : (
                <p className='text-xs text-subtle' style={{ lineHeight: 1.7 }}>
                  {t('预置清单未加载（网关版本较旧或页面未带上 preset-providers.js）。也可直接去「自定义提供商」新建。')}
                </p>
              )}
              {presetError ? <p className='text-xs text-subtle' style={{ lineHeight: 1.7 }}>{presetError}</p> : null}
              <Button variant='outline' style={{ marginTop: 8 }}
                onClick={() => { onClose(); store.go('custom-providers') }}>
                {t('去自定义提供商新建')}
              </Button>
            </div>
          ) : null}
          <div className='grid grid-cols-1 gap-2 min-[420px]:grid-cols-2'>
            {kind === 'preset' ? null : cards
              .filter(item => kind === 'all' || kindOf(item) === kind)
              .filter(item => !keyword || `${item.id} ${providerLabel(item.id, item.label)}`.toLowerCase().includes(keyword))
              .map(item => <Button key={item.id} variant='outline' className='h-auto min-h-16 justify-start whitespace-normal text-left'
                onClick={() => setSelected(item.id || '')}>
                <ProviderLogo id={item.id} label={item.label} />
                <span className='flex min-w-0 flex-col gap-1'>
                  <span>{providerLabel(item.id, item.label)}</span>
                  <span className='text-[11px] text-muted-foreground'>{t('{n} 个账号', { n: item.count || 0 })}</span>
                </span>
              </Button>)}
          </div>
          {!cards.length ? <p className='text-xs text-subtle'>{t('请安装并启用对应的提供商插件；列表为空时请刷新后重试。')}</p> : null}
          <Button variant='outline' onClick={() => void store.refresh(true)}>{t('重新读取提供商')}</Button>
        </>}
      </SheetBody>
    </SheetContent>
  </Sheet>
}

function DynamicForm({ provider, label, source, onAdded, onStaticFallback, hideMethodPicker = false }: {
  provider: string; label: string; source?: string; onAdded: () => void
  /** 501 且这家有静态表单时回调：由父组件把表单整块换成静态面板 */
  onStaticFallback?: () => void
  /**
   * 隐藏插件自带的「登录方式」下拉。
   *
   * Antigravity 的 ACP 那家只有一个方式，而外层已经给了「添加方式」下拉 ——
   * 不去掉的话会出现两个上下叠着的下拉，用户不知道该动哪个。
   */
  hideMethodPicker?: boolean
}) {
  const prefix = `mobile-add-${provider}`
  const [methods, setMethods] = useState<MethodsState>({ phase: 'loading', methods: [], instructions: '', reason: '' })
  const [selected, setSelected] = useState('')
  const [values, setValues] = useState<Record<string, Record<string, string>>>({})
  const [name, setName] = useState('')
  const [proxyMode, setProxyMode] = useState('direct')
  /** 正在读取网关所在机器的系统代理（点了「填入系统代理」之后） */
  const [readingSystemProxy, setReadingSystemProxy] = useState(false)
  const [systemProxyError, setSystemProxyError] = useState('')
  /** 选中的「已保存的代理」id（网关代理池里的那一条） */
  const [proxyId, setProxyId] = useState('')
  /** 代理池快照；null = 还没读到 */
  const [proxyPool, setProxyPool] = useState<PoolItem[] | null>(null)
  const [proxyPoolError, setProxyPoolError] = useState('')
  /** 手动「重新读取」计数：加一就重新拉一次代理池 */
  const [poolReload, setPoolReload] = useState(0)
  const [protocol, setProtocol] = useState('http')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  const [flow, setFlow] = useState<{ state: string; url: string; manual: boolean; callbackInput: CallbackInput } | null>(null)
  const [hasCallback, setHasCallback] = useState(false)
  const [callbackBusy, setCallbackBusy] = useState(false)
  const [callbackError, setCallbackError] = useState('')
  const [callbackNotice, setCallbackNotice] = useState('')
  const callbackInputRef = useRef<HTMLInputElement>(null)
  const callbackRequest = useRef(false)
  const callbackGeneration = useRef(0)
  const [canceling, setCanceling] = useState(false)
  const flowRef = useRef('')
  const mounted = useRef(false)
  const submitting = useRef(false)
  const identity = serverIdentity()
  const method = methods.methods.find(item => item.id === selected) || methods.methods[0]
  const inputs = method ? values[method.id] || {} : {}
  const hasNamePrompt = Boolean(method?.prompts.some(prompt => prompt.key === 'name'))
  const locked = busy || Boolean(flow) || readingSystemProxy

  function clearCallback(): void {
    if (callbackInputRef.current) callbackInputRef.current.value = ''
    callbackGeneration.current += 1
    callbackRequest.current = false
    if (!mounted.current) return
    setHasCallback(false)
    setCallbackBusy(false)
    setCallbackError('')
    setCallbackNotice('')
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearCallback()
      if (flowRef.current && serverIdentity() === identity) void cancelDynamicLogin(flowRef.current).catch(() => {})
      flowRef.current = ''
    }
  }, [identity])

  useEffect(() => {
    const controller = new AbortController()
    setMethods({ phase: 'loading', methods: [], instructions: '', reason: '' })
    setSelected('')
    setValues({})
    clearCallback()
    setError('')
    void readDynamicMethods(provider, controller.signal).then(result => {
      if (controller.signal.aborted) return
      const parsed = parseMethods(result, provider)
      if (provider === 'deepseek-web') parsed.methods = parsed.methods.filter(method => method.type !== 'oauth')
      setMethods(parsed)
    }).catch(failure => {
      if (controller.signal.aborted) return
      // 501 = 网关没给这家实现动态登录。桌面端对这类家走静态表单，手机端同样回落到
      // 静态表单（字段与提交语义与桌面一致），而不是丢一句"未声明"就结束。
      if (methodsUnavailable(failure) && hasStaticConfig(provider)) {
        onStaticFallback?.()
        return
      }
      const builtin = source === 'builtin' || provider.endsWith('-subscription')
      setMethods({ phase: 'error', methods: [], instructions: '', reason: methodsUnavailable(failure)
        ? builtin ? t('本体订阅未返回动态登录方式（501）；不会猜测导入接口或显示插件手动凭证入口。请更新网关后重试。')
          : t('此提供商未声明动态登录方式，请在网关桌面面板使用其既有入口；手机端不会猜测凭证字段。')
        : dynamicLoginError(failure) })
    })
    return () => controller.abort()
  }, [provider, source])

  useEffect(() => {
    if (!flow) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const state = flow.state
    const poll = async () => {
      if (!live || !mounted.current || flowRef.current !== state || serverIdentity() !== identity) return
      try {
        const reply = await waitDynamicLogin(state)
        if (!live || !mounted.current || flowRef.current !== state || serverIdentity() !== identity) return
        if (reply.error) throw new Error(reply.error)
        if (reply.done === true) {
          if (!reply.session || !(reply.session.accountUid || reply.session.accountId)
            || reply.session.provider && reply.session.provider !== provider) {
            throw new Error(t('登录桥返回了空会话，无法确认账号已添加'))
          }
          flowRef.current = ''
          setFlow(null)
          await finish()
          return
        }
        if (reply.pending !== true) throw new Error(t('登录桥未返回已完成的账号或会话，请重试'))
        setProgress([reply.instructions, reply.hint].filter(Boolean).map(line => loginText(line)).join('\n'))
        timer = setTimeout(() => void poll(), 1000)
      } catch (failure) {
        if (!live || !mounted.current || serverIdentity() !== identity) return
        if (flowRef.current && flowRef.current !== state) return
        flowRef.current = ''
        clearCallback()
        setValues({})
        setPassword('')
        setFlow(null)
        setProgress('')
        setError(dynamicLoginError(failure))
        void cancelDynamicLogin(state).catch(() => {})
      }
    }
    void poll()
    return () => { live = false; if (timer) clearTimeout(timer) }
  }, [flow, identity, provider])

  /**
   * 把网关所在机器的系统代理填进表单。读的是**网关机器**的代理（不是手机的），
   * 因为出网请求由网关发出 —— 手机上的代理设置跟这条链路无关。
   */
  async function importSystemProxy() {
    if (locked || submitting.current) return
    submitting.current = true
    setReadingSystemProxy(true)
    setSystemProxyError('')
    try {
      const proxy = readSystemProxy(await apiCall('/api/proxies/system'), t)
      if (!mounted.current || serverIdentity() !== identity) return
      setProxyMode('custom')
      setProtocol(proxy.protocol)
      setHost(proxy.host)
      setPort(String(proxy.port))
      setUsername(proxy.username)
      setPassword(proxy.password)
    } catch (failure) {
      if (mounted.current && serverIdentity() === identity) setSystemProxyError(dynamicLoginError(failure))
    } finally {
      submitting.current = false
      if (mounted.current && serverIdentity() === identity) setReadingSystemProxy(false)
    }
  }

  // 只有真的选了「已保存的代理」才去读代理池 —— 默认直连的用户不该为此多打一次请求。
  useEffect(() => {
    if (proxyMode !== 'pool') return
    const controller = new AbortController()
    setProxyPoolError('')
    void fetchProxyPool(controller.signal).then(result => {
      if (!controller.signal.aborted && serverIdentity() === identity) setProxyPool(result.items || [])
    }).catch(failure => {
      if (!controller.signal.aborted && serverIdentity() === identity) {
        setProxyPool([])
        setProxyPoolError(dynamicLoginError(failure))
      }
    })
    return () => controller.abort()
  }, [proxyMode, identity, poolReload])

  function proxyPayload(): unknown {
    if (proxyMode === 'direct') return null
    if (proxyMode === 'pool') {
      // 池里那一条自己带着是否启用、解析是否失败 —— 不可用的**当场拦下**，
      // 否则会把一个已知坏的代理存进账号，之后每次请求都失败还查不出原因。
      if (!proxyId) throw new Error(t('请先选择已保存的代理'))
      const selected = proxyPool?.find(item => item.id === proxyId)
      if (!selected || selected.enabled === false || selected.resolveError) {
        throw new Error(t('当前代理不可用，请重新选择'))
      }
      return { source: 'pool', proxyId }
    }
    const number = Number(port)
    if (!host.trim()) throw new Error(t('请填写代理主机地址'))
    if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(t('代理端口必须是 1-65535 的整数'))
    return { source: 'custom', protocol, host: host.trim(), port: number, username: username.trim(), password }
  }

  async function finish(warning = '') {
    clearCallback()
    setValues({})
    setPassword('')
    setProgress('')
    await store.refresh(true)
    if (serverIdentity() !== identity) return
    store.toast(t('{label}账号已添加', { label: t(label) }))
    if (warning) store.toast(warning, 'warn')
    if (store.get().sessionError) store.toast(t('账号已添加，但账号列表同步失败，请刷新重试。'), 'warn')
    if (mounted.current) onAdded()
  }

  async function submit() {
    if (locked || submitting.current || !method || methods.phase !== 'ready') return
    submitting.current = true
    setBusy(true)
    setError('')
    setProgress('')
    clearCallback()
    try {
      const fields = readInputs(method, inputs)
      const proxy = proxyPayload()
      const input = { provider, methodIndex: method.methodIndex!, inputs: fields, proxy }
      if (method.type === 'api') {
        if (method.localOnly) throw new Error(t('插件返回了无效的登录方式，请更新插件或联系作者'))
        const remark = hasNamePrompt ? fields.name : name.trim()
        await finish(await addDynamicApiAccount({ ...input, ...(remark ? { name: remark } : {}) }))
        return
      }
      if (method.type !== 'oauth') throw new Error(t('请先选择有效的 OAuth 登录方式'))
      const started = await startDynamicLogin(input)
      const state = started.state || started.flow
      if (!state || typeof state !== 'string') throw new Error(t('登录桥未返回已完成的账号或会话，请重试'))
      if (!mounted.current || serverIdentity() !== identity) {
        if (serverIdentity() === identity) await cancelDynamicLogin(state)
        return
      }
      const rawUrl = started.authUrl ?? started.url ?? ''
      let callbackInput: CallbackInput
      try {
        callbackInput = parseCallbackInput(started.callbackInput === undefined ? method.callbackInput : started.callbackInput)
        if (started.manualCallback !== undefined && typeof started.manualCallback !== 'boolean') throw new Error()
        if (method.manualCallback && (started.manualCallback === false || callbackInput !== method.callbackInput)) throw new Error()
        if (callbackInput === 'code' && !(started.manualCallback === true || method.manualCallback)) throw new Error()
      } catch {
        await cancelDynamicLogin(state)
        throw new Error(t('网关未返回有效的手动回调输入契约；请更新网关后重新发起。'))
      }
      const manual = started.manualCallback === true || method.manualCallback
      if ((started.provider && started.provider !== provider) || typeof rawUrl !== 'string'
        || (!rawUrl && !(started.localOnly === true || method.localOnly || manual))) {
        await cancelDynamicLogin(state)
        throw new Error(t('登录授权地址无效，已取消本次等待。'))
      }
      if (rawUrl) {
        try { const url = new URL(rawUrl); if (url.protocol !== 'https:' || url.username || url.password) throw new Error() }
        catch { await cancelDynamicLogin(state); throw new Error(t('登录授权地址无效，已取消本次等待。')) }
      }
      flowRef.current = state
      setProgress(loginText(started.instructions))
      setFlow({ state, url: rawUrl, manual, callbackInput })
    } catch (failure) {
      if (mounted.current && serverIdentity() === identity) setError(dynamicLoginError(failure))
    } finally {
      submitting.current = false
      if (mounted.current && serverIdentity() === identity) setBusy(false)
    }
  }

  async function cancel() {
    if (!flow || canceling) return
    const state = flow.state
    clearCallback()
    setValues({})
    setPassword('')
    setCanceling(true)
    try {
      await cancelDynamicLogin(state)
      if (!mounted.current || serverIdentity() !== identity || flowRef.current !== state) return
      flowRef.current = ''
      setFlow(null)
      setProgress('')
      store.toast(t('已取消登录等待'))
    } catch (failure) {
      if (mounted.current && serverIdentity() === identity) setError(dynamicLoginError(failure))
    } finally { if (mounted.current && serverIdentity() === identity) setCanceling(false) }
  }

  async function sendCallback() {
    if (!flow?.manual || callbackRequest.current || canceling || flowRef.current !== flow.state) return
    const raw = callbackInputRef.current?.value || ''
    if (!raw) return
    const state = flow.state
    const generation = callbackGeneration.current
    const isCurrent = () => mounted.current && serverIdentity() === identity && flowRef.current === state
      && callbackGeneration.current === generation
    callbackRequest.current = true
    setCallbackBusy(true)
    setCallbackError('')
    setCallbackNotice('')
    try {
      const next = await submitDynamicCallback(state, raw)
      if (!isCurrent()) return
      if (callbackInputRef.current) callbackInputRef.current.value = ''
      setHasCallback(false)
      if (next.nextUrl) {
        /*
         * 多步授权：这一步只是「还要再去一个授权页」，不是失败。
         *
         * 以前这里直接取消本次等待、让用户改用桌面面板 —— 但移动端本来就打得开
         * 网页，白白把一条能走完的路堵掉了。现在按上游做法**就地换掉授权页地址**
         * 继续等；回填仍然是「完整回调地址」，用户只需再复制一次。
         *
         * 校验不能省：nextUrl 由网关/插件给出，要**当外部输入对待** ——
         * 只允许 https、不许带用户名密码、不许含控制字符或空白，
         * 否则一个 `javascript:` 或带凭证的地址会被我们原样交给 `window.open`。
         */
        let url: URL
        try {
          if (/[\u0000-\u0020\u007f]/.test(next.nextUrl)) throw new Error()
          url = new URL(next.nextUrl)
        } catch {
          await cancelDynamicLogin(state)
          if (!isCurrent()) return
          clearCallback()
          flowRef.current = ''
          setFlow(null)
          setProgress('')
          setError(t('登录授权地址无效，已取消本次等待。'))
          return
        }
        if (url.protocol !== 'https:' || url.username || url.password) {
          await cancelDynamicLogin(state)
          if (!isCurrent()) return
          clearCallback()
          flowRef.current = ''
          setFlow(null)
          setProgress('')
          setError(t('登录授权地址无效，已取消本次等待。'))
          return
        }
        setFlow(current => current?.state === state ? { ...current, url: next.nextUrl! } : current)
        setCallbackNotice(t('还需继续授权，请打开下一步授权页，完成后回填新的完整回调地址。'))
        return
      }
      setCallbackNotice(t('回调已提交，仍需等待网关确认账号登录完成。'))
      // 回调收到不等于完成；账号添加只认 wait 的 done+session。
    } catch (failure) {
      // 网关可能给了具体原因（hint）；有就照它说，没有才用通用提示。
      const hint = (failure as { hint?: unknown })?.hint
      if (isCurrent()) setCallbackError(loginText(hint)
        || t('回调未被接受，请重新复制本次登录的完整回调地址'))
    } finally {
      if (isCurrent()) {
        callbackRequest.current = false
        setCallbackBusy(false)
      }
    }
  }

  return <div className='flex min-w-0 flex-col gap-3'>
    {methods.phase === 'loading' ? <p><Spinner /> {t('正在读取插件登录方式…')}</p> : null}
    {methods.reason ? <Alert variant={methods.phase === 'error' ? 'destructive' : 'warning'}>
      <AlertDescription>{methods.reason}</AlertDescription></Alert> : null}
    {method ? <>
      {hideMethodPicker ? null : <Select value={method.id} disabled={locked} onValueChange={value => {
        setSelected(value || ''); setValues({}); setPassword(''); clearCallback(); setError('')
      }}>
        <SelectTrigger className='w-full' aria-label={t('账号登录方式')}><SelectValue>{methodLabel(method)}</SelectValue></SelectTrigger>
        <SelectContent>{methods.methods.map(item => <SelectItem key={item.id} value={item.id}>{methodLabel(item)}</SelectItem>)}</SelectContent>
      </Select>}
      {method.reason ? <Alert variant='warning'><AlertDescription>{method.reason}</AlertDescription></Alert> : null}
      {[methods.instructions, method.instructions].filter(Boolean).length ? <Alert>
        <AlertTitle>{t('登录指引 / 设备码授权')}</AlertTitle>
        <AlertDescription className='whitespace-pre-wrap break-words'>{[methods.instructions, method.instructions].filter(Boolean).join('\n')}</AlertDescription>
      </Alert> : null}
      {method.localOnly ? <Alert variant='warning'><AlertTitle>{t('需要网关本机环境')}</AlertTitle>
        <AlertDescription>{t('“本机”指运行网关的机器，不是打开面板的电脑。远程浏览器也可以发起，但网关本机可能需要安装客户端并已登录；是否可用由网关返回结果决定。')}</AlertDescription></Alert> : null}
      {method.prompts.map((prompt, index) => {
        if (!promptEnabled(prompt, method, inputs)) return null
        const id = `${prefix}-${index}`
        const value = promptValue(prompt, inputs)
        const change = (value: string) => setValues(previous => ({ ...previous, [method.id]: { ...previous[method.id], [prompt.key]: value } }))
        return <div key={`${method.id}:${prompt.key}`} className='flex flex-col gap-1.5'>
          <Label htmlFor={id}>{prompt.label}{prompt.optional ? t('（可选）') : t('（必填）')}</Label>
          {prompt.type === 'select' ? <Select value={value} disabled={locked} onValueChange={value => change(value || '')}>
            <SelectTrigger id={id} className='w-full'><SelectValue>{prompt.options.find(option => option.value === value)?.label || prompt.placeholder || t('请选择')}</SelectValue></SelectTrigger>
            <SelectContent>{prompt.optional ? <SelectItem value=''>{t('不填写（可选）')}</SelectItem> : null}
              {prompt.options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select> : <Input id={id} value={value} type={prompt.secret ? 'password' : 'text'} disabled={locked} spellCheck={false}
            autoComplete={prompt.secret ? 'new-password' : 'off'} placeholder={prompt.placeholder} onChange={event => change(event.currentTarget.value)} />}
        </div>
      })}
      {method.type === 'api' && !hasNamePrompt ? <Label className='flex flex-col items-start gap-1.5'>{t('备注名')}
        <Input value={name} maxLength={100} disabled={locked} onChange={event => setName(event.currentTarget.value)} placeholder={t('可选，留空使用账号昵称')} />
      </Label> : method.type === 'oauth' && !hasNamePrompt ? <p className='text-xs text-subtle'>{t('账号名由插件自动获取，添加后可修改。')}</p> : null}
      <Label>{t('账号 / 登录出网代理')}</Label>
      <Select value={proxyMode} disabled={locked} onValueChange={value => setProxyMode(value || 'direct')}>
        <SelectTrigger className='w-full'><SelectValue>{proxyMode === 'pool' ? t('已保存的代理') : proxyMode === 'custom' ? t('自定义') : t('无代理（直连）')}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value='direct'>{t('无代理（直连）')}</SelectItem><SelectItem value='pool'>{t('已保存的代理')}</SelectItem><SelectItem value='custom'>{t('自定义')}</SelectItem></SelectContent>
      </Select>
      <Button size='sm' variant='outline' disabled={locked} className='self-start'
        onClick={() => void importSystemProxy()}>
        {readingSystemProxy ? <Spinner /> : null}{t('填入系统代理')}
      </Button>
      <p className='text-xs text-subtle'>{t('读取网关电脑当前的 HTTPS 系统代理，填入自定义地址；后续系统设置变化不会自动同步。')}</p>
      {systemProxyError ? <p className='text-xs text-destructive' role='alert'>{systemProxyError}</p> : null}
      {proxyMode === 'pool' ? <div className='flex flex-col gap-2'>
        <Select value={proxyId} disabled={locked || !proxyPool?.length} onValueChange={value => setProxyId(value || '')}>
          <SelectTrigger className='w-full' aria-label={t('代理')}><SelectValue>{proxyPool?.find(item => item.id === proxyId)?.name
            || (proxyId ? t('当前代理不可用，请重新选择') : proxyPool === null ? t('正在读取…') : t('请选择代理'))}</SelectValue></SelectTrigger>
          <SelectContent>{(proxyPool || []).map(item => <SelectItem key={item.id} value={item.id}
            disabled={item.enabled === false || Boolean(item.resolveError)}>{item.name}</SelectItem>)}</SelectContent>
        </Select>
        {proxyPoolError ? <p className='text-xs text-destructive'>{proxyPoolError}</p>
          : proxyPool?.length === 0 ? <p className='text-xs text-subtle'>{t('还没有保存的代理')}</p> : null}
        <Button size='sm' variant='outline' disabled={locked} className='self-start'
          onClick={() => setPoolReload(value => value + 1)}>{t('重新读取')}</Button>
      </div> : null}
      {proxyMode === 'custom' ? <Card className='flex flex-col gap-2 p-3'>
        <Select value={protocol} disabled={locked} onValueChange={value => setProtocol(value || 'http')}>
          <SelectTrigger className='w-full' aria-label={t('协议')}><SelectValue>{protocol === 'socks5' ? 'SOCKS5' : 'HTTP'}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value='http'>HTTP</SelectItem><SelectItem value='socks5'>SOCKS5</SelectItem></SelectContent>
        </Select>
        <Label className='flex flex-col items-start gap-1'>{t('主机')}<Input value={host} disabled={locked} onChange={event => setHost(event.currentTarget.value)} /></Label>
        <Label className='flex flex-col items-start gap-1'>{t('端口')}<Input value={port} type='number' min={1} max={65535} disabled={locked} onChange={event => setPort(event.currentTarget.value)} /></Label>
        <Label className='flex flex-col items-start gap-1'>{t('用户名')}<Input value={username} disabled={locked} autoComplete='off' onChange={event => setUsername(event.currentTarget.value)} /></Label>
        <Label className='flex flex-col items-start gap-1'>{t('密码')}<Input value={password} type='password' disabled={locked} autoComplete='new-password' onChange={event => setPassword(event.currentTarget.value)} /></Label>
      </Card> : null}
      <Button disabled={locked || Boolean(method.reason)} onClick={() => void submit()}>{busy ? <Spinner /> : null}{method.type === 'api' ? t('添加账号') : t('登录并添加')}</Button>
      {method.type === 'api' ? <p className='text-xs text-subtle'>{t('新网关确认代理同次保存后不再重复提交；旧网关使用兼容保存并提示核查，失败不会撤销已添加的账号。')}</p> : null}
      <p className='text-xs text-subtle'>{t('所选代理会保存到账号设置，后续请求继续使用。')}</p>
    </> : null}
    {/* 插件驱动的登录交互（验证码 / 二次确认等），由共享组件按 flow 状态渲染 */}
    {flow?.state ? <PluginLoginInteraction key={flow.state} flow={flow.state} t={t}
      request={(method, path, body) => apiCall(path, { method, body })} /> : null}
    {flow ? <Alert><AlertTitle>{t('等待账号登录完成…')}</AlertTitle>
      <AlertDescription className='flex flex-col gap-2 whitespace-pre-wrap break-words'>
        {progress}
        {flow.url ? <Button variant='outline' onClick={() => window.open(flow.url, '_blank', 'noopener,noreferrer')}>{t('打开官方授权页')}</Button> : null}
        {flow.manual ? <>
          <Badge variant='outline'>{t('需要手动提交授权回调')}</Badge>
          <p>{flow.callbackInput === 'code'
            ? t('此方式需要原样提交授权码或令牌；输入会隐藏，不会当作 URL 或 API 凭证解析。提交后仍需等待网关确认。')
            : t('此方式需要完整回调地址；请原样粘贴，不拆分参数或重建地址。提交后仍需等待网关确认。')}</p>
          <Label htmlFor={`${prefix}-callback`}>{flow.callbackInput === 'code'
            ? t('授权码或令牌（原样提交）') : t('完整回调地址（原样提交）')}</Label>
          <Input key={`${flow.state}:${flow.callbackInput}`} id={`${prefix}-callback`} ref={callbackInputRef}
            type={flow.callbackInput === 'code' ? 'password' : 'text'} defaultValue=''
            autoComplete={flow.callbackInput === 'code' ? 'new-password' : 'off'} spellCheck={false} autoCapitalize='none'
            placeholder={flow.callbackInput === 'code' ? t('授权码或令牌（原样提交）') : t('完整回调地址（原样提交）')}
            onChange={event => { setHasCallback(event.currentTarget.value.length > 0); setCallbackError(''); setCallbackNotice('') }}
            disabled={callbackBusy || canceling} />
          <Button variant='outline' disabled={!hasCallback || callbackBusy || canceling} onClick={() => void sendCallback()}>
            {callbackBusy ? <Spinner /> : null}{t('提交授权回调')}</Button>
          {callbackNotice ? <p role='status'>{callbackNotice}</p> : null}
          {callbackError ? <Alert variant='destructive'><AlertDescription>{callbackError}</AlertDescription></Alert> : null}
        </> : <p>{t('如官方页面跳回的是网关本机地址，请在桌面面板完成回调；手机端不会猜测未声明的回调输入。')}</p>}
        <Button variant='outline' disabled={canceling} onClick={() => void cancel()}>{t('取消等待')}</Button>
      </AlertDescription>
    </Alert> : null}
    {error ? <Alert variant='destructive'><AlertDescription className='break-words'>{error}</AlertDescription></Alert> : null}
  </div>
}
