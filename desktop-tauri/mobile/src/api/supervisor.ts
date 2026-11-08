/**
 * supervisor 控制口（127.0.0.1:3066）。
 *
 * 跨端口 fetch 会被 CORS 拦，所以必须走原生桥 `a2aControl`（iOS 壳 / APK 侧
 * 各有一条实现；没有桥时如实报错，不假装成功）。
 *
 * 原生侧在结果回来后 dispatch 一个 `a2a-control-result` 事件，
 * 这里按 `id` 配对，避免并发调用互相覆盖。
 */
import { t } from '../i18n'

export type SupervisorStatus = {
  supervisor?: string
  gateway?: string
  port?: number
  heartbeat?: number
}

let nextId = 0
const waiters = new Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }>()

/** 收集 `a2a-control-result` 事件；只注册一次 */
function listen(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & { __a2aControlListened?: boolean }
  if (w.__a2aControlListened) return
  w.__a2aControlListened = true
  window.addEventListener('a2a-control-result', event => {
    const detail = (event as CustomEvent).detail as { id?: string; ok?: boolean; payload?: string } | undefined
    if (!detail?.id) return
    const waiter = waiters.get(detail.id)
    if (!waiter) return
    waiters.delete(detail.id)
    if (detail.ok) waiter.resolve(detail.payload || '')
    else waiter.reject(new Error(detail.payload || t('supervisor 调用失败')))
  })
}

/** 调 supervisor；返回响应体原文 */
export function supervisorCall(op: 'status' | 'start' | 'stop' | 'factory-reset'): Promise<string> {
  listen()
  const id = `${Date.now()}-${nextId++}`
  const handlers = (window as Window & {
    webkit?: { messageHandlers?: { a2aControl?: { postMessage: (msg: unknown) => void } } }
  })?.webkit?.messageHandlers?.a2aControl
  if (!handlers) {
    return Promise.reject(new Error(t('当前形态不支持：请用 iOS App 打开面板')))
  }
  return new Promise<string>((resolve, reject) => {
    waiters.set(id, { resolve, reject })
    try {
      handlers.postMessage({ op, id })
    } catch (error) {
      waiters.delete(id)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    // 原生侧没回音就超时，别把 Promise 留在未决状态
    window.setTimeout(() => {
      const waiter = waiters.get(id)
      if (waiter) {
        waiters.delete(id)
        waiter.reject(new Error(t('supervisor 没有响应')))
      }
    }, 35_000)
  })
}

/** 读状态并解析 JSON；解析失败把原文交还给调用方 */
export async function supervisorStatus(): Promise<{ status: SupervisorStatus | null; raw: string }> {
  const raw = await supervisorCall('status')
  try {
    return { status: JSON.parse(raw) as SupervisorStatus, raw }
  } catch {
    return { status: null, raw }
  }
}

export async function supervisorStart(): Promise<SupervisorStatus | null> {
  const raw = await supervisorCall('start')
  try {
    return JSON.parse(raw) as SupervisorStatus
  } catch {
    return null
  }
}

export async function supervisorStop(): Promise<SupervisorStatus | null> {
  const raw = await supervisorCall('stop')
  try {
    return JSON.parse(raw) as SupervisorStatus
  } catch {
    return null
  }
}

/** 删库重注册（破坏性操作，调用方必须先让用户确认）。返回 true 表示 supervisor 接受 */
export async function supervisorFactoryReset(): Promise<boolean> {
  await supervisorCall('factory-reset')
  return true
}
