import { describe, it, expect, afterEach } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildApp } from '../src/app'
import { headerVerifier } from '../src/auth'
import { RulesOnlyAi } from '../src/ai/rules-only'
import { mimeFromName, type Ai } from '../src/ai/types'

const H = { authorization: 'Bearer credit_manager:Demo' }
const UPLOADS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../uploads')
const FILES = ['test-delivery-note.pdf', 'test-drum.webp', 'test-notes.docx']
let ctx: ReturnType<typeof buildApp> | undefined
afterEach(async () => {
  await ctx?.app.close()
  ctx = undefined
  await Promise.all(FILES.map((f) => rm(path.join(UPLOADS, f), { force: true })))
})

describe('attachments the model reads', () => {
  it('knows the media type from the file name', () => {
    expect(mimeFromName('http://x/uploads/abc-Lieferschein.PDF')).toBe('application/pdf')
    expect(mimeFromName('drum.webp?v=2')).toBe('image/webp')
    expect(mimeFromName('notes.docx')).toBeNull()
  })

  it('sends the PDF delivery note and the photo to the model, and keeps other files without sending them', async () => {
    await mkdir(UPLOADS, { recursive: true })
    await Promise.all(FILES.map((f) => writeFile(path.join(UPLOADS, f), `content of ${f}`)))
    const seen: { mimeType: string; base64: string }[][] = []
    const rules = new RulesOnlyAi()
    const ai: Ai = Object.assign(Object.create(rules) as RulesOnlyAi, {
      name: 'capturing model',
      extractFacts: (c: Parameters<Ai['extractFacts']>[0], a: Parameters<Ai['extractFacts']>[1]) => (seen.push(a), rules.extractFacts(c)),
    })
    process.env.INBOUND_AUTORUN = 'false'
    const app = buildApp({ verifier: headerVerifier(), mockDelayMs: 0, noSideCars: true, mailer: null, initialSettings: { aiMode: 'assisted' }, ai: () => ai, embedder: null, publicBase: 'http://api.test' })
    ctx = app

    const r = await app.app.inject({
      method: 'POST',
      url: '/api/inbound',
      headers: H,
      payload: {
        from: 'Cust DE 1 <q@cust-de-1.example>',
        subject: 'Short delivery on invoice 90000356',
        text: 'Only 8 of 10 drums arrived; the signed delivery note is attached.',
        attachments: FILES.map((f) => ({ name: f, mimeType: f.endsWith('.pdf') ? 'application/pdf' : f.endsWith('.webp') ? 'image/webp' : 'application/octet-stream', url: `http://api.test/uploads/${f}` })),
      },
    })
    expect(r.statusCode).toBe(201)
    const id = (r.json() as { id: string }).id
    await app.app.inject({ method: 'POST', url: `/api/cases/${id}/run`, headers: H })

    expect(seen).toHaveLength(1)
    expect(seen[0]!.map((a) => a.mimeType)).toEqual(['application/pdf', 'image/webp'])
    expect(Buffer.from(seen[0]![0]!.base64, 'base64').toString()).toBe('content of test-delivery-note.pdf')
    const c = app.store.cases.get(id)!
    expect(c.attachments).toHaveLength(3)
    expect(c.events.some((e) => e.title === 'Facts extracted from the email and 2 attachments')).toBe(true)
  })
})
