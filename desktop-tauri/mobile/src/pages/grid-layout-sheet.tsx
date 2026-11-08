import { useState } from 'react'
import { Button, Card, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Switch } from '@ui'
import { Empty, ErrorNote } from '../components/ui'
import { Icon, type IconName } from '../components/Icon'
import { t } from '../i18n'
import {
  hasCustomization,
  moveEntry,
  orderEntries,
  readGridPrefs,
  resetGridPrefs,
  toggleHidden,
  writeGridPrefs,
  type GridPrefs,
} from '../lib/grid-layout'

export type GridEditorGroup = {
  id: string
  title: string
  /** 该分组的「条目 id → 展示信息」表（含插件页面这类动态项） */
  items: Array<{ id: string; label: string; icon: IconName; fixed?: boolean }>
}

/**
 * 宫格显隐与排序。
 *
 * 只做**条目级**的显隐与组内排序（桌面端还有分组级的显隐与自建分组，那是侧边栏
 * 才需要的层级；手机端「更多」是固定三个分组 + 插件页面一组，分组本身不折腾）。
 *
 * `fixed` 的条目（设置）不允许隐藏 —— 它是「把入口藏没了就再也找不回来」的那一个，
 * 留着它，用户总有一条路回到这个抽屉。
 */
export function GridLayoutSheet({
  groups,
  onClose,
  onChange,
}: {
  groups: GridEditorGroup[]
  onClose: () => void
  onChange: (prefs: GridPrefs) => void
}) {
  const [prefs, setPrefs] = useState<GridPrefs>(() => readGridPrefs())
  const [error, setError] = useState('')

  const update = (next: GridPrefs) => {
    setPrefs(next)
    writeGridPrefs(next)
    onChange(next)
  }

  const hiddenCount = prefs.hidden.length

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{t('自定义「更多」宫格')}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}
          <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, padding: '0 2px 10px' }}>
            {t('关掉的条目不再出现在「更多」里，但仍可通过地址或其它入口访问；排序只在本机生效（与主题、语言一样存在这台设备上）。')}
          </p>

          {groups.map(group => {
            const ordered = orderEntries(group.id, group.items, prefs)
            const ids = ordered.map(item => item.id)
            const visible = ordered.filter(item => !prefs.hidden.includes(item.id)).length
            return (
              <div key={group.id} style={{ marginBottom: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    padding: '0 2px 6px',
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: 'var(--m-text-3)',
                  }}
                >
                  <span>{group.title}</span>
                  <span className='m-mono'>{t('{visible}/{total} 显示', { visible, total: ordered.length })}</span>
                </div>
                <Card className='m-card'>
                  {ordered.length ? (
                    ordered.map((item, index) => {
                      const hidden = prefs.hidden.includes(item.id)
                      const canHide = item.fixed !== true
                      return (
                        <div key={item.id} className='m-row' style={{ alignItems: 'center' }}>
                          <span className='m-logo' style={{ opacity: hidden ? 0.45 : 1 }}>
                            <Icon name={item.icon} />
                          </span>
                          <div className='m-grow'>
                            <div className='m-t1' style={{ opacity: hidden ? 0.5 : 1 }}>{item.label}</div>
                            {item.fixed ? (
                              <div className='m-t2'>{t('固定入口，不能隐藏')}</div>
                            ) : hidden ? (
                              <div className='m-t2'>{t('已隐藏')}</div>
                            ) : null}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2, flex: 'none' }}>
                            <Button
                              size='sm'
                              variant='ghost'
                              type='button'
                              aria-label={t('上移')}
                              disabled={index === 0}
                              onClick={() => update(moveEntry(prefs, group.id, ids, item.id, -1))}
                            >
                              <Icon name='up' />
                            </Button>
                            <Button
                              size='sm'
                              variant='ghost'
                              type='button'
                              aria-label={t('下移')}
                              disabled={index === ordered.length - 1}
                              onClick={() => update(moveEntry(prefs, group.id, ids, item.id, 1))}
                            >
                              <Icon name='down' />
                            </Button>
                            <Switch
                              checked={!hidden}
                              disabled={!canHide}
                              aria-label={t('显示 {name}', { name: item.label })}
                              onCheckedChange={() => {
                                if (!canHide) {
                                  setError(t('「{name}」是固定入口，不能隐藏', { name: item.label }))
                                  return
                                }
                                setError('')
                                update(toggleHidden(prefs, item.id))
                              }}
                            />
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <Empty text={t('这一组当前没有条目。')} />
                  )}
                </Card>
              </div>
            )
          })}

          {hiddenCount ? (
            <p style={{ fontSize: 11.5, color: 'var(--m-text-3)', lineHeight: 1.7, padding: '0 2px' }}>
              {t('已隐藏 {count} 个条目。', { count: hiddenCount })}
            </p>
          ) : null}
        </SheetBody>
        <SheetFooter>
          <Button
            variant='outline'
            disabled={!hasCustomization(prefs)}
            onClick={() => {
              setError('')
              update(resetGridPrefs())
            }}
          >
            {t('恢复默认')}
          </Button>
          <Button onClick={onClose}>{t('完成')}</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
