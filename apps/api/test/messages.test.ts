import { describe, it, expect, afterEach } from 'vitest'
import { conversation, primaryProposal, type Case, type CaseSummary, type ReplySuggestion, type SapDocument } from '@reclaim/shared'
import { buildApp } from '../src/app'
import { headerVerifier } from '../src/auth'
import { RulesOnlyAi } from '../src/ai/rules-only'
import type { Ai } from '../src/ai/types'
import type { Mailer, OutboundEmail } from '../src/intake/mailer'

const H = { authorization: 'Bearer credit_manager:Demo' }
const cm = { actor: 'Demo', role: 'credit_manager' as const }
let ctx: ReturnType<typeof buildApp>
afterEach(async () => ctx.app.close())

function setup(suggest?: (prompt: string) => string) {
  const sent: OutboundEmail[] = []
  const mailer: Mailer = { from: 'reclaim@test', send: async (e) => (sent.push(e), { messageId: `<out-${sent.length}@test>` }) }
  const prompts: string[] = []
  const rules = new RulesOnlyAi()
  const ai: Ai = suggest
    ? Object.assign(Object.create(rules) as RulesOnlyAi, { name: 'model', suggestReply: async (p: string) => (prompts.push(p), { text: suggest(p) }) })
    : rules
  process.env.INBOUND_AUTORUN = 'false'
  ctx = buildApp({ verifier: headerVerifier(), mockDelayMs: 0, noSideCars: true, mailer, initialSettings: { aiMode: 'rules_only' }, ai: () => ai, embedder: null })
  const post = (url: string, payload?: unknown) => ctx.app.inject({ method: 'POST', url, headers: H, ...(payload ? { payload } : {}) })
  const get = async <T>(url: string) => (await ctx.app.inject({ method: 'GET', url, headers: H })).json() as T
  return { post, get, sent, prompts }
}

const complaint = {
  from: 'Quality, Cust DE 1 <quality@cust-de-1.example>',
  subject: 'Short delivery – invoice 90000355',
  text: 'Invoice 90000355 charges 20 KG of material 54 but only 18 KG arrived. Please credit the 2 KG missing.',
  messageId: '<m1@test>',
}

describe('messages to the customer and the suggested reply', () => {
  it('a message can go out before the decision, as often as needed, and the decision reply stays due', async () => {
    const { post, get, sent } = setup()
    const s = (await post('/api/inbound', complaint)).json() as CaseSummary
    await post(`/api/cases/${s.id}/run`)
    expect((await get<Case>(`/api/cases/${s.id}`)).status).toBe('awaiting_approval')

    const m1 = await post(`/api/cases/${s.id}/reply`, { ...cm, kind: 'message', text: 'We are looking into it.' })
    expect(m1.statusCode).toBe(200)
    expect((await post(`/api/cases/${s.id}/reply`, { ...cm, kind: 'message', text: 'Still on it.' })).statusCode).toBe(200)
    expect((await post(`/api/cases/${s.id}/reply`, { ...cm, kind: 'message', text: ' ' })).statusCode).toBe(400)
    expect(sent.map((e) => e.text)).toEqual(['We are looking into it.', 'Still on it.'])
    expect(sent[1]).toMatchObject({ to: complaint.from, inReplyTo: '<m1@test>', subject: `Re: ${complaint.subject}` })

    const c = await get<Case>(`/api/cases/${s.id}`)
    expect(conversation(c).filter((m) => m.direction === 'out').map((m) => m.text)).toEqual(['We are looking into it.', 'Still on it.'])
    // Not the decision: approving still needs the reply, which carries the SAP reference.
    expect((await get<ReplySuggestion>(`/api/cases/${s.id}/reply-suggestion`)).kind).toBe('message')
    const doc = (await post(`/api/proposals/${primaryProposal(c)!.id}/approve`, cm)).json() as SapDocument
    expect((await get<ReplySuggestion>(`/api/cases/${s.id}/reply-suggestion`)).kind).toBe('decision')
    expect((await post(`/api/cases/${s.id}/reply`, { ...cm, text: 'We credit the 2 KG.' })).statusCode).toBe(200)
    expect(sent[2]!.text).toContain(doc.number)
    expect(sent[2]!.references).toEqual(expect.arrayContaining(['<out-1@test>', '<out-2@test>']))
  })

  it('answers one email in the thread: a colleague who wrote on the invoice gets the reply, not the customer', async () => {
    const { post, get, sent } = setup()
    const s = (await post('/api/inbound', complaint)).json() as CaseSummary
    const warehouse = { from: 'Warehouse <dock@warehouse.example>', subject: 'Re: Short delivery – invoice 90000355', text: 'Invoice 90000355: we loaded 20 KG.', messageId: '<w1@test>', inReplyTo: '<m1@test>' }
    await post('/api/inbound', warehouse)
    const c = await get<Case>(`/api/cases/${s.id}`)
    const theirs = conversation(c).find((m) => m.direction === 'in' && m.from === warehouse.from)
    expect(theirs).toBeTruthy()

    const r = await post(`/api/cases/${s.id}/reply`, { ...cm, kind: 'message', replyTo: theirs!.id, text: 'Can you send the loading list?' })
    expect(r.statusCode).toBe(200)
    expect(sent[0]).toMatchObject({ to: warehouse.from, inReplyTo: '<w1@test>', subject: warehouse.subject })
    const out = conversation(await get<Case>(`/api/cases/${s.id}`)).filter((m) => m.direction === 'out')
    expect(out[0]).toMatchObject({ to: warehouse.from, text: 'Can you send the loading list?' })

    expect((await post(`/api/cases/${s.id}/reply`, { ...cm, kind: 'message', replyTo: 'nope', text: 'Hi' })).statusCode).toBe(400)
    expect(sent).toHaveLength(1)
  })

  it('suggests the reply from every email with the customer about the invoice, worded by the model when it checks out', async () => {
    let wording = 'Dear Quality, Cust DE 1,\n\nThank you. Your complaint about invoice 90000355 is under review.\n\nKind regards,\nCustomer Service'
    const { post, get, prompts } = setup(() => wording)
    const first = (await post('/api/inbound', complaint)).json() as CaseSummary
    await post('/api/inbound', { ...complaint, subject: 'Invoice 90000355 again', text: 'The pallet of invoice 90000355 was also wet.', messageId: '<m2@test>' })
    await post('/api/inbound', { ...complaint, from: 'Other <x@another.example>', subject: 'Invoice 90000355', text: 'Not ours to read.', messageId: '<m3@test>' })
    await post('/api/cases/run-all')

    const s = await get<ReplySuggestion>(`/api/cases/${first.id}/reply-suggestion`)
    expect(s).toMatchObject({ by: 'model', kind: 'message', emails: 2, text: wording })
    expect(prompts[0]).toContain('The pallet of invoice 90000355 was also wet.')
    expect(prompts[0]).not.toContain('Not ours to read.')
    expect(prompts[0]).toMatch(/Not decided yet/)

    // A number in none of the emails or facts: the standard wording instead.
    wording = 'We will credit 950 EUR by Friday.'
    const t = await get<ReplySuggestion>(`/api/cases/${first.id}/reply-suggestion`)
    expect(t.by).toBe('template')
    expect(t.note).toMatch(/number/)
    expect(t.text).toMatch(/reviewing it/)
    expect(t.text).not.toMatch(/950/)
  })
})
