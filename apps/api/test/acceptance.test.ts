import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EXPECTED, primaryProposal, type Case, type CaseSummary, type EvalResult, type SapDocument } from '@reclaim/shared'
import { buildApp } from '../src/app'
import { headerVerifier } from '../src/auth'
import { detectProvider } from '../src/ai/claude'
import { caseIdForMessage } from '../src/service'

/**
 * The acceptance test: the backend must produce the organizers' expected decision for every demo case,
 * over HTTP, with the mock gateway and rules-only narration (no API key needed).
 * Run it with the model on by setting AI_MODE=assisted and either ANTHROPIC_API_KEY or the AWS keys; decisions must not change.
 */
/** The test verifier reads `<role>:<name>` from the bearer token, so a body's actor and role become the caller. */
const auth = (body?: unknown) => {
  const b = (body ?? {}) as { role?: string; actor?: string }
  return b.role ? { authorization: `Bearer ${b.role}:${b.actor ?? 'Demo'}` } : {}
}
let ctx: ReturnType<typeof buildApp>
const cm = { actor: 'Demo', role: 'credit_manager' as const }
const rd = { actor: 'Warehouse', role: 'returns_desk' as const }

beforeEach(async () => {
  ctx = buildApp({ verifier: headerVerifier(),  mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: process.env.AI_MODE === 'assisted' && detectProvider() ? 'assisted' : 'rules_only' } })
  await ctx.app.ready()
})
afterEach(async () => ctx.app.close())

