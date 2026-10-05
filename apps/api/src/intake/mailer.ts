import nodemailer from 'nodemailer'

export interface OutboundEmail {
  to: string
  subject: string
  text: string
  /** Message-ID of the complaint, so the reply lands in the customer's thread. */
  inReplyTo?: string | null
}

export interface Mailer {
  /** The address replies are sent from. */
  from: string
  send(m: OutboundEmail): Promise<{ messageId: string }>
}

/**
 * Sends the customer reply. Resend over HTTPS when RESEND_API_KEY is set (works where SMTP ports are blocked),
 * otherwise SMTP: SMTP_* or, by default, the same Gmail account and app password the mailbox listener reads.
 */
export function mailerFromEnv(env = process.env): Mailer | null {
  if (env.REPLY_ENABLED === 'false') return null
  if (env.RESEND_API_KEY) {
    const from =
      env.REPLY_FROM ?? env.SMTP_USER ?? env.IMAP_USER ?? env.EMAIL_USER ?? 'onboarding@resend.dev'
    return new ResendMailer(env.RESEND_API_KEY, from)
  }
  const user = env.SMTP_USER ?? env.IMAP_USER ?? env.EMAIL_USER
  const pass = (env.SMTP_PASSWORD ?? env.IMAP_PASSWORD ?? env.EMAIL_PASSWORD)?.replace(/\s+/g, '')
  if (!user || !pass) return null
  const port = Number(env.SMTP_PORT ?? 465)
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST ?? 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  })
  const from = env.REPLY_FROM ?? user
  return {
    from,
    async send(m) {
      const info = await transport.sendMail({
        from,
        to: m.to,
        subject: m.subject,
        text: m.text,
        ...(m.inReplyTo ? { inReplyTo: m.inReplyTo, references: [m.inReplyTo] } : {}),
      })
      return { messageId: info.messageId }
    },
  }
}

class ResendMailer implements Mailer {
  constructor(
    private key: string,
    public from: string,
  ) {}

  async send(m: OutboundEmail) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [m.to],
        subject: m.subject,
        text: m.text,
        ...(m.inReplyTo
          ? { headers: { 'In-Reply-To': m.inReplyTo, References: m.inReplyTo } }
          : {}),
      }),
      signal: AbortSignal.timeout(20000),
    })
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
    if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message ?? res.statusText}`)
    return { messageId: body.id ?? '' }
  }
}
