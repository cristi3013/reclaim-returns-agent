import { describe, expect, it } from 'vitest'
import { buildEml } from '../eml'

describe('buildEml', () => {
  it('writes a plain email without attachments and a multipart one with them', () => {
    const plain = buildEml({ from: 'a@b', subject: 'S', body: 'hello', date: 'Mon, 05 Oct 2026 20:00:00 GMT', messageId: '<m@x>' })
    expect(plain).toContain('Content-Type: text/plain; charset="utf-8"\r\n\r\nhello')
    const multi = buildEml({ from: 'a@b', subject: 'S', body: 'hello', attachments: [{ name: 'note.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' }] })
    expect(multi).toMatch(/Content-Type: multipart\/mixed; boundary="([^"]+)"/)
    expect(multi).toContain('Content-Disposition: attachment; filename="note.png"')
    expect(multi).toContain('Content-Transfer-Encoding: base64\r\n\r\niVBORw0KGgo=')
    expect(multi.trim().endsWith('--')).toBe(true)
  })
})
