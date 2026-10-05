/** Builds an RFC 822 email, multipart when attachments are given, so a typed complaint is ingested like a real one. */
export interface EmlAttachment {
  name: string
  mimeType: string
  base64: string
}

export function buildEml(m: { from: string; subject: string; body: string; date?: string; messageId?: string; attachments?: EmlAttachment[] }): string {
  const date = m.date ?? new Date().toUTCString()
  const id = m.messageId ?? `<manual-${Date.now()}@reclaim.local>`
  const head = `From: ${m.from}\r\nTo: returns@o2c-hackathon.example\r\nSubject: ${m.subject}\r\nDate: ${date}\r\nMessage-ID: ${id}\r\nMIME-Version: 1.0\r\n`
  const atts = m.attachments ?? []
  if (atts.length === 0) return `${head}Content-Type: text/plain; charset="utf-8"\r\n\r\n${m.body}\r\n`
  const boundary = `----=_Reclaim_${Date.now().toString(36)}`
  const wrap = (b64: string) => b64.replace(/(.{76})/g, '$1\r\n')
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain; charset="utf-8"\r\n\r\n${m.body}\r\n`,
    ...atts.map((a) => `--${boundary}\r\nContent-Type: ${a.mimeType}; name="${a.name}"\r\nContent-Disposition: attachment; filename="${a.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(a.base64)}\r\n`),
    `--${boundary}--\r\n`,
  ]
  return `${head}Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${parts.join('')}`
}

export function fileToAttachment(file: File): Promise<EmlAttachment> {
  return new Promise((ok, fail) => {
    const r = new FileReader()
    r.onload = () => ok({ name: file.name, mimeType: file.type || 'application/octet-stream', base64: String(r.result).split(',')[1] ?? '' })
    r.onerror = () => fail(r.error)
    r.readAsDataURL(file)
  })
}
