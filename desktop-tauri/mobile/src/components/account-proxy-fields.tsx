/**
 * 账号级出网代理表单：自定义提供商与动态登录两处共用。
 *
 * 这里配的是**网关那台机器**的出网线路（请求由网关发出），与手机自身的代理无关；
 * 「填入系统代理」读的也是网关所在机器的系统代理。
 *
 * 用法：`const proxy = useAccountProxy({ locked })`；
 * 提交时 `proxy.payload()`（代理不可用会抛错，调用方负责显示），
 * 表单块渲染 `{proxy.node}`，切换登录方式 / 提交完成后 `proxy.reset()`。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, Card, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Spinner,
} from '@ui'
import { fetchProxyPool, type PoolItem } from '../api/gateway'
import { readSystemProxy } from '../../../ui-shared/proxy-system'
import { apiCall } from '../api/client'
import { serverIdentity } from '../lib/servers'
import { t } from '../i18n'

/** POST 体里的 `proxy` 字段（形态与后端 workbuddy-proxy.mjs 一致） */
export type AccountProxyPayload =
  | null
  | { source: 'pool'; proxyId: string }
  | { source: 'custom'; protocol: string; host: string; port: number; username: string; password: string }

export type AccountProxyHandle = {
  /** 组装 `proxy`；选用不可用代理或地址不合法时**抛错**（调用方负责显示） */
  payload: () => AccountProxyPayload
  /** 表单块（档位选择 + 「填入系统代理」+ 池选择 / 自定义地址） */
  node: ReactNode
  /** 正在读网关机器的系统代理（调用方可并入"锁定界面"的判断） */
  reading: boolean
  /** 清空自定义地址里的密码（提交完成或换登录方式时调用） */
  reset: () => void
}

