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
  pollMs: number
}

export function mailboxConfigFromEnv(): MailboxConfig | null {
  const { IMAP_HOST, IMAP_USER, IMAP_PASSWORD } = process.env
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASSWORD) return null
  return {
    host: IMAP_HOST,
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: process.env.IMAP_SECURE !== 'false',
    user: IMAP_USER,
    password: IMAP_PASSWORD,
    folder: process.env.IMAP_FOLDER ?? 'INBOX',
    pollMs: Number(process.env.IMAP_POLL_MS ?? 20000),
  }
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
 * Polls an IMAP mailbox for unseen messages and hands each one to `onEmail`. Marks them seen afterwards.
 * Gmail: enable IMAP, two-step verification and an app password. Runs forever until `stop()`.
 */
export class MailboxPoller {
  private timer: NodeJS.Timeout | null = null
  private busy = false
  constructor(
    private cfg: MailboxConfig,
    private onEmail: (mail: InboundEmail) => Promise<void>,
    private uploadsDir: string,
    private publicBase: string,
    private log: (msg: string) => void,
  ) {}

  start() {
    void this.poll()
    this.timer = setInterval(() => void this.poll(), this.cfg.pollMs)
    this.log(`Mailbox poller: ${this.cfg.user}@${this.cfg.host} every ${this.cfg.pollMs / 1000}s`)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  async poll(): Promise<number> {
    if (this.busy) return 0
    this.busy = true
    let count = 0
    const client = new ImapFlow({ host: this.cfg.host, port: this.cfg.port, secure: this.cfg.secure, auth: { user: this.cfg.user, pass: this.cfg.password }, logger: false })
    try {
      await client.connect()
      const lock = await client.getMailboxLock(this.cfg.folder)
      try {
        for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
          if (!msg.source) continue
          try {
            const mail = await parseEml(msg.source, this.uploadsDir, this.publicBase, null)
            await this.onEmail(mail)
            await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true })
            count++
          } catch (e) {
            this.log(`Mailbox: could not ingest a message: ${(e as Error).message}`)
          }
        }
      } finally {
        lock.release()
      }
      await client.logout()
    } catch (e) {
      this.log(`Mailbox poll failed: ${(e as Error).message}`)
      try {
        await client.logout()
      } catch {
        /* already closed */
      }
    } finally {
      this.busy = false
    }
    return count
  }
}