const post = (url: string, body?: unknown) => ctx.app.inject({ method: 'POST', url, headers: auth(body), ...(body ? { payload: body } : {}) })
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
import type { Gateway, WriteContext } from '../src/gateway/types'
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
      createCreditMemoRequest: async (p: Record<string, unknown>, c: WriteContext) => {
        await new Promise((r) => setTimeout(r, 80))
        return new MockGateway({ simulateConflict: () => false, delayMs: 0 }).createCreditMemoRequest(p, c)
      },
    })
    await ctx.app.close()
    ctx = buildApp({ verifier: headerVerifier(),  mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => slow })
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
    expect((await post(`/api/sap/${d8.id}/goods-receipt`, cm)).statusCode).toBe(403)
    expect((await post(`/api/sap/${d8.id}/goods-receipt`, rd)).statusCode).toBe(200)
    expect((await post(`/api/sap/${d8.id}/release`, cm)).statusCode).toBe(200)
  })

  it('a missing or failing agreed-price lookup sends the price complaint to a person', async () => {
    const noPrice: Gateway = Object.assign(new MockGateway({ simulateConflict: () => false, delayMs: 0 }), { getAgreedPrice: async () => null })
    await ctx.app.close()
    ctx = buildApp({ verifier: headerVerifier(),  mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => noPrice })
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
    ctx = buildApp({ verifier: headerVerifier(),  mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => throwing })
    await ctx.app.ready()
    await post('/api/cases/seed')
    expect((await run('case-02')).statusCode).toBe(204)
    const k = await theCase('case-02')
    p = primaryProposal(k)!
    expect(p.decision).toMatchObject({ ruleId: 'R4', documentType: 'NONE' })
    expect(k.events.some((e) => e.kind === 'error' && /getAgreedPrice/.test(e.title))).toBe(true)
    expect(k.status).toBe('awaiting_approval')
  })

  it('the hackathon demo invoices are never written through the live gateway, whatever the proposal says', async () => {
    const live: Gateway = Object.assign(new MockGateway({ simulateConflict: () => false, delayMs: 0 }), { live: true })
    await ctx.app.close()
    ctx = buildApp({ verifier: headerVerifier(), mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => live })
    await ctx.app.ready()
    await post('/api/cases/seed')
    await run('case-03')
    const p = primaryProposal(await theCase('case-03'))!
    const res = await post(`/api/proposals/${p.id}/approve`, cm)
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/never written to DS4/)
    expect((await theCase('case-03')).status).toBe('awaiting_approval')
    expect((await get<{ sapSystem: string }>('/api/status')).sapSystem).toBe('DS4')
  })

  it('uses the invoice line that matches the email, and takes the customer from the invoice', async () => {
    const two = { ...INVOICES['90000355']!, customer: '10044', customerName: 'Cust DE 2', items: [
      { ...INVOICES['90000355']!.items[0]!, item: '10', material: '99', quantity: 1, netAmount: 10, unitPrice: 10 },
      { ...INVOICES['90000355']!.items[0]!, item: '20', material: '54', quantity: 20, netAmount: 5400, unitPrice: 270 },
    ] }
    const gw: Gateway = Object.assign(new MockGateway({ simulateConflict: () => false, delayMs: 0 }), { getInvoice: async () => two })
    await ctx.app.close()
    ctx = buildApp({ verifier: headerVerifier(),  mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => gw })
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
    ctx = buildApp({ verifier: headerVerifier(),  mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => gw })
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

describe('read again right before the write, and goods receipt before releasing a return', () => {
  it('approval is refused when a credit for the invoice appeared since the investigation', async () => {
    let existing: { type: 'YCR'; number: string; reasonCode: string; amount: number; billingBlock: string }[] = []
    const gw: Gateway = Object.assign(new MockGateway({ simulateConflict: () => false, delayMs: 0 }), {
      checkExistingCredits: async () => ({ existingReturns: [], existingCredits: existing }),
    })
    await ctx.app.close()
    ctx = buildApp({ verifier: headerVerifier(),  mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => gw })
    await ctx.app.ready()
    await post('/api/cases/seed')
    await run('case-03')
    const p = primaryProposal(await theCase('case-03'))!
    // Someone else credits the invoice between the investigation and the approval.
    existing = [{ type: 'YCR', number: '60000900', reasonCode: '103', amount: 540, billingBlock: '08' }]
    const res = await post(`/api/proposals/${p.id}/approve`, cm)
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toMatch(/60000900/)
    const k = await theCase('case-03')
    expect(k.status).toBe('awaiting_approval')
    expect(k.sapDocuments).toHaveLength(0)
    expect(k.events.some((e) => e.kind === 'error' && /already exists/i.test(e.title))).toBe(true)
    expect(k.findings?.existingCredits.map((d) => d.number)).toEqual(['60000900'])
  })

  it('a return is released when SAP reports the goods receipt, or with an explicit manual confirmation', async () => {
    let received = false
    const gw: Gateway = Object.assign(new MockGateway({ simulateConflict: () => false, delayMs: 0 }), {
      getReturnStatus: async () => ({ status: received ? 'C' : 'A', received }),
    })
    await ctx.app.close()
    ctx = buildApp({ verifier: headerVerifier(),  mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, gateway: () => gw })
    await ctx.app.ready()
    await post('/api/cases/seed')
    await run('case-08')
    const p = primaryProposal(await theCase('case-08'))!
    const doc = (await post(`/api/proposals/${p.id}/approve`, cm)).json() as SapDocument
    expect(doc.type).toBe('YRE')
    const st = await get<{ status: string; received: boolean }>(`/api/sap/${doc.id}/status`)
    expect(st).toMatchObject({ received: false })
    expect((await post(`/api/sap/${doc.id}/release`, cm)).statusCode).toBe(409)
    received = true
    expect((await post(`/api/sap/${doc.id}/release`, cm)).statusCode).toBe(200)
    const k = await theCase('case-08')
    const rel = k.events.find((e) => e.kind === 'sap_release')!
    expect(rel.detail.goodsReceipt).toBe('confirmed by SAP')
  })

  it('without a status function, the Returns desk confirms the goods receipt and the approver releases', async () => {
    await post('/api/cases/seed')
    await run('case-08')
    const p = primaryProposal(await theCase('case-08'))!
    const doc = (await post(`/api/proposals/${p.id}/approve`, cm)).json() as SapDocument
    expect((await post(`/api/sap/${doc.id}/release`, cm)).statusCode).toBe(409)
    expect((await post(`/api/sap/${doc.id}/goods-receipt`, cm)).statusCode).toBe(403)
    expect((await post(`/api/sap/${doc.id}/goods-receipt`, rd)).statusCode).toBe(200)
    expect((await post(`/api/sap/${doc.id}/release`, cm)).statusCode).toBe(200)
    const rel = (await theCase('case-08')).events.find((e) => e.kind === 'sap_release')!
    expect(rel.detail.goodsReceipt).toBe('confirmed by the Returns desk')
    expect((await theCase('case-08')).events.some((e) => e.kind === 'goods_receipt' && e.l4Step === '5.1.3')).toBe(true)
  })
})

describe('demo reset', () => {
  it('removes the demo cases and keeps complaints that came from emails or uploads', async () => {
    await post('/api/cases/seed')
    const res = await post('/api/inbound', { from: 'Quality, Cust DE 1 <quality@cust-de-1.example>', subject: 'Short delivery – invoice 90000377', text: 'Invoice 90000377 charges 15 KG but 13 KG arrived.', messageId: '<keep-me@test>' })
    expect(res.statusCode).toBe(201)
    expect(await get<CaseSummary[]>('/api/cases')).toHaveLength(9)
    expect((await post('/api/demo/reset')).statusCode).toBe(204)
    const left = await get<CaseSummary[]>('/api/cases')
    expect(left.map((c) => c.id)).toEqual([caseIdForMessage('<keep-me@test>')])
  })
})

describe('rejecting is a money decision too', () => {
  it('needs the same role as approving, and a reason', async () => {
    await post('/api/cases/seed')
    await run('case-03') // short delivery, 540 EUR: credit manager
    const p = primaryProposal(await theCase('case-03'))!
    expect((await post(`/api/proposals/${p.id}/reject`, { actor: 'CS', role: 'customer_service_lead', comment: 'not convinced' })).statusCode).toBe(403)
    expect((await post(`/api/proposals/${p.id}/reject`, { actor: 'RD', role: 'returns_desk', comment: 'not convinced' })).statusCode).toBe(403)
    expect((await post(`/api/proposals/${p.id}/reject`, { ...cm, comment: '  ' })).statusCode).toBe(400)
    expect((await theCase('case-03')).status).toBe('awaiting_approval')
    expect((await post(`/api/proposals/${p.id}/reject`, { ...cm, comment: 'Customer counted wrong, delivery note signed for 20 KG' })).statusCode).toBe(204)
    const k3 = await theCase('case-03')
    expect(k3.status).toBe('closed')
    expect(k3.approvals[k3.approvals.length - 1]!.decision).toBe('rejected')
  })
})

describe('authentication', () => {
  it('refuses API calls without a valid session, except the public health, status and inbound endpoints', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/cases', headers: { authorization: 'Bearer invalid' } })).statusCode).toBe(401)
    expect((await ctx.app.inject({ method: 'GET', url: '/api/events', query: { token: 'invalid' } })).statusCode).toBe(401)
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
    expect((await ctx.app.inject({ method: 'GET', url: '/api/status' })).statusCode).toBe(200)
  })

  it('takes the actor and the role from the token, not from the body', async () => {
    await post('/api/cases/seed')
    await run('case-03')
    const p = primaryProposal(await theCase('case-03'))!
    // The body claims to be the credit manager; the token says customer service lead.
    const res = await ctx.app.inject({ method: 'POST', url: `/api/proposals/${p.id}/approve`, headers: { authorization: 'Bearer customer_service_lead:Lead' }, payload: cm })
    expect(res.statusCode).toBe(403)
    const ok = await ctx.app.inject({ method: 'POST', url: `/api/proposals/${p.id}/approve`, headers: { authorization: 'Bearer credit_manager:Dana' }, payload: { actor: 'Someone else' } })
    expect(ok.statusCode).toBe(200)
    expect((await theCase('case-03')).approvals[0]!.actor).toBe('Dana')
  })
})

describe('Control Tower (extra credit): reads, answers, routes, never writes', () => {
  it('runs the scan on the pack, answers the Norway question honestly and refuses to change SAP', async () => {
    const s = (await post('/api/control-tower/run')).json() as { verdict: string; kpis: { unbilled: { count: number } }; requestLog: string[]; findings: unknown[] }
    expect(s.verdict).toBe('not ready')
    expect(s.kpis.unbilled.count).toBe(178)
    expect(s.requestLog.length).toBeGreaterThan(5)
    expect(s.requestLog.every((r) => r.startsWith('GET '))).toBe(true)
    const no = (await post('/api/control-tower/ask', { question: 'Why is DSO up for Norway?' })).json() as { noData: boolean; routeTo: string; text: string }
    expect(no.noData).toBe(true)
    expect(no.routeTo).toBe('person')
    const ref = (await post('/api/control-tower/ask', { question: 'Please release the billing block on 1368 and invoice it today' })).json() as { refused: boolean; routeTo: string }
    expect(ref).toMatchObject({ refused: true, routeTo: 'blocks' })
    const memo = await ctx.app.inject({ method: 'GET', url: '/api/control-tower/memo', headers: auth(cm) })
    expect(memo.headers['content-type']).toMatch(/markdown/)
    expect(memo.body).toMatch(/^# Close readiness · 2026-09/)
    const notes = (await get<{ route: string; body: string }[]>('/api/control-tower/notes'))
    expect(notes.map((n) => n.route).sort()).toEqual(['billing', 'blocks', 'cash', 'pod'])
    expect(notes.every((n) => /Information only/.test(n.body))).toBe(true)
    expect((await post('/api/control-tower/handover/shipped_not_billed:80609071')).statusCode).toBe(400)
  })
})
