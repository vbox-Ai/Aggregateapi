/**
 * 把文件交给用户保存（导出 / 备份共用）。
 *
 * ── 两条路 ────────────────────────────────────────────────────
 *   · **PWA / 浏览器**：`<a download>`，交给浏览器自己的下载流程。
 *   · **iOS 壳**：走原生桥 `a2aFile`。原因见下。
 *
 * ── 为什么 iOS 不走 <a download> ──────────────────────────────
 * WKWebView 从 iOS 14.5 起才支持下载，而且**必须**由宿主实现导航代理
 * （把策略判成 `.download`、拿到 `WKDownload` 后设 `download.delegate`）
 * 才会真正落盘；只放一个 `<a download>` 在页面里，点下去没有任何反应。
 * 与其去猜这套 API 的细节（`WKWebView` 上并没有 `downloadDelegate`
 * 这个成员，那是 `WKDownload.delegate`），不如让原生直接取/存：
 * 宿主用 `URLSession` 拿字节、写临时文件、弹分享面板 —— 这条链路少一层
 * WebKit 行为差异，也不受系统版本影响。
 *
 * 原生桥两种用法：
 *   · `saveInline`：JS 已拿到字节（导出 JSON 等小文件），base64 交给原生落盘；
 *   · `saveRemote`：备份这类可能几十 MB 的流，由原生自己带鉴权头请求并落盘，
 *     避免把整包 base64 塞过桥。
 */

type FileBridge = { postMessage: (message: unknown) => void }

/** 原生文件桥；浏览器里没有，返回 undefined */
export function fileBridge(): FileBridge | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as Window & {
    webkit?: { messageHandlers?: { a2aFile?: FileBridge } }
  })?.webkit?.messageHandlers?.a2aFile
}

/** Blob → 纯 base64（去掉 data URL 前缀） */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取文件内容失败'))
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

/** 浏览器里的下载：`<a download>` 直接交给浏览器 */
export function downloadBlob(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 立即 revoke 会让部分浏览器拿不到内容；30 秒后回收足够安全
  setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000)
}

/**
 * 保存一段字节：原生壳走桥，浏览器走 `<a download>`。
 *
 * 桥只投递（不等回调）：落盘与分享由原生完成，成功后原生会弹系统分享面板，
 * 用户在那里选「存储到文件」。
 */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const bridge = fileBridge()
  if (!bridge) {
    downloadBlob(blob, filename)
    return
  }
  const base64 = await blobToBase64(blob)
  bridge.postMessage({ op: 'saveInline', filename, base64 })
}

/** 把 JSON 值序列化成缩进文本再保存（导出文件要人能读） */
export async function downloadJson(value: unknown, filename: string): Promise<void> {
  const text = JSON.stringify(value, null, 2)
  await saveBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), filename)
}

/** 文件名里不能出现路径分隔符与 Windows 保留字符 */
export function safeFileName(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || fallback
}

/** 2026-11-08 这种日期戳，放进导出文件名 */
export function dateStamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
}
