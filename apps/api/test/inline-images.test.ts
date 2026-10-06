import { describe, it, expect } from 'vitest'
import { parseEml } from '../src/intake/mailbox'
import type { FileStore } from '../src/files'

const saved: { name: string; size: number; mimeType: string }[] = []
const files: FileStore = {
  save: async (name, content, mimeType) => (saved.push({ name, size: content.length, mimeType }), `https://files.test/${name}`),
  read: async () => null,
}

describe('photos pasted into the email', () => {
  it('saves an image inside the HTML as a data: URI like an attachment, and skips a tracking pixel', async () => {
    const photo = Buffer.alloc(600, 7).toString('base64')
    const pixel = Buffer.alloc(40, 1).toString('base64')
    const eml = [
      'From: Quality <q@cust.example>',
      'Subject: Damaged drums – invoice 90000375',
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      `<p>Photo attached.</p><img src="data:image/png;base64,${photo}"><img width="1" src="data:image/gif;base64,${pixel}">`,
    ].join('\r\n')
    const m = await parseEml(eml, files, null)
    expect(m.attachments).toEqual([{ name: 'pasted-image-1.png', mimeType: 'image/png', url: 'https://files.test/pasted-image-1.png' }])
    expect(saved).toEqual([{ name: 'pasted-image-1.png', size: 600, mimeType: 'image/png' }])
    expect(m.text).toContain('Photo attached.')
  })
})
