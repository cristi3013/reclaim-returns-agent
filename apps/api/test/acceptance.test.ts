import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EXPECTED, primaryProposal, type Case, type CaseSummary, type EvalResult, type SapDocument } from '@reclaim/shared'
import { buildApp } from '../src/app'

/**
 * The acceptance test: the backend must produce the organizers' expected decision for every demo case,
 * over HTTP, with the mock gateway and rules-only narration (no API key needed).
 * Run it against a real Claude key by setting ANTHROPIC_API_KEY and AI_MODE=assisted; decisions must not change.
 */
let ctx: ReturnType<typeof buildApp>
const cm = { actor: 'Demo', role: 'credit_manager' as const }

beforeEach(async () => {
  ctx = buildApp({ mockDelayMs: 0, initialSettings: { aiMode: process.env.AI_MODE === 'assisted' && process.env.ANTHROPIC_API_KEY ? 'assisted' : 'rules_only' } })
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

  it('every demo case matches expected-results.json', async () => {
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
    expect((await post(`/api/sap/${doc.id}/release`)).statusCode).toBe(200)
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

  it('guards: re-run after write is 409, lower role is 403, demo invoice in real mode is 400', async () => {
    await post('/api/cases/seed')
    await run('case-03')
    const p = primaryProposal(await theCase('case-03'))!
    expect((await post(`/api/proposals/${p.id}/approve`, { ...cm, editedQuantity: 20 })).statusCode).toBe(403)
    await ctx.app.inject({ method: 'PUT', url: '/api/settings', payload: { sapMode: 'real' } })
    expect((await post(`/api/proposals/${p.id}/approve`, { actor: 'FD', role: 'finance_director' })).statusCode).toBe(400)
    await ctx.app.inject({ method: 'PUT', url: '/api/settings', payload: { sapMode: 'mock' } })
    expect((await post(`/api/proposals/${p.id}/approve`, { actor: 'FD', role: 'finance_director' })).statusCode).toBe(200)
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
