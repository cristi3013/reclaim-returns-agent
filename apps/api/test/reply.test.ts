import { describe, it, expect, afterEach, vi } from 'vitest'
import { primaryProposal, type Case, type CaseSummary, type SapDocument } from '@reclaim/shared'
import { buildApp } from '../src/app'
import { mailerFromEnv, parseAddress, type Mailer, type OutboundEmail } from '../src/intake/mailer'

const cm = { actor: 'Demo', role: 'credit_manager' as const }
let ctx: ReturnType<typeof buildApp>
afterEach(async () => ctx.app.close())

function setup(mailer: Mailer | null) {
  process.env.INBOUND_AUTORUN = 'false'
  ctx = buildApp({
    mockDelayMs: 0,
    noSideCars: true,
    mailer,
    initialSettings: { aiMode: 'rules_only' },
  })
  const post = (url: string, body?: unknown) =>
    ctx.app.inject({ method: 'POST', url, ...(body ? { payload: body } : {}) })
  const theCase = async (id: string) =>
    (await ctx.app.inject({ method: 'GET', url: `/api/cases/${id}` })).json() as Case
  return { post, theCase }
}

function fakeMailer(fail = false) {
  const sent: OutboundEmail[] = []
  const m: Mailer = {
    from: 'reclaim@test',
    async send(e) {
      if (fail) throw new Error('connection refused')
      sent.push(e)
      return { messageId: `<out-${sent.length}@test>` }
    },
  }
  return { m, sent }
}

const complaint = {
  from: 'Quality, Cust DE 1 <quality@cust-de-1.example>',
  subject: 'Short delivery – invoice 90000355',
  text: 'Invoice 90000355 charges 20 KG of material 54 but only 18 KG arrived. Please credit the 2 KG missing.',
  messageId: '<m1@test>',
}

describe('send the reply to the customer', () => {
  it('only after approval, once, in the thread, with the SAP reference', async () => {
    const { m, sent } = fakeMailer()
    const { post, theCase } = setup(m)
    const s = (await post('/api/inbound', complaint)).json() as CaseSummary
    await post(`/api/cases/${s.id}/run`)

    const early = await post(`/api/cases/${s.id}/reply`, cm)
    expect(early.statusCode).toBe(409)
    expect(sent).toHaveLength(0)

    const p = primaryProposal(await theCase(s.id))!
    const doc = (await post(`/api/proposals/${p.id}/approve`, cm)).json() as SapDocument
    const res = await post(`/api/cases/${s.id}/reply`, {
      ...cm,
      text: 'Dear customer, we credit the 2 KG.',
    })
    expect(res.statusCode).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      to: complaint.from,
      subject: `Re: ${complaint.subject}`,
      inReplyTo: '<m1@test>',
    })
    expect(sent[0]!.text).toContain('Dear customer, we credit the 2 KG.')
    expect(sent[0]!.text).toContain(doc.number)

    const c = await theCase(s.id)
    expect(c.events.find((e) => e.detail.replySent === true)).toMatchObject({
      kind: 'status',
      detail: { to: complaint.from, actor: 'Demo', messageId: '<out-1@test>' },
    })
    expect((await post(`/api/cases/${s.id}/reply`, cm)).statusCode).toBe(409)
    expect(sent).toHaveLength(1)
  })

  it('refused for demo cases that did not arrive by email, and without a mailer', async () => {
    const { m, sent } = fakeMailer()
    const { post, theCase } = setup(m)
    await post('/api/cases/seed')
    await post('/api/cases/case-03/run')
    const p = primaryProposal(await theCase('case-03'))!
    await post(`/api/proposals/${p.id}/approve`, cm)
    expect((await post('/api/cases/case-03/reply', cm)).statusCode).toBe(400)
    expect(sent).toHaveLength(0)
    await ctx.app.close()

    const none = setup(null)
    const s = (await none.post('/api/inbound', complaint)).json() as CaseSummary
    expect((await none.post(`/api/cases/${s.id}/reply`, cm)).statusCode).toBe(503)
  })

  it('a failed send is recorded and can be retried', async () => {
    const { m } = fakeMailer(true)
    const { post, theCase } = setup(m)
    const s = (await post('/api/inbound', complaint)).json() as CaseSummary
    await post(`/api/cases/${s.id}/run`)
    await post(`/api/proposals/${primaryProposal(await theCase(s.id))!.id}/approve`, cm)
    const res = await post(`/api/cases/${s.id}/reply`, cm)
    expect(res.statusCode).toBe(502)
    const c = await theCase(s.id)
    expect(
      c.events.some((e) => e.kind === 'error' && e.title.startsWith('Sending the reply')),
    ).toBe(true)
    expect(c.events.some((e) => e.detail.replySent === true)).toBe(false)
  })
})