export function useAccountProxy({ locked, label, formatError }: {
  /** 界面锁定（提交中 / 等待登录）：锁定时不接受改动，也不允许读系统代理 */
  locked: boolean
  /** 标题文案，默认「出网代理（可选）」 */
  label?: string
  /** 错误文案，默认取 `Error.message` */
  formatError?: (failure: unknown) => string
}): AccountProxyHandle {
  const [mode, setMode] = useState('direct')
  const [reading, setReading] = useState(false)
  const [systemError, setSystemError] = useState('')
  /** 选中的「已保存的代理」id（网关代理池里的那一条） */
  const [poolId, setPoolId] = useState('')
  /** 代理池快照；null = 还没读到 */
  const [pool, setPool] = useState<PoolItem[] | null>(null)
  const [poolError, setPoolError] = useState('')
  /** 手动「重新读取」计数：加一就重新拉一次代理池 */
  const [reload, setReload] = useState(0)
  const [protocol, setProtocol] = useState('http')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const mounted = useRef(false)
  const identity = serverIdentity()
  const text = formatError || ((failure: unknown) => (failure instanceof Error ? failure.message : String(failure)))

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  /**
   * 把网关所在机器的系统代理填进表单。读的是**网关机器**的代理（不是手机的），
   * 因为出网请求由网关发出 —— 手机上的代理设置跟这条链路无关。
   */
  async function importSystemProxy() {
    if (locked || reading) return
    setReading(true)
    setSystemError('')
    try {
      const found = readSystemProxy(await apiCall('/api/proxies/system'), t)
      if (!mounted.current || serverIdentity() !== identity) return
      setMode('custom')
      setProtocol(found.protocol)
      setHost(found.host)
      setPort(String(found.port))
      setUsername(found.username)
      setPassword(found.password)
    } catch (failure) {
      if (mounted.current && serverIdentity() === identity) setSystemError(text(failure))
    } finally {
      if (mounted.current && serverIdentity() === identity) setReading(false)
    }
  }

  // 只有真的选了「已保存的代理」才去读代理池 —— 默认直连的用户不该为此多打一次请求。
  useEffect(() => {
    if (mode !== 'pool') return
    const controller = new AbortController()
    setPoolError('')
    void fetchProxyPool(controller.signal).then(result => {
      if (!controller.signal.aborted && serverIdentity() === identity) setPool(result.items || [])
    }).catch(failure => {
      if (!controller.signal.aborted && serverIdentity() === identity) {
        setPool([])
        setPoolError(text(failure))
      }
    })
    return () => controller.abort()
  }, [mode, identity, reload])

  function payload(): AccountProxyPayload {
    if (mode === 'direct') return null
    if (mode === 'pool') {
      // 池里那一条自己带着是否启用、解析是否失败 —— 不可用的**当场拦下**，
      // 否则会把一个已知坏的代理存进账号，之后每次请求都失败还查不出原因。
      if (!poolId) throw new Error(t('请先选择已保存的代理'))
      const selected = pool?.find(item => item.id === poolId)
      if (!selected || selected.enabled === false || selected.resolveError) {
        throw new Error(t('当前代理不可用，请重新选择'))
      }
      return { source: 'pool', proxyId: poolId }
    }
    const number = Number(port)
    if (!host.trim()) throw new Error(t('请填写代理主机地址'))
    if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error(t('代理端口必须是 1-65535 的整数'))
    return { source: 'custom', protocol, host: host.trim(), port: number, username: username.trim(), password }
  }

  const node = <>
    <Label>{label || t('出网代理（可选）')}</Label>
    <Select value={mode} disabled={locked} onValueChange={value => setMode(value || 'direct')}>
      <SelectTrigger className='w-full'><SelectValue>{mode === 'pool' ? t('已保存的代理') : mode === 'custom' ? t('自定义') : t('无代理（直连）')}</SelectValue></SelectTrigger>
      <SelectContent><SelectItem value='direct'>{t('无代理（直连）')}</SelectItem><SelectItem value='pool'>{t('已保存的代理')}</SelectItem><SelectItem value='custom'>{t('自定义')}</SelectItem></SelectContent>
    </Select>
    <Button size='sm' variant='outline' disabled={locked} className='self-start'
      onClick={() => void importSystemProxy()}>
      {reading ? <Spinner /> : null}{t('填入系统代理')}
    </Button>
    <p className='text-xs text-subtle'>{t('读取网关电脑当前的 HTTPS 系统代理，填入自定义地址；后续系统设置变化不会自动同步。')}</p>
    {systemError ? <p className='text-xs text-destructive' role='alert'>{systemError}</p> : null}
    {mode === 'pool' ? <div className='flex flex-col gap-2'>
      <Select value={poolId} disabled={locked || !pool?.length} onValueChange={value => setPoolId(value || '')}>
        <SelectTrigger className='w-full' aria-label={t('代理')}><SelectValue>{pool?.find(item => item.id === poolId)?.name
          || (poolId ? t('当前代理不可用，请重新选择') : pool === null ? t('正在读取…') : t('请选择代理'))}</SelectValue></SelectTrigger>
        <SelectContent>{(pool || []).map(item => <SelectItem key={item.id} value={item.id}
          disabled={item.enabled === false || Boolean(item.resolveError)}>{item.name}</SelectItem>)}</SelectContent>
      </Select>
      {poolError ? <p className='text-xs text-destructive'>{poolError}</p>
        : pool?.length === 0 ? <p className='text-xs text-subtle'>{t('还没有保存的代理')}</p> : null}
      <Button size='sm' variant='outline' disabled={locked} className='self-start'
        onClick={() => setReload(value => value + 1)}>{t('重新读取')}</Button>
    </div> : null}
    {mode === 'custom' ? <Card className='flex flex-col gap-2 p-3'>
      <Select value={protocol} disabled={locked} onValueChange={value => setProtocol(value || 'http')}>
        <SelectTrigger className='w-full' aria-label={t('协议')}><SelectValue>{protocol === 'socks5' ? 'SOCKS5' : 'HTTP'}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value='http'>HTTP</SelectItem><SelectItem value='socks5'>SOCKS5</SelectItem></SelectContent>
      </Select>
      <Label className='flex flex-col items-start gap-1'>{t('主机')}<Input value={host} disabled={locked} onChange={event => setHost(event.currentTarget.value)} /></Label>
      <Label className='flex flex-col items-start gap-1'>{t('端口')}<Input value={port} type='number' min={1} max={65535} disabled={locked} onChange={event => setPort(event.currentTarget.value)} /></Label>
      <Label className='flex flex-col items-start gap-1'>{t('用户名')}<Input value={username} disabled={locked} autoComplete='off' onChange={event => setUsername(event.currentTarget.value)} /></Label>
      <Label className='flex flex-col items-start gap-1'>{t('密码')}<Input value={password} type='password' disabled={locked} autoComplete='new-password' onChange={event => setPassword(event.currentTarget.value)} /></Label>
    </Card> : null}
    <p className='text-xs text-subtle'>{t('所选代理会保存到账号设置，后续请求继续使用。')}</p>
  </>

  return { payload, node, reading, reset: () => setPassword('') }
}
