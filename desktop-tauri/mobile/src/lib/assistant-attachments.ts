import { t } from '../i18n'
import {
  MAX_TEXT_FILES,
  MAX_TEXT_FILE_BYTES,
  type AssistantTextFile,
} from '../../../ui-shared/assistant-files'

export const MAX_ATTACHMENTS = 6

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error(t('读取图片失败')))
    reader.readAsDataURL(file)
  })
}

async function prepareImage(file: File): Promise<string> {
  // 只按「是不是图片」判断，不按具体格式白名单 —— 手机拍照常见 HEIC/GIF，
  // 旧实现把它们直接拒掉（选择器也筛掉了），表现就是「相册里的照片发不出去」。
  // 具体能不能解码交给浏览器：解不开时下面给一句可读原因，而不是一律拒绝。
  if (!file.type.startsWith('image/')) throw new Error(t('这个文件不是图片'))
  if (file.size > 10 * 1024 * 1024) throw new Error(t('单张参考图不能超过 10 MiB'))
  const raw = await readAsDataUrl(file)
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error(t('这个图片格式当前设备解不开（例如某些 HEIC），请转成 JPEG 或 PNG 再发')))
    image.src = raw
  })
  if (Math.max(image.naturalWidth, image.naturalHeight) <= 1600 && raw.length <= 1_200_000) return raw
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error(t('读取图片失败'))
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const encoded = canvas.toDataURL('image/webp', 0.86)
  return encoded.length < raw.length ? encoded : raw
}

/**
 * 可当文本附件发送的扩展名。
 *
 * ── 为什么从「只有 .json / .info」放宽 ───────────────────────
 * 底层管线本来就是通用的（读原文 → 内联预览 → `read_attachment` 分页读全文），
 * 限制只写在**选择器与这个判定**里。旧集合让 `.txt`/`.md`/`.csv`/`.log`
 * 这类最常见的文本发不出去，而它们恰恰是最需要给助手看的。
 * 这里只放**纯文本**类扩展名，二进制仍然被下面两道挡住：
 * 扩展名不在集合里就不收，收到之后还有 `\u0000` 二进制嗅探。
 * 刻意**不含** `.env` / `.pem` / `.key` 这类几乎总带凭证的文件。
 */
const TEXT_FILE_EXTENSIONS = [
  'json', 'info', 'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'yml', 'yaml', 'xml', 'ini', 'toml', 'conf',
]

/** 选择器的 accept：与上面的集合**必须一致**（不一致会出现"选了却什么都没发生"） */
export const ATTACHMENT_ACCEPT = [
  'image/*',
  ...TEXT_FILE_EXTENSIONS.map(ext => `.${ext}`),
  'application/json',
  'text/*',
  // 大包（zip）单独一条路：**不走内联**，由网关解包入库、助手按需分页读。
  // 它必须出现在这里，否则选择器里根本挑不到 zip（用户会以为"没这个功能"）。
  '.zip',
  'application/zip',
  'application/x-zip-compressed',
].join(',')

/** 是不是 zip 大包（走上传那条路，而不是内联文本） */
export function isZipAttachment(file: File): boolean {
  return /\.zip$/i.test(file.name)
    || file.type === 'application/zip'
    || file.type === 'application/x-zip-compressed'
}

function isTextAttachment(file: File): boolean {
  // zip 走专门的上传通道（见 isZipAttachment），不能被当成内联文本
  if (isZipAttachment(file)) return false
  const byName = new RegExp(`\\.(${TEXT_FILE_EXTENSIONS.join('|')})$`, 'i').test(file.name)
  // 有些平台拿不到扩展名或 MIME（Windows 上 .json 的 MIME 常为空），两条都要认
  const byType = file.type.startsWith('text/')
    || file.type === 'application/json'
    || file.type === 'application/xml'
    || file.type === 'application/x-yaml'
  return byName || byType
}

/**
 * 一次读取选中的图片与文本文件。
 *
 * 与桌面端同一口径：图片按张数、文件按个数分别限额；文本文件读原文，二进制
 * 或空文件直接给出可读原因（不做静默丢弃）。
 */
export async function readMobileAttachments(
  files: FileList | File[],
  counts: { images: number; files: number },
): Promise<{ images: string[]; files: AssistantTextFile[] }> {
  const list = Array.from(files)
  const imageFiles = list.filter(file => file.type.startsWith('image/'))
  const textFiles = list.filter(file => !file.type.startsWith('image/') && isTextAttachment(file))
  if (imageFiles.length + textFiles.length !== list.length) {
    throw new Error(t('只支持图片和文本文件（如 .json / .txt / .md / .csv / .log）。'))
  }
  if (imageFiles.length + counts.images > MAX_ATTACHMENTS) {
    throw new Error(t('一次最多 {n} 张图片。', { n: MAX_ATTACHMENTS }))
  }
  if (textFiles.length + counts.files > MAX_TEXT_FILES) {
    throw new Error(t('一次最多 {n} 个文件。', { n: MAX_TEXT_FILES }))
  }
  const images: string[] = []
  for (const file of imageFiles) images.push(await prepareImage(file))
  const result: AssistantTextFile[] = []
  for (const file of textFiles) {
    if (file.size > MAX_TEXT_FILE_BYTES) {
      throw new Error(t('「{name}」超过 {n} MB，请换一个更小的文本文件。', {
        name: file.name,
        n: MAX_TEXT_FILE_BYTES / 1024 / 1024,
      }))
    }
    const text = (await file.text()).replace(/^\uFEFF/, '')
    if (!text.trim()) throw new Error(t('「{name}」是空文件。', { name: file.name }))
    if (text.includes('\u0000')) throw new Error(t('「{name}」看起来是二进制文件，助手只接收文本。', { name: file.name }))
    result.push({ name: file.name, size: file.size, text })
  }
  return { images, files: result }
}
