import * as React from 'react'
import { Card, Progress } from '@ui'
import type { ScriptOperation, ScriptPackage, ScriptRecommendation } from './plugins'
import { PluginArtwork, type PluginTranslate } from './plugins-store'
import { reinstallSource } from './plugins-script-display'

/// 操作是否指向这张卡片。**不要求操作仍在进行** —— 用来把"刚刚失败"的原因
/// 留在用户点过的那张卡片上：进度条是随操作结束一起消失的，只留页面顶部一条提示的话，
/// 用户看到的就是"点了一下，进度闪一下就没了，什么也没说"。
export function scriptOperationTargets(operation: ScriptOperation, item: ScriptPackage | ScriptRecommendation): boolean {
  const target = operation.target
  if (!target) return false
  if (target.id && 'id' in item) return target.id === item.id
  const source = 'id' in item ? reinstallSource(item) : item.source || item.name
  if (target.source) return target.source.toLowerCase() === source.toLowerCase()
  return target.name === item.name
}

export function scriptOperationMatches(operation: ScriptOperation, item: ScriptPackage | ScriptRecommendation): boolean {
  return operation.active === true && scriptOperationTargets(operation, item)
}

/// 多少秒没动静就在界面上提示（客户端兜底，秒）。
/// 网关侧另有"任务卡死判定"，但那要网关先给出新的心跳/时间戳；
/// 旧版网关卡在下载里时，只有这里能让界面说出"已经 N 秒没有进展"，
/// 而不是留一条永远不动的进度条让人以为"点了没反应"。
const STALL_HINT_SECONDS = 20

export function ScriptOperationProgress({ operation, t }: { operation: ScriptOperation; t: PluginTranslate }) {
  // 用"阶段 + 已下载字节"当进展指纹：只要它在变就重新计时。
  const mark = `${operation.stage || ''}:${operation.received || 0}`
  const seen = React.useRef({ mark, at: Date.now() })
  const [stuck, setStuck] = React.useState(0)
  React.useEffect(() => {
    seen.current = { mark, at: Date.now() }
    setStuck(0)
  }, [mark])
  React.useEffect(() => {
    if (!operation.active) return
    const timer = window.setInterval(() => {
      setStuck(Math.floor((Date.now() - seen.current.at) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [operation.active, mark])
  if (!operation.active) return null
  const stage = operation.stage === 'runtime' ? t('正在下载 Bun 运行时')
    : operation.stage === 'package' ? t('正在下载脚本插件')
    : operation.stage === 'waiting' ? t('等待脚本插件的在途请求和登录完成')
    : operation.stage === 'restoring' ? t('正在恢复原有脚本插件')
    : t('正在加载脚本插件')
  return <div className='space-y-2 border-t border-hairline pt-3' aria-live='polite'>
    <div className='flex flex-wrap items-center justify-between gap-2 text-xs'>
      <span className='text-subtle'>{stage}</span>
      <span className='tabular-nums text-muted-foreground'>
        {stuck >= STALL_HINT_SECONDS ? `${t('已 {seconds} 秒没有进展', { seconds: stuck })} · ` : ''}
        {(operation.received || 0) > 0 ? `${((operation.received || 0) / 1024 / 1024).toFixed(1)} MiB` : ''}
      </span>
    </div>
    {/* 网关自己写的阶段文案（例如"正在下载 Magpie 社区脚本插件（gh-proxy 反代）"）：
        以前完全不显示 —— 于是"卡住"时界面上只有一条不动的进度条，看不出卡在哪一步。 */}
    {operation.message ? <p className='m-0 break-words text-xs text-muted-foreground'>{operation.message}</p> : null}
    <Progress value={null} aria-label={stage} />
  </div>
}

export function ScriptOperationCard({ operation, t }: { operation: ScriptOperation; t: PluginTranslate }) {
  const name = operation.target?.name || operation.target?.source || t('Magpie 插件')
  return <Card render={<article />} data-plugin-card='' aria-label={name} className='flex h-full flex-col gap-3 p-4'>
    <div className='flex items-start gap-3.5'>
      <PluginArtwork kind='script' />
      <div className='min-w-0 flex-1'>
        <h3 className='m-0 break-words text-[14px] font-semibold leading-5'>{name}</h3>
        {operation.target?.source && operation.target.source !== name ? <p className='m-0 mt-1.5 break-all text-xs text-muted-foreground'>
          {operation.target.source}
        </p> : null}
      </div>
    </div>
    <ScriptOperationProgress operation={operation} t={t} />
  </Card>
}
