import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EXPECTED, primaryProposal, type Case, type CaseSummary, type EvalResult, type SapDocument } from '@reclaim/shared'
import { buildApp } from '../src/app'
import { detectProvider } from '../src/ai/claude'

/**
 * The acceptance test: the backend must produce the organizers' expected decision for every demo case,
 * over HTTP, with the mock gateway and rules-only narration (no API key needed).
 * Run it with the model on by setting AI_MODE=assisted and either ANTHROPIC_API_KEY or the AWS keys; decisions must not change.
 */
let ctx: ReturnType<typeof buildApp>
const cm = { actor: 'Demo', role: 'credit_manager' as const }

beforeEach(async () => {
  ctx = buildApp({ mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: process.env.AI_MODE === 'assisted' && detectProvider() ? 'assisted' : 'rules_only' } })
  await ctx.app.ready()
})
afterEach(async () => ctx.app.close())

const post = (url: string, body?: unknown) => ctx.app.inject({ method: 'POST', url, ...(body ? { payload: body } : {}) })
const get = async <T>(url: string) => (await ctx.app.inject({ method: 'GET', url })).json() as T
const run = (id: string) => post(`/api/cases/${id}/run`)
const theCase = (id: string) => get<Case>(`/api/cases/${id}`)

describe('Reclaim API acceptance', () => {
  it('seeds eight cases and reports status', async () => {
    expect((await post('/api/cases/seed')).statusCode).toBe(204)
    expect(await get<CaseSummary[]>('/api/cases')).toHaveLength(8)
    expect((await get<{ cases: number }>('/api/status')).cases).toBe(8)
  })

  it('every demo case matches expected-results.json', { timeout: 300000 }, async () => {
    await post('/api/cases/seed')
    await run('case-01')
    const p01 = primaryProposal(await theCase('case-01'))!
    expect((await post(`/api/proposals/${p01.id}/approve`, cm)).statusCode).toBe(200)
    for (const id of Object.keys(EXPECTED)) {
      if (id !== 'case-01') expect((await run(id)).statusCode).toBe(204)
      const k = await theCase(id)
      const e = EXPECTED[id]!
      const p = primaryProposal(k)!
      expect([id, p.decision.ruleId, p.decision.documentType, p.decision.reasonCode ?? '', p.decision.quantity, p.decision.amount, p.decision.approverRole ?? '']).toEqual([
        id, e.rule, e.document, e.reason, e.quantity, e.amount, e.approver,
      ])
      if (id !== 'case-01') expect(k.status).toBe(e.status)
      if (e.optionA) expect(k.proposals.find((x) => x.option === 'A')!.decision).toMatchObject({ ruleId: e.optionA.rule, documentType: e.optionA.document, reasonCode: e.optionA.reason })
    }
    const ev = (await post('/api/eval/run')).json() as EvalResult[]
    expect(ev.every((r) => r.pass)).toBe(true)
  })

  it('approve writes YCR with block 08, release removes it', async () => {
    await post('/api/cases/seed')
    await run('case-03')
    const p = primaryProposal(await theCase('case-03'))!
    const res = await post(`/api/proposals/${p.id}/approve`, cm)
    expect(res.statusCode).toBe(200)
    const doc = res.json() as SapDocument
    expect(doc.payload).toMatchObject({ CreditMemoRequestType: 'YCR', HeaderBillingBlockReason: '08', ReferenceSDDocument: '90000355' })
    expect((await theCase('case-03')).status).toBe('written_to_sap')
    expect((await post(`/api/sap/${doc.id}/release`, cm)).statusCode).toBe(200)
    expect((await theCase('case-03')).sapDocuments[0]!.released).toBe(true)
  })

  it('412 conflict is returned as HTTP 412 and the case is sap_write_failed', async () => {
    await post('/api/cases/seed')
    await ctx.app.inject({ method: 'PUT', url: '/api/settings', payload: { simulateConflict: true } })
    await run('case-08')
    const p = primaryProposal(await theCase('case-08'))!
    const res = await post(`/api/proposals/${p.id}/approve`, cm)
    expect(res.statusCode).toBe(412)
    expect(res.json()).toMatchObject({ status: 412 })
    expect((await theCase('case-08')).status).toBe('sap_write_failed')
  })

  it('guards: re-run after write is 409, lower role is 403', async () => {
    await post('/api/cases/seed')
    await run('case-03')
    const p = primaryProposal(await theCase('case-03'))!
    expect((await post(`/api/proposals/${p.id}/approve`, { ...cm, editedQuantity: 20 })).statusCode).toBe(403)
    expect((await post(`/api/proposals/${p.id}/approve`, { actor: 'FD', role: 'finance_director', editedQuantity: 20 })).statusCode).toBe(200)
    expect((await run('case-03')).statusCode).toBe(409)
  })

  it('ingests an .eml and runs it to a policy-gap proposal', async () => {
    const boundary = 'xyz'
    const eml = 'From: x@y.example\r\nSubject: Something odd\r\nDate: Mon, 05 Oct 2026 10:00:00 +0000\r\n\r\nHello, the labels on the drums are wrong.\r\n'
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="other.eml"\r\nContent-Type: message/rfc822\r\n\r\n${eml}\r\n--${boundary}--\r\n`
    const res = await ctx.app.inject({ method: 'POST', url: '/api/cases/ingest', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload })
    const [s] = res.json() as CaseSummary[]
    expect(s!.status).toBe('received')
    await run(s!.id)
    const k = await theCase(s!.id)
    expect(primaryProposal(k)!.decision.ruleId).toBe('NONE')
    expect(k.status).toBe('awaiting_approval')
  })
})

import { MockGateway } from '../src/gateway/mock'
import type { Gateway } from '../src/gateway/types'
import { INVOICES } from '@reclaim/shared'


describe('audit fixes', () => {
  it('a refused approval leaves the proposal unchanged; quantity 0 is rejected', async () => {
    await post('/api/cases/seed')
    await run('case-03')
    const before = primaryProposal(await theCase('case-03'))!
    expect((await post(`/api/proposals/${before.id}/approve`, { actor: 'RD', role: 'returns_desk', editedQuantity: 0 })).statusCode).toBe(400)
    expect((await post(`/api/proposals/${before.id}/approve`, { actor: 'RD', role: 'returns_desk', editedQuantity: 1 })).statusCode).toBe(403)
    expect((await post(`/api/proposals/${before.id}/approve`, { ...cm, editedQuantity: 20 })).statusCode).toBe(403)
    const after = primaryProposal(await theCase('case-03'))!
    expect(after.decision).toEqual(before.decision)
    expect(after.sapPayload).toEqual(before.sapPayload)
    expect((await theCase('case-03')).status).toBe('awaiting_approval')
  })

  it('a case cannot be re-run from approved, written or closed, nor while a write is in flight', async () => {
    const slow: Gateway = Object.assign(new MockGateway({ simulateConflict: () => false, delayMs: 0 }), {
      createCreditMemoRequest: async (p: Record<string, unknown>) => {
        await new Promise((r) => setTimeout(r, 80))
        return new MockGateway({ simulateConflict: () => false, delayMs: 0 }).createCreditMemoRequest(p)
      },
    })
    await ctx.app.close()
    ctx = buildApp({ mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => slow })
    await ctx.app.ready()
    await post('/api/cases/seed')
    await run('case-03')
    const p = primaryProposal(await theCase('case-03'))!
    const approving = post(`/api/proposals/${p.id}/approve`, cm)
    await new Promise((r) => setTimeout(r, 10))
    expect((await run('case-03')).statusCode).toBe(409)
    expect((await approving).statusCode).toBe(200)
    expect((await theCase('case-03')).status).toBe('written_to_sap')
    await run('case-02')
    const p2 = primaryProposal(await theCase('case-02'))!
    await post(`/api/proposals/${p2.id}/approve`, cm)
    expect((await theCase('case-02')).status).toBe('closed')
    expect((await run('case-02')).statusCode).toBe(409)
  })

  it('release needs the approver role, happens once, and a return needs goods receipt', async () => {
    await post('/api/cases/seed')
    await run('case-03')
    const p = primaryProposal(await theCase('case-03'))!
    const doc = (await post(`/api/proposals/${p.id}/approve`, cm)).json() as SapDocument
    expect((await post(`/api/sap/${doc.id}/release`, { actor: 'RD', role: 'returns_desk' })).statusCode).toBe(403)
    expect((await post(`/api/sap/${doc.id}/release`, cm)).statusCode).toBe(200)
    expect((await post(`/api/sap/${doc.id}/release`, cm)).statusCode).toBe(409)
    expect((await theCase('case-03')).events.filter((e) => e.kind === 'sap_release')).toHaveLength(1)
    await run('case-08')
    const p8 = primaryProposal(await theCase('case-08'))!
    const d8 = (await post(`/api/proposals/${p8.id}/approve`, cm)).json() as SapDocument
    expect(d8.type).toBe('YRE')
    expect((await post(`/api/sap/${d8.id}/release`, cm)).statusCode).toBe(409)
    expect((await post(`/api/sap/${d8.id}/release`, { ...cm, goodsReceived: true })).statusCode).toBe(200)
  })

  it('a missing or failing agreed-price lookup sends the price complaint to a person', async () => {
    const noPrice: Gateway = Object.assign(new MockGateway({ simulateConflict: () => false, delayMs: 0 }), { getAgreedPrice: async () => null })
    await ctx.app.close()
    ctx = buildApp({ mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => noPrice })
    await ctx.app.ready()
    await post('/api/cases/seed')
    expect((await run('case-02')).statusCode).toBe(204)
    let p = primaryProposal(await theCase('case-02'))!
    expect(p.decision).toMatchObject({ ruleId: 'R4', documentType: 'NONE', approverRole: 'credit_manager' })
    expect(p.decision.notes).toMatch(/No agreed price/)
    const throwing: Gateway = Object.assign(new MockGateway({ simulateConflict: () => false, delayMs: 0 }), {
      getAgreedPrice: async () => {
        throw Object.assign(new Error('getAgreedPrice is not implemented on the gateway'), { status: 404 })
      },
    })
    await ctx.app.close()
    ctx = buildApp({ mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => throwing })
    await ctx.app.ready()
    await post('/api/cases/seed')
    expect((await run('case-02')).statusCode).toBe(204)
    const k = await theCase('case-02')
    p = primaryProposal(k)!
    expect(p.decision).toMatchObject({ ruleId: 'R4', documentType: 'NONE' })
    expect(k.events.some((e) => e.kind === 'error' && /getAgreedPrice/.test(e.title))).toBe(true)
    expect(k.status).toBe('awaiting_approval')
  })

  it('real mode is refused without a gateway, and a mock-built proposal cannot be approved in real mode', async () => {
    await post('/api/cases/seed')
    expect((await ctx.app.inject({ method: 'PUT', url: '/api/settings', payload: { sapMode: 'real' } })).statusCode).toBe(400)
    expect((await get<{ sapMode: string }>('/api/settings')).sapMode).toBe('mock')
    const gw = new MockGateway({ simulateConflict: () => false, delayMs: 0 })
    await ctx.app.close()
    ctx = buildApp({ mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => gw, gatewayUrl: 'http://gateway.invalid' })
    await ctx.app.ready()
    await post('/api/cases/seed')
    await run('case-08')
    const p = primaryProposal(await theCase('case-08'))!
    expect(p.sapMode).toBe('mock')
    expect((await ctx.app.inject({ method: 'PUT', url: '/api/settings', payload: { sapMode: 'real' } })).statusCode).toBe(200)
    expect((await post(`/api/proposals/${p.id}/approve`, cm)).statusCode).toBe(409)
    // Re-run in real mode: the proposal is now stamped real, and the demo-invoice guard refuses the write.
    expect((await run('case-08')).statusCode).toBe(204)
    const p2 = primaryProposal(await theCase('case-08'))!
    expect(p2.sapMode).toBe('real')
    expect((await post(`/api/proposals/${p2.id}/approve`, cm)).statusCode).toBe(400)
  })

  it('uses the invoice line that matches the email, and takes the customer from the invoice', async () => {
    const two = { ...INVOICES['90000355']!, customer: '10044', customerName: 'Cust DE 2', items: [
      { ...INVOICES['90000355']!.items[0]!, item: '10', material: '99', quantity: 1, netAmount: 10, unitPrice: 10 },
      { ...INVOICES['90000355']!.items[0]!, item: '20', material: '54', quantity: 20, netAmount: 5400, unitPrice: 270 },
    ] }
    const gw: Gateway = Object.assign(new MockGateway({ simulateConflict: () => false, delayMs: 0 }), { getInvoice: async () => two })
    await ctx.app.close()
    ctx = buildApp({ mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => gw })
    await ctx.app.ready()
    await post('/api/cases/seed')
    await run('case-03')
    const k = await theCase('case-03')
    const p = primaryProposal(k)!
    expect(p.decision).toMatchObject({ material: '54', quantity: 2, amount: 540 })
    expect(p.sapPayload).toMatchObject({ to_Item: [{ ReferenceSDDocumentItem: '20', Material: '54' }] })
    expect(k.customer).toBe('10044')
    expect(k.customerName).toBe('Cust DE 2')
  })

  it('a write whose response does not confirm block 08 is flagged, never released', async () => {
    const gw: Gateway = Object.assign(new MockGateway({ simulateConflict: () => false, delayMs: 0 }), {
      createCreditMemoRequest: async () => ({ ok: true as const, number: '60000999', response: { status: 201, CreditMemoRequest: '60000999', HeaderBillingBlockReason: '' } }),
    })
    await ctx.app.close()
    ctx = buildApp({ mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => gw })
    await ctx.app.ready()
    await post('/api/cases/seed')
    await run('case-03')
    const p = primaryProposal(await theCase('case-03'))!
    const res = await post(`/api/proposals/${p.id}/approve`, cm)
    expect(res.statusCode).toBe(200)
    const k = await theCase('case-03')
    expect(k.status).toBe('written_to_sap')
    expect(k.events.some((e) => e.kind === 'error' && /billing block/i.test(e.title))).toBe(true)
    expect((await post(`/api/sap/${(res.json() as SapDocument).id}/release`, cm)).statusCode).toBe(409)
  })
})

describe('inbound complaints', () => {
  it('accepts a JSON complaint, creates the case and starts the run', async () => {
    process.env.INBOUND_AUTORUN = 'false'
    const res = await post('/api/inbound', { from: 'Quality, Cust DE 1 <quality@cust-de-1.example>', subject: 'Short delivery – invoice 90000355', text: 'Invoice 90000355 charges 20 KG of material 54 but only 18 KG arrived. Please credit the 2 KG missing.', messageId: '<m1@test>' })
    expect(res.statusCode).toBe(201)
    const s = res.json() as CaseSummary
    expect(s.status).toBe('received')
    await run(s.id)
    expect(primaryProposal(await theCase(s.id))!.decision).toMatchObject({ ruleId: 'R5', quantity: 2, amount: 540 })
    const again = await post('/api/inbound', { from: 'x', subject: 'dup', text: 'dup', messageId: '<m1@test>' })
    expect(again.json()).toEqual({ duplicate: true })
  })

  it('accepts a raw email (message/rfc822) with a quoted-printable body', async () => {
    process.env.INBOUND_AUTORUN = 'false'
    const eml = 'From: Warehouse, Cust DE 1 <warehouse@cust-de-1.example>\r\nTo: returns@o2c-hackathon.example\r\nSubject: Short delivery =?utf-8?b?4oCT?= invoice 90000355\r\nDate: Mon, 05 Oct 2026 07:50:00 +0000\r\nMessage-ID: <raw1@test>\r\nContent-Type: text/plain; charset="utf-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nInvoice 90000355 charges 20 KG of material 54 but only 18 KG arrived. Please =\r\ncredit the 2 KG missing.\r\n'
    const res = await ctx.app.inject({ method: 'POST', url: '/api/inbound', headers: { 'content-type': 'message/rfc822' }, payload: eml })
    expect(res.statusCode).toBe(201)
    const s = res.json() as CaseSummary
    expect(s.subject).toBe('Short delivery – invoice 90000355')
    const k = await theCase(s.id)
    expect(k.bodyText).toContain('Please credit the 2 KG missing')
    expect(k.receivedAt).toBe('2026-10-05T07:50:00.000Z')
  })
})

import { mailboxConfigFromEnv, senderAllowed } from '../src/intake/mailbox'
describe('mailbox config', () => {
  it('reads EMAIL_* names, strips spaces from the app password, parses the allowlist', () => {
    const saved = { ...process.env }
    process.env.EMAIL_HOST = 'imap.gmail.com'
    process.env.EMAIL_USER = 'x@gmail.com'
    process.env.EMAIL_PASSWORD = 'adfp sujo hvma piug'
    process.env.EMAIL_ALLOWED_DOMAINS = 'gmail.com, deloitte.com'
    const cfg = mailboxConfigFromEnv()!
    expect(cfg).toMatchObject({ host: 'imap.gmail.com', user: 'x@gmail.com', password: 'adfpsujohvmapiug', allowedDomains: ['gmail.com', 'deloitte.com'] })
    process.env.EMAIL_ENABLED = 'false'
    expect(mailboxConfigFromEnv()).toBeNull()
    process.env = saved
  })
  it('senderAllowed', () => {
    expect(senderAllowed('Quality <q@cust-de-1.example>', [])).toBe(true)
    expect(senderAllowed('Someone <a@gmail.com>', ['gmail.com'])).toBe(true)
    expect(senderAllowed('Someone <a@mail.gmail.com>', ['gmail.com'])).toBe(true)
    expect(senderAllowed('Someone <a@evil.example>', ['gmail.com'])).toBe(false)
  })
})
