import { useEffect, useState } from 'react'
import { Button, Input, Label, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Switch, Textarea } from '@ui'
import { Icon } from './Icon'
import { ASSISTANT_TOOLS } from '../lib/assistantTools'
import type { AssistantConfig } from '../api/assistant'
import { t } from '../i18n'

/**
 * 助手设置（手机版）。
 *
 * ── 为什么要有这一页 ──────────────────────────────────────────
 * 桌面端把「默认行为 / 系统提示词 / 工具」三块放在对话页右上角的设置抽屉里，
 * 理由是这三件事都是「聊着聊着就想改」（换档位、加个工具、改一句提示词），
 * 搬离对话页会打断会话。手机端原来只有模型选择、Key 选择、标题设置、历史 ——
 * 契约 `AssistantConfig` 的九个字段里，`reasoning` / `mode` /
 * `systemPromptEnabled` / `systemPrompt` / `tools` **五项没有入口**。
 * 这一页就是把这五项补齐，落点同样在对话页里（底部面板）。
 *
 * ── 保存语义与桌面端一致 ─────────────────────────────────────
 * **改动即时保存**，没有「保存」按钮；只有系统提示词的正文在弹层里编辑，
 * 弹层自带取消 / 保存。每次保存后把服务端回读的配置交给调用方，输入区那枚
 * 胶囊（模型 / 档位）读的是同一份，所以改完立刻反映。
 *
 * ── 思考等级的取值 ──────────────────────────────────────────
 * 与后端 `model_rules::REASONING_LEVELS` **逐字一致**（弱 → 强），
 * `null` = 「跟随模型」（不指定，交给映射绑定）。桌面的注释里也写明这组档位
 * 只在两处写死（后端 + 前端这一份），加档位时一起改。
 */
const REASONING_LEVELS = ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** 档位展示：内部存小写，界面首字母大写（与桌面端同一处理） */
function levelLabel(level: string): string {
  return level ? level.charAt(0).toUpperCase() + level.slice(1) : ''
}

function modeLabel(mode: 'confirm' | 'full'): string {
  return mode === 'full' ? t('完全访问') : t('变更前确认')
}

function kindLabel(kind: string): string {
  if (kind === 'read') return t('只读 · 不会改动配置')
  if (kind === 'run') return t('执行 · 会真的去试')
  return t('改动 · 默认需要确认')
}

