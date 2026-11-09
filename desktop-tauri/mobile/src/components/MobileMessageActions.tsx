import { useEffect, useState } from 'react'
import { Button, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Textarea, confirmDialog } from '@ui'
import { copyWithToast } from './ui'
import { Icon } from './Icon'
import { t } from '../i18n'

/**
 * 消息级操作（手机版）。
 *
 * ── 为什么手机端要单独做一份，而不是直接用共享的 `ui-shared/assistant-message-actions`
 * 共享组件是**按桌面端做的**：三个 15px 的纯图标小按钮（`size='icon-sm'`、无文字、
 * 只有 `title` 提示）常驻在每条消息下面。桌面有 hover，鼠标也点得准；手机上：
 *   · **触屏没有 hover** → `title` 永远不显示，三个图标只能靠猜；
 *   · 点击区约 28px，低于触屏习惯的 44px，容易点错（编辑和删除还挨着）；
 *   · 每条消息都挂着三个图标，一屏里全是重复的按钮，聊天内容被挤。
 * 所以这里改成：**一个「⋯」入口 + 底部动作面板**（每一项都有文字、整行可点），
 * 编辑也改到底部面板里（`Dialog` 的居中小窗 + 10 行文本域在手机上不好用）。
 *
 * ── 语义与共享组件**完全一致**（不另立一套行为）────────────────
 *   · 编辑：把这条消息的内容换掉（由调用方负责重建列表并持久化）；
 *   · 删除：先确认「关联的工具结果也会一并删除」，再交给调用方；
 *   · 分叉：从这条消息分出新对话（调用方负责先持久化当前会话）；
 *   · 复制：把消息正文拷到剪贴板（手机端常用，共享组件放在桌面侧没做）。
 */
export function MobileMessageActions({ text, disabled, onEdit, onDelete, onFork }: {
  text: string
  disabled?: boolean
  onEdit: (text: string) => void | Promise<void>
  onDelete: () => void | Promise<void>
  onFork?: () => void | Promise<void>
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [draft, setDraft] = useState(text)
  const [saving, setSaving] = useState(false)

  // 编辑面板打开时，草稿要取**当前**正文（消息可能在流式里被更新过）
  useEffect(() => {
    if (editOpen) setDraft(text)
  }, [editOpen, text])

  const row = (label: string, icon: Parameters<typeof Icon>[0]['name'], onSelect: () => void, danger = false) => (
    <Button size='default' variant='ghost' type='button'
      className='m-row h-auto min-h-[52px] w-full justify-start rounded-none border-0 px-3.5 py-3 text-left'
      style={danger ? { color: 'var(--m-danger)' } : undefined}
      disabled={Boolean(disabled)}
      onClick={onSelect}>
      <span className='m-logo'><Icon name={icon} /></span>
      <div className='m-grow'><div className='m-t1'>{label}</div></div>
      <span className='m-chev'><Icon name='chev' /></span>
    </Button>
  )

  return <>
    <Button size='sm' variant='ghost' type='button' disabled={Boolean(disabled)}
      aria-label={t('消息操作')} title={t('消息操作')}
      onClick={() => setMenuOpen(true)}>
      {/* 不引新图标：一个省略号就够，且不会和别处的图标混淆 */}
      <span style={{ fontSize: 16, lineHeight: 1 }}>⋯</span>
    </Button>

    <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
      <SheetContent showCloseButton>
        <SheetHeader><SheetTitle>{t('消息操作')}</SheetTitle></SheetHeader>
        <SheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 8 }}>
            {row(t('复制正文'), 'copy', () => { setMenuOpen(false); void copyWithToast(text, t('消息')) })}
            {row(t('编辑'), 'edit', () => { setMenuOpen(false); setEditOpen(true) })}
            {onFork ? row(t('从这条分叉'), 'share', () => { setMenuOpen(false); void onFork() }) : null}
            {row(t('删除'), 'trash', () => {
              setMenuOpen(false)
              void (async () => {
                if (await confirmDialog(t('删除这条消息？模型消息关联的工具结果也会一并删除。'), { title: t('删除消息') })) {
                  await onDelete()
                }
              })()
            }, true)}
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>

    <Sheet open={editOpen} onOpenChange={value => { if (!saving) setEditOpen(value) }}>
      <SheetContent showCloseButton={!saving}>
        <SheetHeader><SheetTitle>{t('编辑消息')}</SheetTitle></SheetHeader>
        <SheetBody>
          <Textarea rows={8} value={draft} disabled={saving}
            aria-label={t('编辑消息')} style={{ fontSize: 14, lineHeight: 1.6 }}
            onChange={event => setDraft(event.currentTarget.value)} />
          <p className='m-ck-note' style={{ marginTop: 8 }}>
            {t('只改这条消息的内容；它之后的消息保持不变。')}
          </p>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={saving} onClick={() => setEditOpen(false)}>{t('取消')}</Button>
          <Button disabled={saving} onClick={() => {
            void (async () => {
              setSaving(true)
              try {
                await onEdit(draft)
                setEditOpen(false)
              } finally {
                setSaving(false)
              }
            })()
          }}>{saving ? t('保存中…') : t('保存')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  </>
}
