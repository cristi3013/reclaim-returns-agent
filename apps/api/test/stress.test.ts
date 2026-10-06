import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { approverFor, FIXTURES, primaryProposal, type Case, type CaseSummary, type Role, type SapDocument } from '@reclaim/shared'
import { buildApp, type AppOptions } from '../src/app'
import { headerVerifier } from '../src/auth'
import { MockGateway } from '../src/gateway/mock'
import type { Gateway } from '../src/gateway/types'

/**
 * End-to-end stress: bursts of complaints, every case run at once, races on approval and release,
 * every role against every proposal, and a gateway that fails part of the time. In-process, mock SAP,
 * rules-only reading: no model, no Supabase, no mailbox, no DS4. The invariants are the ones that
 * protect money; the timings are generous budgets, printed so a slowdown shows.
 */
const N = Number(process.env.STRESS_N ?? 240)
const ROLES: Role[] = ['returns_desk', 'customer_service_lead', 'credit_manager', 'finance_director']
const RANK: Record<Role, number> = { returns_desk: -1, customer_service_lead: 0, credit_manager: 1, finance_director: 2 }
const SAP_KINDS = new Set(['lookup', 'sap_write', 'sap_release'])

beforeAll(() => {
  process.env.INBOUND_AUTORUN = 'false'
})

let ctx: ReturnType<typeof buildApp>
afterEach(async () => ctx?.app.close())

async function start(extra: Partial<AppOptions> = {}) {
  ctx = buildApp({ verifier: headerVerifier(), mockDelayMs: 0, noSideCars: true, initialSettings: { aiMode: 'rules_only' }, ...extra })
  await ctx.app.ready()
}

const as = (role: Role, name = 'Stress') => ({ authorization: `Bearer ${role}:${name}` })
const post = (url: string, body?: unknown, role: Role = 'credit_manager') => ctx.app.inject({ method: 'POST', url, headers: as(role), ...(body ? { payload: body as object } : {}) })
const get = async <T>(url: string) => (await ctx.app.inject({ method: 'GET', url, headers: as('credit_manager') })).json() as T
const allCases = async () => Promise.all((await get<CaseSummary[]>('/api/cases')).map((s) => get<Case>(`/api/cases/${s.id}`)))

/** The seven demo complaints, sent N times in total with unique message ids: a realistic storm of repeat emails. */
const email = (i: number) => {
  const f = FIXTURES[i % FIXTURES.length]!
  return { from: f.from, subject: f.subject, text: f.bodyText, messageId: `<stress-${i}@reclaim.test>`, receivedAt: new Date(Date.UTC(2026, 9, 5, 8, 0, i % 3600)).toISOString() }
}

const ms = (t: number) => Math.round(performance.now() - t)
function p95(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0
}
const metrics: Record<string, string | number> = {}

/** Ingest N emails at once, then run every case at once. */
async function storm() {
  let t = performance.now()
  const res = await Promise.all(Array.from({ length: N }, (_, i) => post('/api/inbound', email(i))))
  metrics['intake ms'] = ms(t)
  expect(res.map((r) => r.statusCode).filter((c) => c !== 201)).toEqual([])
  const ids = res.map((r) => (r.json() as CaseSummary).id)
  t = performance.now()
  const runTimes: number[] = []
  const runs = await Promise.all(
    ids.map(async (id) => {
      const s = performance.now()
      const r = await post(`/api/cases/${id}/run`)
      runTimes.push(ms(s))
      return r.statusCode
    }),
  )
  metrics['run all ms'] = ms(t)
  metrics['run p95 ms'] = p95(runTimes)
  return { ids, runs }
}

