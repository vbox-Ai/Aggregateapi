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
 * ── 为什么必须自己重连（踩过一次）──────────────────────────────
 * 连接会**静默死掉**：手机切到后台、页面重载、宿主 Worker 崩掉、下行流被中间层掐断。
 * 网关那边的会话槽是"谁先到都行"的全局状态，一旦手机侧接收端没了而槽里还留着发送端，
 * 之后**每一次安装都会立刻失败**（「写插件失败: 插件进程已退出或正在关闭」），而且重进
 * 页面也不见好 —— 因为面板自己以为"已接入"，不再 open。补丁 0023 让网关能把这种死会话
 * 认出来（`is_closed()` + 守卫自动清槽），这一侧则负责**断线自动重连**：只有两边都做，
 * 「点获取」才不会是"一条已经断了的通道"上的第一次写。
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

/** 断线后的重连节奏；用尽即判定接入失败（可由界面上的「重试接入」手工重置） */
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000]

/** 主动拆除会话时的原因文案：命中它就不重连（不然关页面会触发一轮无意义的重连） */
const DELIBERATE_REASON = '插件会话已关闭'

/** 取网关侧的宿主源码（与网关版本一致的那一份；手机不自带，避免协议漂移） */
async function loadHostFiles(): Promise<HostFile[]> {
  const response = await fetch(url('/api/plugins/host/source'), { headers: authHeaders() })
  const body = await response.text().catch(() => '')
  if (!response.ok) {
    // 带上状态码与响应片段：这个端点缺失/被中间层改写时，光看"失败"没法定位
    throw new Error(`网关未提供宿主源码（HTTP ${response.status}）：${body.slice(0, 200)}`)
  }
  // 网关的响应信封：`ok_json` 会把内容包进 `data`（见下方注释）。两个形状都接受。
  type SourcePayload = { files?: Array<{ path: string; text: string }>; data?: { files?: Array<{ path: string; text: string }> } }
  let payload: SourcePayload
  try {
    payload = JSON.parse(body) as SourcePayload
  } catch {
    throw new Error(`宿主源码响应不是 JSON：${body.slice(0, 200)}`)
  }
  // ⚠️ 网关的 JSON 响应有**一层信封**：`ok_json()` 会把内容包进 `data`
  // （真机实测返回的是 `{"data":{"files":[{"path":"bunfig.toml",…}]}}`）。
  // 最早这里直接读 `payload.files` ⇒ 取到 undefined ⇒ 误报"宿主源码为空"。
  const files = payload.data?.files ?? payload.files
  if (!Array.isArray(files) || !files.length) {
    // 上游 script_files() 是无条件 include_str! 的 29 个模块，正常不可能为空 ——
    // 真出现空清单，只可能是"响应不是那个端点的"（路由被改写、中间层返回了别的 JSON）。
    // 所以把原始响应带上，别让这句话只说"空"。
    throw new Error(`网关返回的宿主源码为空：${body.slice(0, 200)}`)
  }
  return files.map(file => ({ path: file.path, text: file.text }))
}

/**
 * 用网关的**纯 HTTP 端点**当传输层（与 0009 的实现一致；axum 未开 ws 特性）。
 * 上行合并成批（端点收 `{ lines }`）；`open` 必须先于 `stream`（下行端点会取走接收端，且只能取一次）。
 *
 * `onStreamEnd` 只在**非主动**断开时调用（下行流结束、open/stream 失败、上行写失败），
 * 由调用方决定要不要重连。
 */
