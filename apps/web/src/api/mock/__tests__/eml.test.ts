import { describe, it, expect } from 'vitest'
import { buildEml } from '@/features/inbox/eml'
import { MockApiClient } from '../MockApiClient'
import { splitEml } from '../eml'

const eml = buildEml({
  from: 'Cust DE 1 <q@cust-de-1.example>',
  subject: 'Short delivery on invoice 90000356',
  body: 'Only 8 of 10 drums arrived.',
  attachments: [
    { name: 'Lieferschein.pdf', mimeType: 'application/pdf', base64: btoa('%PDF-1.4 x') },
  ],
})

describe('typed complaints in mock mode', () => {
  it('keeps the text and the attached files apart', () => {
    const m = splitEml(eml)
    expect(m.body).toBe('Only 8 of 10 drums arrived.')
    expect(m.attachments).toEqual([
      {
        name: 'Lieferschein.pdf',
        mimeType: 'application/pdf',
        url: `data:application/pdf;base64,${btoa('%PDF-1.4 x')}`,
      },
    ])
  })

  it('puts the files on the new case', async () => {
    const api = new MockApiClient({ fast: true })
    const [s] = await api.ingest([new File([eml], 'typed.eml')])
    const c = await api.getCase(s!.id)
    expect(c.bodyText).toBe('Only 8 of 10 drums arrived.')
    expect(c.attachments.map((a) => a.name)).toEqual(['Lieferschein.pdf'])
  })
})
