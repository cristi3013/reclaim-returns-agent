import { describe, it, expect, afterEach } from 'vitest'
import { conversation, primaryProposal, type Case, type CaseSummary } from '@reclaim/shared'
import { buildApp } from '../src/app'
import { headerVerifier } from '../src/auth'
import type { Mailer, OutboundEmail } from '../src/intake/mailer'

/** The test verifier reads `<role>:<name>` from the bearer token, so a body's actor and role become the caller. */
const auth = (body?: unknown) => {
  const b = (body ?? {}) as { role?: string; actor?: string }
  return b.role ? { authorization: `Bearer ${b.role}:${b.actor ?? 'Demo'}` } : {}
}
let ctx: ReturnType<typeof buildApp>
afterEach(async () => ctx.app.close())

const lead = { actor: 'Lead', role: 'customer_service_lead' as const }
const cm = { actor: 'Dana', role: 'credit_manager' as const }

function setup() {
  process.env.INBOUND_AUTORUN = 'false'
  const sent: OutboundEmail[] = []
  const mailer: Mailer = {
    from: 'reclaim@test',
    async send(e) {
      sent.push(e)
      return { messageId: `<out-${sent.length}@test>` }
    },
  }
  ctx = buildApp({
    verifier: headerVerifier(),
    mockDelayMs: 0,
    noSideCars: true,
    mailer,
    initialSettings: { aiMode: 'rules_only' },
  })
  const post = (url: string, body?: unknown) =>
    ctx.app.inject({ method: 'POST', url, headers: auth(body), ...(body ? { payload: body } : {}) })
  const theCase = async (id: string) =>
    (await ctx.app.inject({ method: 'GET', url: `/api/cases/${id}` })).json() as Case
  const count = async () =>
    ((await ctx.app.inject({ method: 'GET', url: '/api/cases' })).json() as CaseSummary[]).length
  return { post, theCase, count, sent }
}

const complaint = {
  from: 'Quality <quality@cust.example>',
  subject: 'Damaged drums',
  text: 'Two drums of material 54 arrived damaged. Please credit.',
  messageId: '<m1@test>',
}

/** No invoice named, so the rules set the case to Pending (R9); we ask the customer which invoice. */
async function pendingCase(t: ReturnType<typeof setup>) {
  const s = (await t.post('/api/inbound', complaint)).json() as CaseSummary
  await t.post(`/api/cases/${s.id}/run`)
  expect(
    (await t.post(`/api/cases/${s.id}/reply`, { ...lead, text: 'Which invoice was it?' }))
      .statusCode,
  ).toBe(200)
  expect((await t.theCase(s.id)).status).toBe('needs_customer_input')
  return s.id
}