describe(`stress, ${N} complaints`, () => {
  it('intake burst: every email becomes one case, a resend of the same message is ignored', { timeout: 120000 }, async () => {
    await start()
    const { ids } = await storm()
    expect(new Set(ids).size).toBe(N)
    const again = await Promise.all(Array.from({ length: 50 }, (_, i) => post('/api/inbound', email(i))))
    expect(again.every((r) => r.statusCode === 200 && (r.json() as { duplicate?: boolean }).duplicate === true)).toBe(true)
    expect(await get<CaseSummary[]>('/api/cases')).toHaveLength(N)
  })

  it('every case run at once ends in a valid state, and every money decision keeps the policy invariants', { timeout: 180000 }, async () => {
    await start()
    const { runs } = await storm()
    expect(runs.filter((c) => c !== 204)).toEqual([])
    const cases = await allCases()
    expect(cases.filter((c) => c.status === 'received' || c.status === 'investigating').map((c) => c.id)).toEqual([])
    for (const c of cases) {
      for (const p of c.proposals) {
        const d = p.decision
        const inv = c.findings?.invoice
        const line = inv?.items.find((x) => x.material === d.material) ?? inv?.items[0]
        expect(d.quantity, `${c.id} quantity`).toBeGreaterThanOrEqual(0)
        expect(d.amount, `${c.id} amount`).toBeGreaterThanOrEqual(0)
        if (line) expect(d.quantity, `${c.id} quantity above invoiced`).toBeLessThanOrEqual(line.quantity)
        if (inv) expect(d.amount, `${c.id} amount above invoice`).toBeLessThanOrEqual(inv.totalNetAmount + 0.005)
        if (d.documentType !== 'NONE') expect(d.approverRole, `${c.id} approver`).toBe(approverFor(d.amount, d.ruleId))
      }
      for (const e of c.events) if (SAP_KINDS.has(e.kind)) expect(e.l4Step, `${c.id} ${e.title} has no L4 step`).not.toBeNull()
      expect(c.sapDocuments, `${c.id} wrote to SAP without an approval`).toHaveLength(0)
    }
    metrics['statuses'] = Object.entries(cases.reduce<Record<string, number>>((m, c) => ((m[c.status] = (m[c.status] ?? 0) + 1), m), {}))
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')
  })

  it('approving every proposal at once never credits one invoice line twice', { timeout: 180000 }, async () => {
    await start()
    await storm()
    const waiting = (await allCases()).filter((c) => c.status === 'awaiting_approval')
    expect(waiting.length).toBeGreaterThan(0)
    const t = performance.now()
    const res = await Promise.all(waiting.map((c) => post(`/api/proposals/${primaryProposal(c)!.id}/approve`, { actor: 'FD', role: 'finance_director' }, 'finance_director')))
    metrics['approve all ms'] = ms(t)
    expect(res.filter((r) => r.statusCode >= 500).map((r) => r.body)).toEqual([])
    const docs = (await allCases()).flatMap((c) => c.sapDocuments.map((d) => ({ d, c })))
    const perLine = new Map<string, number>()
    for (const { d } of docs) {
      const ref = String(d.payload.ReferenceSDDocument ?? (d.payload.to_Item as { ReferenceSDDocument?: string }[] | undefined)?.[0]?.ReferenceSDDocument ?? '?')
      const key = `${d.type} ${ref}`
      perLine.set(key, (perLine.get(key) ?? 0) + 1)
    }
    metrics['documents'] = [...perLine].map(([k, v]) => `${k} ×${v}`).join(', ')
    expect([...perLine].filter(([, n]) => n > 1)).toEqual([])
  })

  it('the same proposal approved 25 times at once is written once; the same document released 10 times is released once', { timeout: 60000 }, async () => {
    await start()
    await post('/api/cases/seed')
    await post('/api/cases/case-03/run')
    const p = primaryProposal(await get<Case>('/api/cases/case-03'))!
    const res = await Promise.all(Array.from({ length: 25 }, () => post(`/api/proposals/${p.id}/approve`, { actor: 'FD', role: 'finance_director' }, 'finance_director')))
    expect(res.filter((r) => r.statusCode === 200)).toHaveLength(1)
    expect(res.filter((r) => r.statusCode >= 500)).toHaveLength(0)
    const k = await get<Case>('/api/cases/case-03')
    expect(k.sapDocuments).toHaveLength(1)
    const doc = k.sapDocuments[0] as SapDocument
    const rel = await Promise.all(Array.from({ length: 10 }, () => post(`/api/sap/${doc.id}/release`, { actor: 'FD', role: 'finance_director' }, 'finance_director')))
    expect(rel.filter((r) => r.statusCode === 200)).toHaveLength(1)
    expect((await get<Case>('/api/cases/case-03')).events.filter((e) => e.kind === 'sap_release')).toHaveLength(1)
  })

  it('role matrix: a role below the required approver is refused and writes nothing; the required role succeeds', { timeout: 60000 }, async () => {
    await start()
    await post('/api/cases/seed')
    await post('/api/cases/run-all')
    const waiting = (await allCases()).filter((c) => c.status === 'awaiting_approval')
    expect(waiting.length).toBeGreaterThan(0)
    for (const c of waiting) {
      const p = primaryProposal(c)!
      const need = p.decision.approverRole
      for (const role of ROLES.filter((r) => need && RANK[r] < RANK[need])) {
        const r = await post(`/api/proposals/${p.id}/approve`, { actor: role, role }, role)
        expect(r.statusCode, `${c.id} approved by ${role}, needs ${need}`).toBe(403)
      }
      expect((await get<Case>(`/api/cases/${c.id}`)).sapDocuments, `${c.id} wrote after a 403`).toHaveLength(0)
      const ok = await post(`/api/proposals/${p.id}/approve`, { actor: need, role: need }, need ?? 'credit_manager')
      expect(ok.statusCode, `${c.id} by ${need}: ${ok.body}`).toBe(200)
    }
    const noToken = await ctx.app.inject({ method: 'POST', url: `/api/proposals/x/approve`, headers: { authorization: 'Bearer invalid' }, payload: {} })
    expect(noToken.statusCode).toBe(401)
  })

  it('a gateway that fails 30% of the time: no crash, no stuck case, no document without an approval', { timeout: 180000 }, async () => {
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const flaky = (inner: Gateway): Gateway =>
      new Proxy(inner, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv)
          if (typeof v !== 'function' || !['getInvoice', 'checkExistingCredits', 'findInvoices', 'getAgreedPrice', 'getPlantCompanyCode'].includes(String(prop))) return v
          return async (...args: unknown[]) => {
            if (rnd() < 0.3) throw Object.assign(new Error('Gateway unavailable (stress)'), { status: 503 })
            return v.apply(target, args)
          }
        },
      })
    const mock = new MockGateway({ simulateConflict: () => false, delayMs: 0 })
    const gw = flaky(mock)
    await start({ gateway: () => gw })
    const { runs } = await storm()
    expect(runs.filter((c) => c >= 500 && c !== 503)).toEqual([])
    const cases = await allCases()
    expect(cases.filter((c) => c.status === 'investigating').map((c) => c.id)).toEqual([])
    expect(cases.flatMap((c) => c.sapDocuments)).toHaveLength(0)
    metrics['failed runs'] = runs.filter((c) => c !== 204).length
    metrics['cases with an error event'] = cases.filter((c) => c.events.some((e) => e.kind === 'error')).length
    expect((await ctx.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200)
  })

  it('analytics and the case list stay fast with every case loaded', { timeout: 120000 }, async () => {
    await start()
    await storm()
    let t = performance.now()
    expect((await ctx.app.inject({ method: 'GET', url: '/api/analytics/summary', headers: as('credit_manager') })).statusCode).toBe(200)
    metrics['analytics ms'] = ms(t)
    t = performance.now()
    await get<CaseSummary[]>('/api/cases')
    metrics['case list ms'] = ms(t)
    expect(Number(metrics['analytics ms'])).toBeLessThan(2000)
    expect(Number(metrics['case list ms'])).toBeLessThan(1000)
    console.log('\nStress metrics\n' + Object.entries(metrics).map(([k, v]) => `  ${k.padEnd(28)} ${v}`).join('\n'))
  })
})
