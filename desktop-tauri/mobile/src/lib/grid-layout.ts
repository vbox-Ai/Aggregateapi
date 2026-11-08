/**
 * 「更多」宫格的显隐与排序偏好。
 *
 * ── 为什么存本地而不是存 `/api/sidebar-layout` ──────────────────
 * 桌面端那份布局确实存在服务端（`kv` 表的 `sidebarLayout` 键，且进云同步）。
 * 但那个键的形状由 `ui/sidebar-layout.js` 的 `normalizeLayout()` 定义：
 * `{ groups: [{ id, label, custom, hidden, items: string[] }], hidden: string[] }`，
 * 而 `items` 是**桌面菜单**的 key。手机端的宫格是另一套入口（`home`/`report`… 与
 * 「更多」里的二级页），两者不是同一组 id：
 *
 *   · 用桌面的形状 + 手机的 id → 桌面读回后会多出认不出的 item，侧边栏可能出现空条目；
 *   · 在同一个对象里塞一个 `mobileGrid` 子键 → 桌面 `normalizeLayout` 重建对象时
 *     很可能把它丢掉，手机这边会莫名其妙被重置。
 *
 * 而「宫格显隐排序」本质是**这台设备上的界面偏好** —— 与手机端的主题、语言同一性质
 * （那两个也存 localStorage）。所以这里存本地，完全不碰服务端那个共用键。
 * 代价是不跨设备同步，这对一个手机上的菜单布局偏好是可接受的。
 */

export type GridPrefs = {
  /** 被隐藏的条目 id */
  hidden: string[]
  /** 每个分组的顺序（值是条目 id 列表）；没记过的分组用默认顺序 */
  order: Record<string, string[]>
}

const STORAGE_KEY = 'agent2api.mobile.gridLayout'

export const EMPTY_PREFS: GridPrefs = { hidden: [], order: {} }

export function readGridPrefs(): GridPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY_PREFS
    const parsed = JSON.parse(raw) as Partial<GridPrefs> | null
    if (!parsed || typeof parsed !== 'object') return EMPTY_PREFS
    const hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter(item => typeof item === 'string') : []
    const order: Record<string, string[]> = {}
    if (parsed.order && typeof parsed.order === 'object') {
      for (const [group, ids] of Object.entries(parsed.order)) {
        if (Array.isArray(ids)) order[group] = ids.filter(item => typeof item === 'string')
      }
    }
    return { hidden, order }
  } catch {
    // 存储被禁或内容坏了：当作没设置过，界面不该因为一个偏好读不出来而白屏
    return EMPTY_PREFS
  }
}

export function writeGridPrefs(prefs: GridPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* 存储被禁：本次会话内仍然生效，只是刷新后回到默认 */
  }
}

export function resetGridPrefs(): GridPrefs {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 同上 */
  }
  return EMPTY_PREFS
}

export function hasCustomization(prefs: GridPrefs): boolean {
  return prefs.hidden.length > 0 || Object.values(prefs.order).some(ids => ids.length > 0)
}

export function isHidden(prefs: GridPrefs, id: string): boolean {
  return prefs.hidden.includes(id)
}

/** 按偏好重排整个分组的条目（**不过滤**隐藏项；编辑器需要完整列表） */
export function orderEntries<T extends { id: string }>(groupId: string, entries: T[], prefs: GridPrefs): T[] {
  const order = prefs.order[groupId]
  if (!order || !order.length) return entries
  const rank = new Map(order.map((id, index) => [id, index]))
  // 没记过的条目排在后面并保持原相对顺序（Array.sort 是稳定排序）
  return [...entries].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER
    const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER
    return ra - rb
  })
}

/** 渲染用：先按偏好排序，再滤掉隐藏项 */
export function applyGridPrefs<T extends { id: string }>(groupId: string, entries: T[], prefs: GridPrefs): T[] {
  return orderEntries(groupId, entries, prefs).filter(entry => !isHidden(prefs, entry.id))
}

export function toggleHidden(prefs: GridPrefs, id: string): GridPrefs {
  const hidden = prefs.hidden.includes(id)
    ? prefs.hidden.filter(item => item !== id)
    : [...prefs.hidden, id]
  return { ...prefs, hidden }
}

/** 在给定顺序里把某项上移/下移一格（`ids` 是当前完整顺序） */
export function moveEntry(prefs: GridPrefs, groupId: string, ids: string[], id: string, delta: number): GridPrefs {
  const index = ids.indexOf(id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= ids.length) return prefs
  const next = [...ids]
  next.splice(index, 1)
  next.splice(target, 0, id)
  return { ...prefs, order: { ...prefs.order, [groupId]: next } }
}