describe('mailer config', () => {
  it('reuses the mailbox credentials for SMTP, prefers SendGrid when keyed, off when disabled', () => {
    expect(mailerFromEnv({})).toBeNull()
    expect(mailerFromEnv({ EMAIL_USER: 'a@gmail.com', EMAIL_PASSWORD: 'abcd efgh' })?.from).toBe(
      'a@gmail.com',
    )
    expect(mailerFromEnv({ SENDGRID_API_KEY: 'k', REPLY_FROM: 'r@x.com' })?.from).toBe('r@x.com')
    const blanks = {
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      SENDGRID_API_KEY: '',
    }
    expect(mailerFromEnv({ ...blanks, IMAP_USER: 'a@gmail.com', IMAP_PASSWORD: 'p' })?.from).toBe(
      'a@gmail.com',
    )
    expect(
      mailerFromEnv({ IMAP_USER: 'a@gmail.com', IMAP_PASSWORD: 'p', REPLY_ENABLED: 'false' }),
    ).toBeNull()
  })
})

describe('SendGrid', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the reply from the verified sender, to the customer, in their thread', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(null, { status: 202, headers: { 'x-message-id': 'sg-1' } }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const m = mailerFromEnv({
      SENDGRID_API_KEY: 'SG.k',
      REPLY_FROM: 'o2chackathon@gmail.com',
      IMAP_USER: 'x@gmail.com',
      IMAP_PASSWORD: 'p',
    })!
    expect(m.from).toBe('o2chackathon@gmail.com')
    const r = await m.send({
      to: 'Gabriel <g@deloittece.com>',
      subject: 'Re: x',
      text: 'hello',
      inReplyTo: '<m1@test>',
    })
    expect(r.messageId).toBe('sg-1')
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.sendgrid.com/v3/mail/send')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer SG.k')
    expect(JSON.parse(init.body as string)).toMatchObject({
      personalizations: [{ to: [{ email: 'g@deloittece.com', name: 'Gabriel' }] }],
      from: { email: 'o2chackathon@gmail.com' },
      subject: 'Re: x',
      content: [{ type: 'text/plain', value: 'hello' }],
      headers: { 'In-Reply-To': '<m1@test>', References: '<m1@test>' },
    })
  })

  it('reports SendGrid errors', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            errors: [{ message: 'The from address does not match a verified Sender Identity.' }],
          }),
          { status: 403 },
        ),
    )
    const m = mailerFromEnv({ SENDGRID_API_KEY: 'SG.k', REPLY_FROM: 'a@b.com' })!
    await expect(m.send({ to: 'c@d.com', subject: 's', text: 't' })).rejects.toThrow(
      'SendGrid 403: The from address does not match a verified Sender Identity.',
    )
  })

  it('parseAddress', () => {
    expect(parseAddress('"Quality, Cust DE 1" <q@x.com>')).toEqual({
      email: 'q@x.com',
      name: 'Quality, Cust DE 1',
    })
    expect(parseAddress('q@x.com')).toEqual({ email: 'q@x.com' })
    expect(parseAddress('<q@x.com>')).toEqual({ email: 'q@x.com' })
  })
})
