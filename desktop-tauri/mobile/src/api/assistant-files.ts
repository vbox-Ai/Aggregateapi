import { authHeaders, url } from './client'

/**
 * 助手大包（zip）导入：`POST /api/assistant/files`（multipart）。
 *
 * ── 为什么用 XHR 而不是 fetch ────────────────────────────────
 * 100 MB 级的包必须给用户看到进度；`fetch` 至今拿不到上传进度，XHR 有
 * `upload.onprogress`。这一处刻意不走 `apiCall`（它按 JSON 序列化 body），
 * 但鉴权与地址仍复用同一套 `authHeaders()` / `url()` —— 两套鉴权迟早分叉。
 *
 * ── 为什么不走内联附件那条路 ──────────────────────────────────
 * 内联那条路有它自身的边界（`MAX_TEXT_FILES = 3`、每文件 512 KiB），
 * 那是「把文件内容塞进消息」的必然上限。大包走这里：网关侧解包入库，
 * 助手按需分页读取，消息里不带字节。
 */
export type PackSkipped = { name?: string; reason?: string }

export type PackImportResult = {
  imported: number
  ids: string[]
  skipped: PackSkipped[]
}

/** 把操作者的可读结论整理成一句话（成功 N / 跳过 M 及首个原因） */
export function describePackResult(name: string, result: PackImportResult): string {
  const skipped = result.skipped?.length || 0
  if (!skipped) return `${name}：已导入 ${result.imported} 个文件`
  const first = result.skipped?.find(item => item?.reason)?.reason || '未说明'
  return `${name}：已导入 ${result.imported} 个，跳过 ${skipped} 个（${first}）`
}

export function uploadAssistantPack(
  file: File,
  session: string,
  onProgress?: (ratio: number) => void,
): Promise<PackImportResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    // 字段名不重要：网关侧只收「有文件名的那个字段」（见 api::assistant_files::upload）
    form.append('package', file, file.name)
    const request = new XMLHttpRequest()
    request.open('POST', url('/api/assistant/files'))
    for (const [key, value] of Object.entries(authHeaders())) request.setRequestHeader(key, value)
    if (session) request.setRequestHeader('x-session-id', session)
    request.upload.onprogress = event => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / Math.max(1, event.total))
    }
    request.onerror = () => reject(new Error('上传失败，请检查与网关的连接'))
    request.ontimeout = () => reject(new Error('上传超时，请重试'))
    request.onload = () => {
      let payload: unknown = null
      try { payload = JSON.parse(request.responseText || 'null') } catch { payload = null }
      if (request.status >= 200 && request.status < 300 && payload && typeof payload === 'object') {
        resolve(payload as PackImportResult)
        return
      }
      // 旧网关没有这条路由：如实说明，而不是笼统报错
      if (request.status === 404) {
        reject(new Error('当前网关不支持大包导入（缺少 /api/assistant/files），请升级网关后再试'))
        return
      }
      const message = (payload && typeof payload === 'object' && 'error' in payload)
        ? String((payload as { error?: unknown }).error)
        : `上传失败（HTTP ${request.status}）`
      reject(new Error(message))
    }
    request.send(form)
  })
}
