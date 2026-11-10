import { t } from '../i18n'

/**
 * 作用范围带（吸顶）。
 *
 * ── 为什么必须有它 ────────────────────────────────────────────
 * 桌面端每个配置面板顶部都写着「这是全局默认」或「这是模型 X 的独立配置」——
 * 因为**同一个策略字段在不同的入口下含义完全不同**：改全局会波及所有没有独立
 * 配置的模型，改模型档只影响那个模型。手机上原来没有这条带子，用户在多入口之间
 * 来回切之后分不清"现在这个保存按钮改的是谁"，这是真机上最容易踩的坑。
 *
 * 所以整条带子的职责只有一件事：**在动手之前先说清作用范围**。
 */
export function RoutingScopeBand({ kind, model, group, groupModel, note }: {
  kind: 'global' | 'model' | 'group'
  /** `kind === 'model'` 时的模型名 */
  model?: string
  /** `kind === 'group'` 时的组名 */
  group?: string
  /** 路由组的对外模型 ID */
  groupModel?: string
  note?: string
}) {
  const title = kind === 'global'
    ? t('这是全局默认 · 所有没有独立配置的模型都按它走')
    : kind === 'model'
      ? t('这是模型 {model} 的独立配置 · 只影响这个模型', { model: model || '' })
      : t('这是路由组 {group} · 对外模型 ID {id}', { group: group || '', id: groupModel || '' })
  return (
    <div className='m-section' style={{ marginBottom: 0 }}>
      <div
        role='note'
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, padding: '9px 12px',
          borderRadius: 12, fontSize: 12, lineHeight: 1.55,
          background: 'var(--m-warn-soft, rgba(255, 196, 0, 0.14))',
          border: '1px solid color-mix(in srgb, var(--m-warn, #d08700) 28%, transparent)',
        }}
      >
        <span style={{ fontWeight: 600 }}>{title}</span>
      </div>
      {note ? <p className='m-ck-note' style={{ marginTop: 6 }}>{note}</p> : null}
    </div>
  )
}