export function AssistantSettingsSheet({ open, onOpenChange, config, busy, onSave, modelLabel, keyLabel, onOpenModel, onOpenKey }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: AssistantConfig | null
  busy?: boolean
  onSave: (next: AssistantConfig, message: string) => Promise<void>
  /** 当前对话模型（只用于展示；点这一行会打开页面上已有的模型选择器） */
  modelLabel?: string
  /** 当前 API Key（同上，点这一行打开 Key 选择器） */
  keyLabel?: string
  onOpenModel?: () => void
  onOpenKey?: () => void
}) {
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptDraft, setPromptDraft] = useState(config?.systemPrompt || '')
  const [saving, setSaving] = useState(false)

  // 打开弹层或配置变化时同步草稿（别让草稿停在旧值上）
  useEffect(() => {
    if (promptOpen) setPromptDraft(config?.systemPrompt || '')
  }, [promptOpen, config?.systemPrompt])

  const tools = config?.tools || {}
  const enabledCount = ASSISTANT_TOOLS.filter(tool => tools[tool.id]).length
  const patch = async (changes: Partial<AssistantConfig>, message: string) => {
    if (!config) return
    await onSave({ ...config, ...changes }, message)
  }

  const row = (label: string, hint: string, on: boolean, value: string, onSelect: () => void) => (
    <Button key={value} size='default' variant='ghost' type='button'
      className='m-row h-auto min-h-[48px] w-full justify-start rounded-none border-0 px-3.5 py-2.5 text-left'
      disabled={Boolean(busy)}
      aria-pressed={on}
      onClick={onSelect}>
      <span className='m-logo'><Icon name={on ? 'check' : 'chev'} /></span>
      <div className='m-grow'>
        <div className='m-t1'>{label}</div>
        {hint ? <div className='m-t2'>{hint}</div> : null}
      </div>
    </Button>
  )

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent showCloseButton>
          <SheetHeader><SheetTitle>{t('助手设置')}</SheetTitle></SheetHeader>
          <SheetBody>
            {/*
              「默认行为」最上面两条（对接桌面抽屉的同一块）：模型与 API Key。
              手机端这两件事本来就有各自的弹层（输入区的模型选择器 / Key 选择器），
              所以这里**不再做第二套**，而是把入口收进来 —— 用户对照桌面端时不会
              觉得"少了两项"，也不必先回到输入区才能改。
            */}
            <div className='m-sec'>{t('默认行为')}</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <Button size='default' variant='ghost' type='button'
                className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left'
                disabled={Boolean(busy)}
                onClick={() => { onOpenKey?.() }}>
                <span className='m-logo'><Icon name='key' /></span>
                <div className='m-grow' style={{ minWidth: 0 }}>
                  <div className='m-t1'>{t('API Key')}</div>
                  <div className='m-t2' style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {keyLabel || t('选择 API Key…')}
                  </div>
                </div>
                <span className='m-chev'><Icon name='chev' /></span>
              </Button>
              <Button size='default' variant='ghost' type='button'
                className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left'
                disabled={Boolean(busy)}
                onClick={() => { onOpenModel?.() }}>
                <span className='m-logo'><Icon name='model' /></span>
                <div className='m-grow' style={{ minWidth: 0 }}>
                  <div className='m-t1'>{t('模型')}</div>
                  <div className='m-t2' style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {modelLabel || t('选择对话模型')}
                  </div>
                </div>
                <span className='m-chev'><Icon name='chev' /></span>
              </Button>
            </div>

            {/* ── 思考等级 ── */}
            <div className='m-sec'>{t('思考等级')}</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {row(t('跟随模型'), t('不指定，交给映射绑定'), !config?.reasoning, '__follow', () => {
                void patch({ reasoning: null }, t('思考等级已切换'))
              })}
              {REASONING_LEVELS.map(level => row(levelLabel(level), '', config?.reasoning === level, level, () => {
                void patch({ reasoning: level }, t('思考等级已切换'))
              }))}
            </div>

            {/* ── 权限模式 ── */}
            <div className='m-sec'>{t('权限模式')}</div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {row(modeLabel('confirm'), t('改动先列清单'), config?.mode !== 'full', 'confirm', () => {
                void patch({ mode: 'confirm' }, t('已切换到变更前确认'))
              })}
              {row(modeLabel('full'), t('改动直接执行'), config?.mode === 'full', 'full', () => {
                void patch({ mode: 'full' }, t('已切换到完全访问'))
              })}
            </div>

            {/* ── 系统提示词 ── */}
            <div className='m-sec'>{t('系统提示词')}</div>
            <div className='m-row' style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px' }}>
              <div className='m-grow'>
                <div className='m-t1'>{t('注入系统提示词')}</div>
                <div className='m-t2'>{t('作为 system 消息注入，会话里的选择优先于这里的默认值')}</div>
              </div>
              <Switch checked={config?.systemPromptEnabled === true} aria-label={t('注入系统提示词')}
                disabled={Boolean(busy)}
                onCheckedChange={value => {
                  void patch({ systemPromptEnabled: value === true },
                    value === true ? t('系统提示词已开启') : t('系统提示词已关闭'))
                }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {row(t('编辑系统提示词'),
                config?.systemPrompt ? t('当前：已填写 {n} 字', { n: config.systemPrompt.length }) : t('当前：使用内置默认提示词'),
                false, '__edit', () => setPromptOpen(true))}
            </div>

            {/* ── 工具 ── */}
            <div className='m-sec'>{t('工具')}</div>
            <div style={{ display: 'flex', gap: 8, padding: '0 14px 8px' }}>
              <Button variant='outline' size='sm' disabled={Boolean(busy)}
                onClick={() => {
                  const all: Record<string, boolean> = {}
                  for (const tool of ASSISTANT_TOOLS) all[tool.id] = true
                  void patch({ tools: all }, t('已全部勾选'))
                }}>{t('全选')}</Button>
              <Button variant='outline' size='sm' disabled={Boolean(busy)}
                onClick={() => {
                  const none: Record<string, boolean> = {}
                  for (const tool of ASSISTANT_TOOLS) none[tool.id] = false
                  void patch({ tools: none }, t('已全部取消勾选'))
                }}>{t('全不选')}</Button>
              <span style={{ fontSize: 11.5, color: 'var(--m-text-3)', alignSelf: 'center' }}>
                {t('已勾选 {n} / {total}', { n: enabledCount, total: ASSISTANT_TOOLS.length })}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {ASSISTANT_TOOLS.map(tool => (
                <div key={tool.id} className='m-row' style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px' }}>
                  <div className='m-grow' style={{ minWidth: 0 }}>
                    <div className='m-t1'>{tool.label}</div>
                    <div className='m-t2'>{kindLabel(tool.kind)}</div>
                  </div>
                  <Switch checked={tools[tool.id] === true} aria-label={tool.label}
                    disabled={Boolean(busy)}
                    onCheckedChange={value => {
                      void patch({ tools: { ...tools, [tool.id]: value === true } },
                        value === true ? t('已加入工具') : t('已移除工具'))
                    }} />
                </div>
              ))}
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, padding: '8px 14px 0' }}>
              {t('勾选即注入：只有勾上的工具会随请求发给模型。改动类工具默认需要你确认。')}
            </p>
          </SheetBody>
          <SheetFooter>
            <Button variant='outline' onClick={() => onOpenChange(false)}>{t('完成')}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* 系统提示词正文：单独一层弹层（自带取消 / 保存，与桌面端一致） */}
      <Sheet open={promptOpen} onOpenChange={value => { if (!saving) setPromptOpen(value) }}>
        <SheetContent showCloseButton={!saving}>
          <SheetHeader><SheetTitle>{t('编辑系统提示词')}</SheetTitle></SheetHeader>
          <SheetBody>
            <Label htmlFor='asst-system-prompt'>{t('系统提示词')}</Label>
            <Textarea id='asst-system-prompt' rows={10} value={promptDraft} disabled={saving}
              placeholder={t('留空 = 回到内置默认提示词（与「恢复默认」等价）。')}
              onChange={event => setPromptDraft(event.currentTarget.value)} />
            <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, marginTop: 8 }}>
              {t('这段文字会作为 system 消息注入对话；留空则使用内置默认。')}
            </p>
          </SheetBody>
          <SheetFooter>
            <Button variant='outline' disabled={saving} onClick={() => setPromptDraft('')}>{t('恢复默认')}</Button>
            <Button disabled={saving} onClick={() => {
              void (async () => {
                setSaving(true)
                try {
                  await patch({ systemPrompt: promptDraft }, t('系统提示词已保存'))
                  setPromptOpen(false)
                } finally {
                  setSaving(false)
                }
              })()
            }}>{saving ? t('保存中…') : t('保存')}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
