import { describe, it, expect, afterEach } from 'vitest'
import { caseOutcome, primaryProposal, type Case, type CaseSummary } from '@reclaim/shared'
import { buildApp } from '../src/app'
import { headerVerifier } from '../src/auth'
import type { Mailer } from '../src/intake/mailer'

/** The test verifier reads `<role>:<name>` from the bearer token, so a body's actor and role become the caller. */
const auth = (body?: unknown) => {
  const b = (body ?? {}) as { role?: string; actor?: string }
  return b.role ? { authorization: `Bearer ${b.role}:${b.actor ?? 'Demo'}` } : {}
}
let ctx: ReturnType<typeof buildApp>
afterEach(async () => ctx.app.close())

const lead = { actor: 'Lead', role: 'customer_service_lead' as const }
const cm = { actor: 'Demo', role: 'credit_manager' as const }
const mailer: Mailer = { from: 'reclaim@test', send: async () => ({ messageId: '<out@test>' }) }

function setup() {
  process.env.INBOUND_AUTORUN = 'false'
  ctx = buildApp({ verifier: headerVerifier(), 
    mockDelayMs: 0,
    noSideCars: true,
    mailer,
    initialSettings: { aiMode: 'rules_only' },
  })
  const post = (url: string, body?: unknown) =>
    ctx.app.inject({ method: 'POST', url, headers: auth(body), ...(body ? { payload: body } : {}) })
  const theCase = async (id: string) =>
    (await ctx.app.inject({ method: 'GET', url: `/api/cases/${id}` })).json() as Case
  return { post, theCase }
}

const inbound = (invoice: string) => ({
  from: 'Quality <quality@cust.example>',
  subject: `Complaint on invoice ${invoice}`,
  text: `Invoice ${invoice}: 2 KG of material 54 arrived damaged. Please credit.`,
  messageId: '<m1@test>',
})

describe('change the status by hand', () => {
  it('Open, Pending and Closed as in a ticketing system, each with a reason in the trail', async () => {
    const { post, theCase } = setup()
    const s = (await post('/api/inbound', inbound('90009999'))).json() as CaseSummary
    await post(`/api/cases/${s.id}/run`)
    const p = primaryProposal(await theCase(s.id))!
    await post(`/api/proposals/${p.id}/reject`, { ...lead, comment: 'Not in SAP' })
    expect((await theCase(s.id)).status).toBe('closed')
    expect((await post(`/api/cases/${s.id}/reply`, { ...lead, text: 'No.' })).statusCode).toBe(200)

    const url = `/api/cases/${s.id}/status`
    const set = (to: string, comment = 'why') => post(url, { ...lead, to, comment })
    expect((await set('needs_customer_input', ' ')).statusCode).toBe(400)
    expect((await set('awaiting_approval')).statusCode).toBe(400)
    expect((await set('investigating')).statusCode).toBe(400)
    expect((await set('closed')).statusCode).toBe(409)

    // Pending: the customer's turn. The earlier decision stays; a new reply (the question) can go out.
    expect((await set('needs_customer_input', 'Asked for the invoice')).statusCode).toBe(204)
    const c = await theCase(s.id)
    expect(c.status).toBe('needs_customer_input')
    expect(c.approvals).toHaveLength(1)
    expect(c.events.at(-1)).toMatchObject({
      kind: 'status',
      detail: { from: 'closed', to: 'needs_customer_input', reopened: true, actor: 'Lead' },
    })
    expect(
      (await post(`/api/cases/${s.id}/reply`, { ...lead, text: 'Which invoice?' })).statusCode,
    ).toBe(200)

    // Open: our turn again. Run the agent, and it is back in the approvals queue.
    expect((await set('received', 'Customer answered')).statusCode).toBe(204)
    await post(`/api/cases/${s.id}/run`)
    expect((await theCase(s.id)).status).toBe('awaiting_approval')
    await post(`/api/proposals/${primaryProposal(await theCase(s.id))!.id}/approve`, lead)
    expect(caseOutcome(await theCase(s.id))).toBe('approved')

    // Closed by hand after the decision.
    expect((await set('received', 'Reopened')).statusCode).toBe(204)
    expect((await set('closed', 'Customer withdrew')).statusCode).toBe(204)
    expect((await theCase(s.id)).status).toBe('closed')
    expect(caseOutcome(await theCase(s.id))).toBe('closed')
  })

  it('never changes a case that has a SAP document, and needs the role that could decide', async () => {
    const { post, theCase } = setup()
    const s = (
      await post('/api/inbound', {
        ...inbound('90000355'),
        text: 'Invoice 90000355 charges 20 KG of material 54 but only 18 KG arrived. Please credit the 2 KG missing.',
      })
    ).json() as CaseSummary
    await post(`/api/cases/${s.id}/run`)
    const url = `/api/cases/${s.id}/status`
    // Taking a credit-manager case out of the approvals queue needs the credit manager.
    expect((await post(url, { ...lead, to: 'closed', comment: 'x' })).statusCode).toBe(403)
    const desk = { actor: 'Desk', role: 'returns_desk', to: 'needs_customer_input', comment: 'x' }
    expect((await post(url, desk)).statusCode).toBe(403)
    expect(
      (await post(url, { ...cm, to: 'needs_customer_input', comment: 'Ask' })).statusCode,
    ).toBe(204)
    expect((await post(url, { ...cm, to: 'received', comment: 'Answered' })).statusCode).toBe(204)
    await post(`/api/cases/${s.id}/run`)
    await post(`/api/proposals/${primaryProposal(await theCase(s.id))!.id}/approve`, cm)
    expect((await theCase(s.id)).status).toBe('written_to_sap')
    expect((await post(url, { ...cm, to: 'closed', comment: 'x' })).statusCode).toBe(409)
  })
})
