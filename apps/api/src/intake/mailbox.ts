import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export interface InboundEmail {
  from: string
  subject: string
  receivedAt: string
  text: string
  attachments: { name: string; mimeType: string; url: string }[]
  messageId: string | null
  sourceFile: string | null
}

export interface MailboxConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  folder: string
  /** Safety sweep interval; push delivery does not depend on it. */
  pollMs: number
  /** Sender domains accepted. Empty means everyone. Others are marked seen and skipped. */
  allowedDomains: string[]
}

/** Reads IMAP_* or EMAIL_* variables (the team's Cloud Foundry scripts use EMAIL_*). EMAIL_ENABLED=false turns it off. */
export function mailboxConfigFromEnv(): MailboxConfig | null {
  const e = process.env
  const pick = (a: string, b: string) => e[a] ?? e[b]
  if ((e.EMAIL_ENABLED ?? 'true').toLowerCase() === 'false') return null
  const host = pick('IMAP_HOST', 'EMAIL_HOST')
  const user = pick('IMAP_USER', 'EMAIL_USER')
  const password = pick('IMAP_PASSWORD', 'EMAIL_PASSWORD')?.replace(/\s+/g, '') // Gmail shows app passwords with spaces
  if (!host || !user || !password) return null
  const domains = (pick('IMAP_ALLOWED_DOMAINS', 'EMAIL_ALLOWED_DOMAINS') ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
  return {
    host,
    port: Number(pick('IMAP_PORT', 'EMAIL_PORT') ?? 993),
    secure: (pick('IMAP_SECURE', 'EMAIL_SECURE') ?? 'true') !== 'false',
    user,
    password,
    folder: pick('IMAP_FOLDER', 'EMAIL_FOLDER') ?? 'INBOX',
    pollMs: Number(pick('IMAP_POLL_MS', 'EMAIL_POLL_MS') ?? 60000),
    allowedDomains: domains,
  }
}

/** True when the sender's domain is on the allowlist, or when there is no allowlist. */
export function senderAllowed(from: string, allowedDomains: string[]): boolean {
  if (!allowedDomains.length) return true
  const m = /@([\w.-]+)/.exec(from)
  const domain = m?.[1]?.toLowerCase() ?? ''
  return allowedDomains.some((d) => domain === d || domain.endsWith(`.${d}`))
}

/** Turns a parsed email into the shape the service ingests, saving image attachments to the uploads folder. */
export async function toInbound(mail: ParsedMail, uploadsDir: string, publicBase: string, sourceFile: string | null): Promise<InboundEmail> {
  await mkdir(uploadsDir, { recursive: true })
  const attachments: InboundEmail['attachments'] = []
  for (const a of mail.attachments ?? []) {
    if (!a.content?.length) continue
    const safe = `${Date.now().toString(36)}-${(a.filename ?? 'attachment').replace(/[^\w.-]+/g, '_')}`
    await writeFile(path.join(uploadsDir, safe), a.content)
    attachments.push({ name: a.filename ?? safe, mimeType: a.contentType || 'application/octet-stream', url: `${publicBase}/uploads/${safe}` })
  }
  const fromText = mail.from?.text ?? 'unknown sender'
  return {
    from: fromText,
    subject: mail.subject ?? '(no subject)',
    receivedAt: (mail.date ?? new Date()).toISOString(),
    text: (mail.text ?? '').trim() || stripHtml(mail.html || ''),
    attachments,
    messageId: mail.messageId ?? null,
    sourceFile,
  }
}

export async function parseEml(raw: string | Buffer, uploadsDir: string, publicBase: string, sourceFile: string | null): Promise<InboundEmail> {
  return toInbound(await simpleParser(raw), uploadsDir, publicBase, sourceFile)
}

function stripHtml(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
}

/**
 * Listens to an IMAP mailbox in push mode. One connection stays open; the server sends an EXISTS notification the
 * moment a message arrives (IMAP IDLE, handled by imapflow when the connection is inactive), and the listener fetches
 * the unseen messages right away, hands each to `onEmail`, and marks it seen. If the connection drops it reconnects,
 * and a slow safety sweep (every `pollMs`, at least 60 s) catches anything missed. Gmail: enable IMAP, two-step
 * verification and an app password.
 */
export class MailboxListener {
  private client: ImapFlow | null = null
  private stopped = false
  private lastMessageAt: string | null = null
  private lastError: string | null = null
  private draining: Promise<number> | null = null
  private sweep: NodeJS.Timeout | null = null
  constructor(
    private cfg: MailboxConfig,
    private onEmail: (mail: InboundEmail) => Promise<void>,
    private uploadsDir: string,
    private publicBase: string,
    private log: (msg: string) => void,
  ) {}

  start() {
    this.stopped = false
    void this.connectLoop()
    const every = Math.max(this.cfg.pollMs, 60000)
    this.sweep = setInterval(() => void this.drain('sweep'), every)
    this.log(`Mailbox listener: ${this.cfg.user}@${this.cfg.host}, push (IDLE) with a safety sweep every ${every / 1000}s`)
  }

  status() {
    return { address: this.cfg.user, connected: !!this.client?.usable, lastMessageAt: this.lastMessageAt, lastError: this.lastError }
  }

  stop() {
    this.stopped = true
    if (this.sweep) clearInterval(this.sweep)
    const c = this.client
    this.client = null
    if (c) void c.logout().catch(() => undefined)
  }

  private async connectLoop() {
    let backoff = 2000
    while (!this.stopped) {
      const client = new ImapFlow({ host: this.cfg.host, port: this.cfg.port, secure: this.cfg.secure, auth: { user: this.cfg.user, pass: this.cfg.password }, logger: false })
      const closed = new Promise<void>((resolve) => {
        client.once('close', () => resolve())
        client.once('error', (e: Error) => {
          this.lastError = e.message
          this.log(`Mailbox connection error: ${e.message}`)
          resolve()
        })
      })
      try {
        await client.connect()
        await client.mailboxOpen(this.cfg.folder)
        this.client = client
        backoff = 2000
        this.lastError = null
        this.log('Mailbox connected; waiting for new messages')
        client.on('exists', (ev: { count: number; prevCount: number }) => {
          if (ev.count > ev.prevCount) void this.drain('push')
        })
        await this.drain('connect')
        await closed // imapflow idles on its own while nothing else runs on the connection
      } catch (e) {
        this.lastError = (e as Error).message
        this.log(`Mailbox connect failed: ${(e as Error).message}`)
      }
      this.client = null
      if (this.stopped) return
      this.log(`Mailbox: reconnecting in ${backoff / 1000}s`)
      await new Promise((r) => setTimeout(r, backoff))
      backoff = Math.min(backoff * 2, 60000)
    }
  }

  /** Fetches every unseen message, ingests it and marks it seen. Serialised so push and sweep never overlap. */
  drain(reason: 'connect' | 'push' | 'sweep'): Promise<number> {
    if (this.draining) return this.draining
    this.draining = (async () => {
      const client = this.client
      if (!client || !client.usable) return 0
      let count = 0
      const lock = await client.getMailboxLock(this.cfg.folder)
      try {
        for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
          if (!msg.source) continue
          try {
            const mail = await parseEml(msg.source, this.uploadsDir, this.publicBase, null)
            if (!senderAllowed(mail.from, this.cfg.allowedDomains)) {
              this.log(`Mailbox: skipped a message from ${mail.from} (sender domain not allowed)`)
            } else {
              await this.onEmail(mail)
              this.lastMessageAt = new Date().toISOString()
              count++
            }
            await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true })
          } catch (e) {
            this.log(`Mailbox: could not ingest a message: ${(e as Error).message}`)
          }
        }
      } catch (e) {
        this.log(`Mailbox ${reason} fetch failed: ${(e as Error).message}`)
      } finally {
        lock.release()
      }
      if (count) this.log(`Mailbox: ${count} new complaint(s) ingested (${reason})`)
      return count
    })().finally(() => {
      this.draining = null
    })
    return this.draining
  }
}