describe('email threads', () => {
  it('a reply to a Pending case joins it, reopens it and the agent reads it', async () => {
    const t = setup()
    const id = await pendingCase(t)
    const before = await t.count()

    const res = await t.post('/api/inbound', {
      from: complaint.from,
      subject: 'Re: Re: Damaged drums',
      text: 'It was invoice 90000355.\n\nOn Mon, Reclaim wrote:\n> Which invoice was it?',
      messageId: '<m2@test>',
      inReplyTo: '<out-1@test>',
    })
    expect((res.json() as CaseSummary).id).toBe(id)
    expect(await t.count()).toBe(before)

    const c = await t.theCase(id)
    expect(c.status).toBe('received')
    expect(c.events.at(-1)).toMatchObject({
      kind: 'status',
      detail: { to: 'received', reopened: true },
    })
    expect(conversation(c).map((m) => [m.direction, m.text])).toEqual([
      ['in', complaint.text],
      ['out', expect.stringContaining('Which invoice was it?')],
      ['in', 'It was invoice 90000355.'],
    ])

    await t.post(`/api/cases/${id}/run`)
    expect((await t.theCase(id)).facts?.invoiceNumber).toBe('90000355')
  })

  it('without reply headers, a "Re:" from the same sender with the same subject still joins', async () => {
    const t = setup()
    const id = await pendingCase(t)
    const res = await t.post('/api/inbound', {
      from: 'quality@cust.example',
      subject: 'AW: Damaged drums',
      text: 'Invoice 90000355.',
      messageId: '<m3@test>',
    })
    expect((res.json() as CaseSummary).id).toBe(id)
  })

  it('a reply to a case that is not Pending is added and the status stays', async () => {
    const t = setup()
    const s = (
      await t.post('/api/inbound', { ...complaint, text: `Invoice 90000355: ${complaint.text}` })
    ).json() as CaseSummary
    await t.post(`/api/cases/${s.id}/run`)
    const status = (await t.theCase(s.id)).status
    expect(status).toBe('awaiting_approval')
    await t.post('/api/inbound', {
      from: complaint.from,
      subject: 'Re: Damaged drums',
      text: 'Any news?',
      messageId: '<m4@test>',
      inReplyTo: '<m1@test>',
    })
    const c = await t.theCase(s.id)
    expect(c.status).toBe(status)
    expect(conversation(c).at(-1)).toMatchObject({ direction: 'in', text: 'Any news?' })
  })

  it('a new subject or another sender opens a new case', async () => {
    const t = setup()
    const a = (await t.post('/api/inbound', complaint)).json() as CaseSummary
    const b = (
      await t.post('/api/inbound', {
        ...complaint,
        from: 'someone@else.example',
        subject: 'Re: Damaged drums',
        messageId: '<m5@test>',
      })
    ).json() as CaseSummary
    const c = (
      await t.post('/api/inbound', {
        ...complaint,
        subject: 'Damaged drums',
        messageId: '<m6@test>',
      })
    ).json() as CaseSummary
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
  })

  it('the reply after a customer answer goes to their latest email, with the whole thread in References', async () => {
    const t = setup()
    const id = await pendingCase(t)
    await t.post('/api/inbound', {
      from: complaint.from,
      subject: 'Re: Damaged drums',
      text: 'Invoice 90000355, 2 KG.',
      messageId: '<m7@test>',
      inReplyTo: '<out-1@test>',
    })
    await t.post(`/api/cases/${id}/run`)
    const p = primaryProposal(await t.theCase(id))!
    expect(
      (await t.post(`/api/proposals/${p.id}/reject`, { ...cm, comment: 'Not credited' }))
        .statusCode,
    ).toBe(204)
    await t.post(`/api/cases/${id}/reply`, { ...cm, text: 'We cannot credit this.' })
    expect(t.sent.at(-1)).toMatchObject({ inReplyTo: '<m7@test>' })
    expect(t.sent.at(-1)!.references).toEqual(
      expect.arrayContaining(['<m1@test>', '<out-1@test>', '<m7@test>']),
    )
  })

  it('no invoice means Pending; the warehouse writing in the thread does not reopen it, the customer naming the invoice does', async () => {
    const t = setup()
    const s = (
      await t.post('/api/inbound', {
        from: 'Labels <labels@cust.example>',
        subject: 'Wrong labels',
        text: 'The labels on the drums are wrong.',
        messageId: '<n1@test>',
      })
    ).json() as CaseSummary
    await t.post(`/api/cases/${s.id}/run`)
    expect((await t.theCase(s.id)).status).toBe('needs_customer_input')

    await t.post('/api/inbound', {
      from: 'Dock Team <dock@warehouse-north.example>',
      subject: 'Re: Wrong labels',
      text: 'We relabelled the remaining drums on our side.',
      messageId: '<n2@test>',
      inReplyTo: '<n1@test>',
    })
    let c = await t.theCase(s.id)
    expect(c.status).toBe('needs_customer_input')
    expect(c.events.some((e) => e.title === 'Dock Team wrote: Re: Wrong labels')).toBe(true)

    await t.post('/api/inbound', {
      from: 'Labels <labels@cust.example>',
      subject: 'Re: Wrong labels',
      text: 'It was invoice 90000355, 2 KG of material 54 damaged.',
      messageId: '<n3@test>',
      inReplyTo: '<n1@test>',
    })
    expect((await t.theCase(s.id)).status).toBe('received')
    await t.post(`/api/cases/${s.id}/run`)
    c = await t.theCase(s.id)
    expect(c.facts?.invoiceNumber).toBe('90000355')
    expect(c.status).toBe('awaiting_approval')
    expect(conversation(c).map((m) => m.from)).toEqual([
      'Labels <labels@cust.example>',
      'Dock Team <dock@warehouse-north.example>',
      'Labels <labels@cust.example>',
    ])
  })
})
