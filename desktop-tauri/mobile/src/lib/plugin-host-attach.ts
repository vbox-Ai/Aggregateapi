/**
 * 脚本插件页的**自动接入**：手机上把宿主跑起来，让商店与登录流程照常工作。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────
 * iOS 上网关起不了脚本宿主（`script/bun.rs` 的 `asset()` 没有 ios 分支），于是
 * 「获取」装不上、装上了也跑不起来。补丁 0010/0011 把网关侧改成：**没有运行时就用
 * "远端宿主"** —— 下载与登记不再以 Bun 为前提，宿主握手改由手机完成。
 *
 * 于是面板要做的只有一件事：**把宿主跑起来并接上**。接上之后，商店卡片、插件设置、
 * 以及各提供商的登录流程**都不需要额外界面** —— 它们本来就经网关走同一套 RPC
 * （`client.auth.set` 也在里面），宿主活着它们就能正常工作。
 *
 * ── init 的方向（踩过一次）────────────────────────────────────
 * `init` 是**网关发给宿主**的方法（上游 `host/main.mjs` 里 `frame.method === "init"` 由宿主应答）。
 * 所以面板**不能**主动发 init —— 那样它只会等一个不会来的回复。面板只负责把宿主跑起来并接上。
 *
 * ── 与"每支插件一个 Worker"的关系 ──────────────────────────────
 * 宿主本身**只有一份**（它是"共享的运行时"，桌面端也如此）；隔离发生在插件之间，
 * 而插件是由宿主在自己的上下文里装载的。所以这里只需要**一个** Worker。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { authHeaders, url } from '../api/client'
import type { HostFile, HostTransport } from './plugin-host'
import { startPluginHost, type PluginHostSession } from './plugin-host-session'

export type AttachState = 'idle' | 'attaching' | 'attached' | 'unavailable'

/** 取网关侧的宿主源码（与网关版本一致的那一份；手机不自带，避免协议漂移） */
async function loadHostFiles(): Promise<HostFile[]> {
  const response = await fetch(url('/api/plugins/host/source'), { headers: authHeaders() })
  if (!response.ok) throw new Error(`网关未提供宿主源码（HTTP ${response.status}）`)
  const payload = await response.json() as { files?: Array<{ path: string; text: string }> }
  if (!Array.isArray(payload.files) || !payload.files.length) throw new Error('网关返回的宿主源码为空')
  return payload.files.map(file => ({ path: file.path, text: file.text }))
}

/**
 * 用网关的**纯 HTTP 端点**当传输层（与 0009 的实现一致；axum 未开 ws 特性）。
 * 上行合并成批（端点收 `{ lines }`）；`open` 必须先于 `stream`（下行端点会取走接收端，且只能取一次）。
 */
function httpTransport(onNotice: (text: string) => void): HostTransport {
  const lineHandlers: Array<(line: string) => void> = []
  const closeHandlers: Array<(reason: string) => void> = []
  const outbox: string[] = []
  let flushing = false
  let closed = false

  const finish = (reason: string) => {
    if (closed) return
    closed = true
    for (const handler of closeHandlers) handler(reason)
  }

  const flush = async () => {
    if (flushing || closed) return
    flushing = true
    try {
      while (outbox.length) {
        const batch = outbox.splice(0, outbox.length)
        const response = await fetch(url('/api/plugins/host/frames'), {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: batch }),
        })
        if (!response.ok) {
          onNotice(`上行失败（HTTP ${response.status}）`)
          finish('与网关的插件通道已断开')
          return
        }
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error))
      finish('与网关的插件通道已断开')
    } finally {
      flushing = false
    }
  }

  void (async () => {
    try {
      const opened = await fetch(url('/api/plugins/host/open'), { method: 'POST', headers: authHeaders() })
      if (!opened.ok) {
        onNotice(`网关没有打开远端宿主会话（HTTP ${opened.status}）`)
        finish('远端宿主会话未建立')
        return
      }
      const response = await fetch(url('/api/plugins/host/stream'), { headers: authHeaders() })
      if (!response.ok || !response.body) {
        onNotice(`下行流未建立（HTTP ${response.status}）`)
        finish('远端宿主会话未建立')
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
          const line = buffer.slice(0, at)
          buffer = buffer.slice(at + 1)
          if (line.trim()) for (const handler of lineHandlers) handler(line)
        }
      }
      finish('与网关的连接已断开')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error))
      finish('与网关的连接已断开')
    }
  })()

  return {
    send(line) {
      outbox.push(line)
      void flush()
    },
    onLine(handler) { lineHandlers.push(handler) },
    onClose(handler) { closeHandlers.push(handler) },
    teardown() {
      finish('插件会话已关闭')
      void fetch(url('/api/plugins/host/close'), { method: 'POST', headers: authHeaders() }).catch(() => {})
    },
  }
}

/**
 * 在页面挂载期间保持宿主接入。返回当前状态与一句可读的原因（失败时）。
 *
 * 只在"这台网关的脚本运行时不可用"时才介入：桌面端/服务端有 Bun，走原生路径即可，
 * 这里接入反而是多余的第二次握手。判据用网关给的 runtime.installed。
 */
export function useScriptHostAttach(options: {
  /** 只在网关侧没有可用脚本运行时（iOS）时介入 */
  enabled: boolean
  onNotice: (text: string) => void
}): { state: AttachState } {
  const { enabled, onNotice } = options
  // 状态必须走 useState：用 ref 的话界面不会跟着更新（"正在接入"永远不变）
  const [state, setState] = useState<AttachState>('idle')
  const sessionRef = useRef<PluginHostSession | null>(null)
  const transportRef = useRef<HostTransport | null>(null)

  const stop = useCallback(() => {
    sessionRef.current?.close()
    sessionRef.current = null
    transportRef.current?.teardown?.()
    transportRef.current = null
  }, [])

  useEffect(() => {
    if (!enabled) {
      setState('idle')
      return
    }
    let cancelled = false
    setState('attaching')
    void (async () => {
      try {
        const hostFiles = await loadHostFiles()
        if (cancelled) return
        const transport = httpTransport(onNotice)
        transportRef.current = transport
        const session = await startPluginHost({ hostFiles, pluginFiles: [], transport })
        sessionRef.current = session
        // **不要在这里发 init**：`init` 是网关发给宿主的方法（host/main.mjs 里 `frame.method === "init"`
        // 由宿主自己应答），方向是 网关 → 宿主。宿主主动发 init 只会等一个不会来的回复，
        // 界面就停在「正在接入」，插件也起不来。
        // 面板的职责到此为止：宿主跑起来、传输层接上；随后用户在商店点「获取」时，
        // 网关启动插件会自己发 init，宿主（这里这个 Worker）应答，provider 就注册上来了。
        if (cancelled) return
        setState('attached')
      } catch (failure) {
        if (cancelled) return
        setState('unavailable')
        onNotice(failure instanceof Error ? failure.message : String(failure))
      }
    })()
    return () => {
      cancelled = true
      stop()
      setState('idle')
    }
  }, [enabled, onNotice, stop])

  return { state }
}
