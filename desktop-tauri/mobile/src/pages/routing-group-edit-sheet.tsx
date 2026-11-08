import { useState } from 'react'
import { Button, Input, Label, Sheet, SheetBody, SheetContent, SheetFooter, SheetHeader, SheetTitle, Switch, confirmDialog } from '@ui'
import { Badge, Empty, ErrorNote } from '../components/ui'
import { serverIdentity } from '../lib/servers'
import { store } from '../state/store'
import { providerLabel } from '../lib/providers'
import { t } from '../i18n'
import { ApiError, apiCall } from '../api/client'
import { putRoutingGroup, type RoutingGroupBody, type RoutingGroupsPayload } from '../api/routing'

/**
 * 编辑一个路由组 —— **只改「安全子集」**：组名、说明、成员的参与开关。
 *
 * ── 为什么只做这三项 ─────────────────────────────────────────
 * 组里还有 `model`（对外模型 ID）、`strategy` / `sticky`（策略与粘性）、成员列表本身
 * （增删成员 / 改成员指向的模型与账号）。那几项**直接影响真实转发**，改错的代价
 * 比「手机上顺手改一下」大得多，而且它们在桌面端的画布上有拖拽/校验配合。
 * 所以这里**不碰**，只做桌面端也要点两次对话框的那类轻量修改。
 *
 * ── 字段是**原样回传**的 ────────────────────────────────────
 * 上游结构体是 `deny_unknown_fields`，多一个字段就 400。所以草稿是从**读到的对象**
 * 展开出来的（`{...group, name, description, members}`），那些本页不认识的字段
 * （`accounts`、`strategy`…）逐字带回去 —— 这既是「不越权」，也是唯一能通过校验的做法。
 *
 * ── revision 与并发 ─────────────────────────────────────────
 * `revision` 是整组内容的 SHA-256。保存时回传**打开抽屉时读到的**那个值；
 * 若别的设备/桌面端在这中间改过，后端返回 **409**。这不是错误而是并发保护，
 * 所以这里把它当成正常分支：重新拉一次清单、取回最新 revision 顶上来，
 * 让用户确认后再存 —— 而不是让草稿变成一个永远存不进去的死局。
 */
export function RoutingGroupEditSheet<Catalog = unknown>({
  group,
  revision,
  onClose,
  onSaved,
}: {
  group: RoutingGroupBody
  revision: string
  onClose: () => void
  onSaved: (next: RoutingGroupsPayload<Catalog>) => void
}) {
  const identity = serverIdentity()
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description)
  const [included, setIncluded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(group.members.map(member => [member.id, member.included])),
  )
  const [currentRevision, setCurrentRevision] = useState(revision)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  /** 改动摘要：保存前给用户看，避免「点了保存但不知道改了什么」 */
  const changes: string[] = []
  if (name !== group.name) changes.push(t('组名：{from} → {to}', { from: group.name, to: name }))
  if (description !== group.description) changes.push(t('说明已修改'))
  for (const member of group.members) {
    const next = included[member.id]
    if (next !== member.included) {
      changes.push(
        t('成员 {name}：{from} → {to}', {
          name: `${providerLabel(member.provider, member.provider)} · ${member.model}`,
          from: member.included ? t('参与') : t('不参与'),
          to: next ? t('参与') : t('不参与'),
        }),
      )
    }
  }

  const save = async () => {
    if (busy) return
    if (!name.trim()) {
      setError(t('组名不能为空'))
      return
    }
    if (!changes.length) {
      setError(t('没有改动'))
      return
    }
    const ok = await confirmDialog(changes.join('\n'), {
      title: t('保存路由组「{name}」？', { name: group.name }),
      confirmText: t('保存'),
    })
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      // 只改这三个字段，其余（含 accounts / strategy / sticky）逐字回传
      const next: RoutingGroupBody = {
        ...group,
        name: name.trim(),
        description,
        members: group.members.map(member => ({ ...member, included: included[member.id] ?? member.included })),
      }
      const result = await putRoutingGroup<Catalog>({ id: group.id, group: next, revision: currentRevision })
      if (serverIdentity() !== identity) return
      onSaved(result)
      store.toast(t('已保存路由组'))
      onClose()
    } catch (cause) {
      if (serverIdentity() !== identity) return
      const status = cause instanceof ApiError ? cause.status : 0
      if (status === 409) {
        // 并发保护：拉最新的 revision 顶上来，让用户确认后再存
        try {
          const fresh = await apiRefreshGroups<Catalog>()
          if (serverIdentity() === identity) {
            const found = fresh.groups?.find(item => item.group.id === group.id)
            if (found?.revision) setCurrentRevision(found.revision)
            setError(t('这个组在别处被改过：已载入最新版本，请确认改动后再次保存。'))
          }
        } catch {
          setError(t('这个组在别处被改过；请关闭后刷新列表再试。'))
        }
      } else {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (serverIdentity() === identity) setBusy(false)
    }
  }

  return (
    <Sheet open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>{t('编辑路由组')} · {group.model}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          {error ? <ErrorNote text={error} /> : null}

          <div>
            <Label htmlFor='group-name'>{t('组名')}</Label>
            <Input id='group-name' value={name} onChange={event => setName(event.currentTarget.value)} />
            <p className='m-ck-note'>{t('最多 64 个字符，不能为空。')}</p>
          </div>

          <div style={{ marginTop: 12 }}>
            <Label htmlFor='group-desc'>{t('说明')}</Label>
            <Input id='group-desc' value={description} onChange={event => setDescription(event.currentTarget.value)} />
            <p className='m-ck-note'>{t('最多 500 个字符，可留空。')}</p>
          </div>

          <div style={{ marginTop: 14 }}>
            <Label>{t('成员参与')}</Label>
            <p className='m-ck-note'>
              {t('关掉的成员不参与这个组的选路（等价于把它移出候选），成员本身与它指向的模型/账号都不变。')}
            </p>
            {group.members.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                {group.members.map(member => (
                  <div key={member.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className='m-t1' style={{ fontSize: 12.5 }}>
                        {providerLabel(member.provider, member.provider)} · {member.model}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                        <Badge tone='mute'>{t('{n} 个账号', { n: member.accounts.length })}</Badge>
                        {member.included ? null : <Badge tone='warn'>{t('已排除')}</Badge>}
                      </div>
                    </div>
                    <Switch
                      checked={included[member.id] ?? member.included}
                      aria-label={`${member.provider} ${member.model}`}
                      onCheckedChange={next => setIncluded(current => ({ ...current, [member.id]: next === true }))}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <Empty text={t('这个组还没有成员。')} />
            )}
          </div>

          <p className='m-ck-note' style={{ marginTop: 12 }}>
            {t('对外模型 ID、策略、粘性，以及成员的增删与账号范围，都在桌面端「路由」画布上改 —— 那几项直接影响真实转发。')}
          </p>
        </SheetBody>
        <SheetFooter>
          <Button variant='outline' disabled={busy} onClick={onClose}>{t('取消')}</Button>
          <Button disabled={busy || !changes.length} onClick={() => void save()}>
            {busy ? t('保存中…') : changes.length ? t('保存 {n} 项改动', { n: changes.length }) : t('没有改动')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** 409 之后重拉一次清单：拿回最新 revision，让用户确认后还能存进去 */
async function apiRefreshGroups<Catalog>(): Promise<RoutingGroupsPayload<Catalog>> {
  return apiCall<RoutingGroupsPayload<Catalog>>('/api/routing/groups')
}
