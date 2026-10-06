import type { EventKind, L4Step } from './enums'
import type { Case, CaseEvent } from './schemas'

/**
 * Email threads. A case is one conversation: the first email creates it, a reply from the customer joins it.
 * Every message lives in the audit trail (an `intake` event with `followUp: true` for customer replies, a `status`
 * event with `replySent: true` for ours), so persistence and the timeline need nothing new.
 */

export interface ThreadMessage {
  id: string
  direction: 'in' | 'out'
  from: string
  at: string
  subject: string
  text: string
  attachments: { name: string; mimeType: string; url: string }[]
  /** Who sent our reply (a person), for outgoing messages. */
  actor: string | null
}

export interface ThreadMail {
  from: string
  subject: string
  text: string
  receivedAt: string
  attachments: { name: string; mimeType: string; url: string }[]
  messageId: string | null
  inReplyTo?: string | null
  references?: string[]
  sourceFile?: string | null
}

type AddEvent = (
  c: Case,
  kind: EventKind,
  title: string,
  detail?: Record<string, unknown>,
  l4Step?: L4Step | null,
  durationMs?: number | null,
) => CaseEvent

/** "Re: AW: Fwd: Damaged drums" → "damaged drums". */
export function threadSubject(subject: string): string {
  return subject
    .replace(/^\s*((re|aw|sv|antw|wg|fwd?|tr)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** True when the subject says it answers an earlier email. */
export function isReplySubject(subject: string): boolean {
  return /^\s*(re|aw|sv|antw)\s*(\[\d+\])?\s*:/i.test(subject)
}

/** "Jane Doe <Jane@Acme.com>" → "jane@acme.com". */
export function emailAddress(s: string): string {
  return (/<([^>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase()
}

/** "jane@acme.com" → "acme.com". */
export function emailDomain(s: string): string {
  return emailAddress(s).split('@')[1] ?? ''
}

/** True when the email comes from the customer's side: the same domain as the person who sent the complaint. */
export function fromCustomerSide(c: Pick<Case, 'from'>, from: string): boolean {
  const d = emailDomain(from)
  return !!d && d === emailDomain(c.from)
}

/** The new part of a reply: drops the quoted earlier message ("On … wrote:", "> …", Outlook headers). */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const cut = lines.findIndex(
    (l, i) =>
      /^\s*On .+wrote:\s*$/i.test(l) ||
      (/^\s*On .+/i.test(l) && /wrote:\s*$/i.test(lines[i + 1] ?? '')) ||
      /^\s*Am .+schrieb.+:\s*$/i.test(l) ||
      /^\s*-{2,}\s*(Original Message|Ursprüngliche Nachricht)\s*-{2,}/i.test(l) ||
      (/^\s*From:\s.+/i.test(l) && /^\s*(Sent|Date):\s/i.test(lines[i + 1] ?? '')),
  )
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).filter((l) => !/^\s*>/.test(l))
  return kept.join('\n').trim() || text.trim()
}

const isCustomerReply = (e: CaseEvent) => e.kind === 'intake' && e.detail.followUp === true
/** Our emails: the decision reply (`replySent`) and the messages sent in between (`messageSent`). */
const isOurReply = (e: CaseEvent) =>
  e.kind === 'status' && (e.detail.replySent === true || e.detail.messageSent === true)

/**
 * Events a re-run keeps: what happened outside the agent (emails, decisions, SAP writes, errors). The emails we sent
 * and the reopen markers stay too, so the conversation is complete and a reopened case can be answered again.
 */
export function keptOnRerun(e: CaseEvent): boolean {
  if (['intake', 'approval', 'sap_write', 'sap_release', 'error'].includes(e.kind)) return true
  return e.kind === 'status' && (isOurReply(e) || e.detail.reopened === true)
}

/** Message-IDs known for this case: the complaint, every customer reply and every reply we sent. */
export function threadMessageIds(c: Case): string[] {
  return c.events
    .filter((e) => e.kind === 'intake' || isOurReply(e))
    .map((e) => e.detail.messageId)
    .filter((m): m is string => typeof m === 'string' && m.length > 0)
    .map((m) => m.trim())
}

/**
 * The case an incoming email belongs to, if it answers one. By the email's reply headers first (In-Reply-To,
 * References); without them, a "Re:" subject from the same sender with the same subject. Otherwise undefined: a new case.
 */
export function findThreadCase(cases: Case[], mail: ThreadMail): Case | undefined {
  const refs = [mail.inReplyTo, ...(mail.references ?? [])]
    .filter((m): m is string => !!m)
    .map((m) => m.trim())
  if (refs.length) {
    const hit = cases.find((c) => threadMessageIds(c).some((id) => refs.includes(id)))
    if (hit) return hit
  }
  if (!isReplySubject(mail.subject)) return undefined
  const sender = emailAddress(mail.from)
  const subject = threadSubject(mail.subject)
  return cases
    .filter((c) => emailAddress(c.from) === sender && threadSubject(c.subject) === subject)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]
}

/**
 * Adds a reply to its case: from the customer, or from anyone else in the thread (a warehouse, a colleague, a carrier).
 * A case waiting for the customer (Pending) goes back to Open when the customer answers, so it is investigated again
 * with what they sent; in any other case the message is added and the status stays.
 */
export function addCustomerReply(c: Case, mail: ThreadMail, ev: AddEvent): { reopened: boolean } {
  c.attachments.push(...mail.attachments)
  const customer = fromCustomerSide(c, mail.from)
  ev(
    c,
    'intake',
    customer
      ? `Customer replied: ${mail.subject}`
      : `${senderName(mail.from)} wrote: ${mail.subject}`,
    {
      followUp: true,
      party: customer ? 'customer' : 'other',
      from: mail.from,
      subject: mail.subject,
      text: mail.text,
      receivedAt: mail.receivedAt,
      attachments: mail.attachments,
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo ?? null,
      channel: mail.sourceFile ? 'file' : 'mailbox',
    },
    '5.1.1',
  )
  // Only the customer's answer reopens a Pending case; a colleague or the warehouse writing in the thread does not.
  if (c.status !== 'needs_customer_input' || !customer) return { reopened: false }
  c.status = 'received'
  ev(c, 'status', 'The customer answered; back to Open', {
    from: 'needs_customer_input',
    to: 'received',
    reopened: true,
    actor: 'customer',
  })
  return { reopened: true }
}

/** The whole conversation, oldest first: the complaint, the customer's replies and ours. */
export function conversation(c: Case): ThreadMessage[] {
  const later = new Set(
    c.events
      .filter(isCustomerReply)
      .flatMap((e) => (e.detail.attachments as ThreadMessage['attachments'] | undefined) ?? [])
      .map((a) => a.url),
  )
  const first: ThreadMessage = {
    id: `${c.id}-complaint`,
    direction: 'in',
    from: c.from,
    at: c.receivedAt,
    subject: c.subject,
    text: c.bodyText,
    attachments: c.attachments.filter((a) => !later.has(a.url)),
    actor: null,
  }
  const rest = c.events.flatMap((e): ThreadMessage[] => {
    const d = e.detail
    if (isCustomerReply(e)) {
      return [
        {
          id: e.id,
          direction: 'in',
          from: String(d.from ?? c.from),
          at: String(d.receivedAt ?? e.at),
          subject: String(d.subject ?? ''),
          text: stripQuoted(String(d.text ?? '')),
          attachments: (d.attachments as ThreadMessage['attachments'] | undefined) ?? [],
          actor: null,
        },
      ]
    }
    if (isOurReply(e)) {
      return [
        {
          id: e.id,
          direction: 'out',
          from: String(d.from ?? ''),
          at: e.at,
          subject: String(d.subject ?? ''),
          text: String(d.text ?? ''),
          attachments: [],
          actor: typeof d.actor === 'string' ? d.actor : null,
        },
      ]
    }
    return []
  })
  return [first, ...rest]
}

/** What the agent reads: the complaint plus the new part of every customer reply, in order. */
export function complaintText(c: Case): string {
  const replies = c.events.filter(isCustomerReply).map((e) => {
    const day = String(e.detail.receivedAt ?? e.at).slice(0, 10)
    const who = fromCustomerSide(c, String(e.detail.from ?? c.from))
      ? 'Customer reply'
      : `Email from ${String(e.detail.from)}, not the customer`
    return `--- ${who}, ${day} ---\n${stripQuoted(String(e.detail.text ?? ''))}`
  })
  return [c.bodyText, ...replies].join('\n\n')
}

/** The Message-ID our next reply should answer: the customer's latest email in the thread. */
export function latestCustomerMessageId(c: Case): string | null {
  const e = [...c.events]
    .reverse()
    .find(
      (x) => x.kind === 'intake' && typeof x.detail.messageId === 'string' && x.detail.messageId,
    )
  return (e?.detail.messageId as string | undefined) ?? null
}

/** "Jane Doe <jane@acme.com>" → "Jane Doe"; a bare address → its local part. */
export function senderName(from: string): string {
  const name = from
    .replace(/<[^>]*>/, '')
    .replace(/"/g, '')
    .trim()
  return name && !name.includes('@') ? name : (emailAddress(from).split('@')[0] ?? from)
}

/** Someone writing in a case's conversation. Our own replies are one participant: the returns desk. */
export interface Participant {
  /** The email address, or "us" for our replies. */
  key: string
  name: string
  address: string | null
  side: 'customer' | 'us' | 'other'
  /** The sender's domain, e.g. "warehouse-north.example". */
  organisation: string | null
  messages: number
  lastAt: string
}

export function participantKey(m: Pick<ThreadMessage, 'direction' | 'from'>): string {
  return m.direction === 'out' ? 'us' : emailAddress(m.from)
}

/** Everyone who wrote in the conversation, in the order they first wrote. `customerFrom` is the complaint's sender. */
export function participants(messages: ThreadMessage[], customerFrom: string): Participant[] {
  const by = new Map<string, Participant>()
  for (const m of messages) {
    const key = participantKey(m)
    const p = by.get(key)
    if (p) {
      p.messages++
      if (m.at > p.lastAt) p.lastAt = m.at
      continue
    }
    by.set(
      key,
      m.direction === 'out'
        ? {
            key,
            name: 'Reclaim returns desk',
            address: null,
            side: 'us',
            organisation: null,
            messages: 1,
            lastAt: m.at,
          }
        : {
            key,
            name: senderName(m.from),
            address: emailAddress(m.from),
            side: fromCustomerSide({ from: customerFrom }, m.from) ? 'customer' : 'other',
            organisation: emailDomain(m.from) || null,
            messages: 1,
            lastAt: m.at,
          },
    )
  }
  return [...by.values()]
}
