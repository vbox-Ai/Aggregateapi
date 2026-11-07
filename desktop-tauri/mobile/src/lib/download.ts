/**
 * 把一段 JSON 或二进制落成本地文件。
 *
 * 浏览器 / PWA：`<a download>` 直接交给浏览器下载。
 * iOS 原生壳：WKWebView 里 `<a download>` 由 WKDownloadDelegate 接管
 * （见 PanelViewController），会落到临时文件再弹分享面板，用户可选「存储到文件」。
 */
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

/** 把 JSON 值序列化成缩进文本再下载（备份/导出文件要人能读） */
export function downloadJson(value: unknown, filename: string): void {
  const text = JSON.stringify(value, null, 2)
  downloadBlob(new Blob([text], { type: 'application/json;charset=utf-8' }), filename)
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