function httpTransport(onNotice: (text: string) => void, onStreamEnd: (reason: string) => void): HostTransport & {
  packageFiles: (id: string) => Promise<HostFile[]>
} {
  const lineHandlers: Array<(line: string) => void> = []
  const closeHandlers: Array<(reason: string) => void> = []
  const outbox: string[] = []
  // 下行帧可能在 onLine 注册前就到达（open/stream 是异步的，会话建得比界面订阅快）：
  // 先攒着、注册时补发，否则第一帧（往往就是 init）直接丢 —— 表现是"宿主一声不吭、网关超时"。
  const pending: string[] = []
  let flushing = false
  let closed = false

  const finish = (reason: string, deliberate = false) => {
    if (closed) return
    closed = true
    for (const handler of closeHandlers) handler(reason)
    if (!deliberate) onStreamEnd(reason)
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
          const body = await response.text().catch(() => '')
          onNotice(`上行走不通（HTTP ${response.status}）：${body.slice(0, 160)}`)
          finish('上行通道不可用')
          return
        }
      }
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error))
      finish('上行通道不可用')
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
          if (line.trim()) {
            if (lineHandlers.length) for (const handler of lineHandlers) handler(line)
            else pending.push(line)
          }
        }
      }
      finish('与网关的连接已断开')
    } catch (error) {
      onNotice(error instanceof Error ? error.message : String(error))
      finish('与网关的连接已断开')
    }
  })()

  /**
   * 把某个已装插件包的文件取回手机（iOS 上插件在网关那台机器上，宿主读不到它的盘）。
   * 网关按包 id 在它自己的 packages 目录里读，回 [{ path, text }]。
   */
  const packageFiles = async (id: string): Promise<HostFile[]> => {
    const response = await fetch(url('/api/plugins/host/package-files'), {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const payload = (await response.json().catch(() => null)) as
      | { data?: { files?: unknown }; files?: unknown }
      | null
    if (!response.ok) {
      onNotice(`取插件文件失败（HTTP ${response.status}）`)
      throw new Error(`取插件文件失败（HTTP ${response.status}）`)
    }
    const raw = (payload?.data?.files ?? payload?.files ?? []) as Array<{ path?: unknown; text?: unknown }>
    return raw
      .map(file => ({ path: String(file?.path ?? ''), text: String(file?.text ?? '') }))
      .filter(file => file.path)
  }

  return {
    packageFiles,
    send(line) {
      outbox.push(line)
      void flush()
    },
    onLine(handler) {
      lineHandlers.push(handler)
      while (pending.length) handler(pending.shift() as string)
    },
    onClose(handler) { closeHandlers.push(handler) },
    teardown() {
      finish(DELIBERATE_REASON, true)
      void fetch(url('/api/plugins/host/close'), { method: 'POST', headers: authHeaders() }).catch(() => {})
    },
  }
}

/**
 * 在页面挂载期间保持宿主接入；断线自动重连。返回状态与一句可读的原因（失败时），
 * 以及一个手工重试入口（界面上的「重试接入」）。
 *
 * 只在"这台网关的脚本运行时不可用"时才介入：桌面端/服务端有 Bun，走原生路径即可，
 * 这里接入反而是多余的第二次握手。判据用网关给的 runtime.installed。
 */
export function useScriptHostAttach(options: {
  /** 只在网关侧没有可用脚本运行时（iOS）时介入 */
  enabled: boolean
  onNotice: (text: string) => void
}): { state: AttachState; retry: () => void } {
  const { enabled, onNotice } = options
  // 状态必须走 useState：用 ref 的话界面不会跟着更新（"正在接入"永远不变）
  const [state, setState] = useState<AttachState>('idle')
  const sessionRef = useRef<PluginHostSession | null>(null)
  const transportRef = useRef<HostTransport | null>(null)
  const timerRef = useRef<number | null>(null)
  const attemptRef = useRef(0)
  const aliveRef = useRef(false)
  /** 每次接入一个代号：异步过程中被取代的接入不许再改状态 */
  const runRef = useRef(0)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    runRef.current += 1
    clearTimer()
    sessionRef.current?.close()
    sessionRef.current = null
    transportRef.current?.teardown?.()
    transportRef.current = null
  }, [clearTimer])

  const connect = useCallback(async (): Promise<void> => {
    const run = runRef.current + 1
    runRef.current = run
    /** 本次接入失败/断线：排队重连，用尽则报失败 */
    const schedule = (reason: string) => {
      if (!aliveRef.current || runRef.current !== run) return
      const index = Math.min(attemptRef.current, RECONNECT_DELAYS.length - 1)
      const wait = RECONNECT_DELAYS[index]
      attemptRef.current += 1
      if (attemptRef.current > RECONNECT_DELAYS.length) {
        setState('unavailable')
        onNotice(`手机端宿主接入失败：${reason}`)
        return
      }
      setState('attaching')
      onNotice(`宿主连接已断开（${reason}）；${Math.round(wait / 1000)} 秒后自动重连（第 ${attemptRef.current} 次）`)
      clearTimer()
      timerRef.current = window.setTimeout(() => { void connect() }, wait)
    }
    try {
      sessionRef.current?.close()
      sessionRef.current = null
      transportRef.current?.teardown?.()
      transportRef.current = null
      const hostFiles = await loadHostFiles()
      if (!aliveRef.current || runRef.current !== run) return
      const transport = httpTransport(onNotice, schedule)
      transportRef.current = transport
      const session = await startPluginHost({
        hostFiles,
        pluginFiles: [],
        transport,
        packageFiles: transport.packageFiles,
      })
      if (!aliveRef.current || runRef.current !== run) {
        session.close()
        return
      }
      sessionRef.current = session
      // **不要在这里发 init**：`init` 是网关发给宿主的方法（host/main.mjs 里 `frame.method === "init"`
      // 由宿主自己应答），方向是 网关 → 宿主。宿主主动发 init 只会等一个不会来的回复，
      // 界面就停在「正在接入」，插件也起不来。
      // 面板的职责到此为止：宿主跑起来、传输层接上；随后用户在商店点「获取」时，
      // 网关启动插件会自己发 init，宿主（这里这个 Worker）应答，provider 就注册上来了。
      attemptRef.current = 0
      setState('attached')
    } catch (failure) {
      if (!aliveRef.current || runRef.current !== run) return
      schedule(failure instanceof Error ? failure.message : String(failure))
    }
  }, [clearTimer, onNotice])

  useEffect(() => {
    aliveRef.current = enabled
    if (!enabled) {
      stop()
      setState('idle')
      return () => { aliveRef.current = false }
    }
    attemptRef.current = 0
    setState('attaching')
    void connect()
    return () => {
      aliveRef.current = false
      stop()
      setState('idle')
    }
  }, [enabled, connect, stop])

  /** 手工重试：重置重连计数再走一次接入 */
  const retry = useCallback(() => {
    attemptRef.current = 0
    if (!aliveRef.current) return
    setState('attaching')
    void connect()
  }, [connect])

  return { state, retry }
}
