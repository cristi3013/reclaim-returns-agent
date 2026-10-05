import nodemailer from 'nodemailer'

export interface OutboundEmail {
  to: string
  subject: string
  text: string
  /** Message-ID of the complaint, so the reply lands in the customer's thread. */
  inReplyTo?: string | null
  /** Every earlier Message-ID of the thread, oldest first. */
  references?: string[]
}

export interface Mailer {
  /** The address replies are sent from. */
  from: string
  send(m: OutboundEmail): Promise<{ messageId: string }>
}

/**
 * Sends the customer reply. SendGrid over HTTPS when SENDGRID_API_KEY is set (works where SMTP ports are
 * blocked; the sender must be verified in SendGrid), otherwise SMTP: SMTP_* or, by default, the same Gmail
 * account and app password the mailbox listener reads.
 */
export function mailerFromEnv(raw = process.env): Mailer | null {
  // `SMTP_USER=` in a .env file is an empty string, not unset: treat both the same so the fallbacks apply.
  const env = (k: string) => raw[k]?.trim() || undefined
  if (env('REPLY_ENABLED') === 'false') return null
  const key = env('SENDGRID_API_KEY')
  if (key) {
    const from = env('REPLY_FROM') ?? env('SMTP_USER') ?? env('IMAP_USER') ?? env('EMAIL_USER')
    return from ? new SendGridMailer(key, from, env('REPLY_FROM_NAME') ?? 'Reclaim Returns') : null
  }
  const user = env('SMTP_USER') ?? env('IMAP_USER') ?? env('EMAIL_USER')
  const pass = (env('SMTP_PASSWORD') ?? env('IMAP_PASSWORD') ?? env('EMAIL_PASSWORD'))?.replace(
    /\s+/g,
    '',
  )
  if (!user || !pass) return null
  const port = Number(env('SMTP_PORT') ?? 465)
  const transport = nodemailer.createTransport({
    host: env('SMTP_HOST') ?? 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  })
  const from = env('REPLY_FROM') ?? user
  return {
    from,
    async send(m) {
      const info = await transport.sendMail({
        from,
        to: m.to,
        subject: m.subject,
        text: m.text,
        ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: m.references?.length ? m.references : [m.inReplyTo] } : {}),
      })
      return { messageId: info.messageId }
    },
  }
}

/** "Name <a@b.com>" or "a@b.com" → SendGrid's {email, name}. */
export function parseAddress(s: string): { email: string; name?: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s)
  if (!m) return { email: s.trim() }
  return m[1] ? { email: m[2]!.trim(), name: m[1].trim() } : { email: m[2]!.trim() }
}

export class SendGridMailer implements Mailer {
  constructor(
    private key: string,
    public from: string,
    private fromName: string,
  ) {}

  async send(m: OutboundEmail) {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [parseAddress(m.to)] }],
        from: { email: this.from, name: this.fromName },
        reply_to: { email: this.from },
        subject: m.subject,
        content: [{ type: 'text/plain', value: m.text }],
        ...(m.inReplyTo
          ? { headers: { 'In-Reply-To': m.inReplyTo, References: (m.references?.length ? m.references : [m.inReplyTo]).join(' ') } }
          : {}),
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { errors?: { message?: string }[] }
      const why = body.errors?.map((e) => e.message).join('; ') || res.statusText
      throw new Error(`SendGrid ${res.status}: ${why}`)
    }
    // 202 Accepted with an empty body; the id is in a header.
    return { messageId: res.headers.get('x-message-id') ?? '' }
  }
}
