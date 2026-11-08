import { useState } from 'react'
import { Button } from '@ui'
import { copyText } from './ui'
import { t } from '../i18n'

/**
 * 一段正文的展示块（报文 / 正文两类面板共用）。
 *
 * 两件事值得写下来：
 *  ① **显示截断、复制给全文**：WebView 渲染几万个字符会明显卡顿，而「要完整内容」
 *     的场景是贴给别人看，不是屏上读。所以只渲染前 `PREVIEW_LIMIT` 个字符，
 *     全文留在内存里给「复制全文」。
 *  ② **复制走 `copyText`**（`components/ui`，带 execCommand 兜底）—— 手机上的
 *     WebView 在非安全上下文下没有 `navigator.clipboard`。
 */
export const PREVIEW_LIMIT = 6000

export function TextBlock({ label, text, note }: { label: string; text: string; note?: string }) {
  const [copied, setCopied] = useState(false)
  if (!text) {
    return (
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 11.5, color: 'var(--m-text-3)' }}>
          {label} · {note || t('空')}
        </div>
      </div>
    )
  }
  const clipped = text.length > PREVIEW_LIMIT
  const shown = clipped ? text.slice(0, PREVIEW_LIMIT) : text
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11.5, color: 'var(--m-text-3)', flex: 1 }}>
          {label} · {text.length.toLocaleString()} {t('字符')}
          {clipped ? ` · ${t('只显示前 {n} 个', { n: PREVIEW_LIMIT.toLocaleString() })}` : ''}
        </span>
        <Button
          variant='ghost'
          size='sm'
          onClick={() => {
            void copyText(text).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? t('已复制') : clipped ? t('复制全文') : t('复制')}
        </Button>
      </div>
      <pre
        className='m-mono'
        style={{
          fontSize: 11,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 320,
          overflow: 'auto',
          margin: '6px 0 0',
          padding: 10,
          background: 'var(--m-surface-2)',
          borderRadius: 8,
        }}
      >
        {shown}
      </pre>
    </div>
  )
}
