import type { Attachment } from '@reclaim/shared'

/** Above this the file is kept for the session only: localStorage holds about 5 MB in all. */
const PERSIST_MAX_BASE64 = 1_000_000

const param = (h: string, name: string) =>
  new RegExp(`${name}="?([^";\\r\\n]+)"?`, 'i').exec(h)?.[1]?.trim() ?? null

/**
 * Splits an .eml into its header block, the text and the attached files, so a typed complaint with
 * a photo or PDF keeps its files in mock mode too. Small files become data URLs and survive a reload.
 */
export function splitEml(text: string): { head: string; body: string; attachments: Attachment[] } {
  const [head = '', ...rest] = text.split(/\r?\n\r?\n/)
  const raw = rest.join('\n\n')
  const boundary = /^Content-Type:\s*multipart\/[^\r\n]*/im.test(head)
    ? param(head, 'boundary')
    : null
  if (!boundary) return { head, body: raw.trim(), attachments: [] }

  let body = ''
  const attachments: Attachment[] = []
  for (const part of raw.split(`--${boundary}`).slice(1)) {
    if (part.startsWith('--')) break
    const [h = '', ...b] = part.replace(/^\r?\n/, '').split(/\r?\n\r?\n/)
    const content = b.join('\n\n')
    const name = param(h, 'filename') ?? param(h, 'name')
    const mimeType = /^Content-Type:\s*([^;\r\n]+)/im.exec(h)?.[1]?.trim() ?? 'text/plain'
    if (!name) {
      if (!body && mimeType === 'text/plain') body = content.trim()
      continue
    }
    const base64 = content.replace(/\s+/g, '')
    const url =
      base64.length <= PERSIST_MAX_BASE64
        ? `data:${mimeType};base64,${base64}`
        : URL.createObjectURL(
            new Blob([Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))], { type: mimeType }),
          )
    attachments.push({ name, mimeType, url })
  }
  return { head, body, attachments }
}
