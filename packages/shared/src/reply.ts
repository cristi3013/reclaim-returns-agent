import { STATUS_LABELS } from './enums'
import { currentReply } from './rules'
import { isGrounded } from './root-causes'
import { caseOutcome, primaryProposal, type Case } from './schemas'
import { conversation, fromCustomerSide, senderName, type ThreadMessage } from './thread'

/**
 * Replying to the customer. Two kinds of email leave a case:
 * - the decision reply, once a person has approved or rejected: sent once, with the SAP reference;
 * - a message, at any time and as often as needed: a question, an acknowledgement, a follow-up. It promises nothing.
 * The suggestion reads every email exchanged with the customer about the invoice. Code says what was decided;
 * the model only words it, and a suggestion with a number that is in none of the emails or facts is not used.
 */

/** Statuses where a person has decided and the customer can be told. */
export const REPLY_STATUSES = [
  'written_to_sap',
  'closed',
  'needs_customer_input',
  'handed_over',
  'duplicate',
] as const

export type ReplyKind = 'decision' | 'message'

/** The decision reply is due: a person decided and the customer has not been told yet. */
export function decisionReplyDue(c: Case): boolean {
  return (
    !!primaryProposal(c) &&
    (REPLY_STATUSES as readonly string[]).includes(c.status) &&
    !currentReply(c.events)
  )
}

export interface HistoryMessage extends ThreadMessage {
  caseId: string
}

/** Every email with this customer about this invoice, oldest first: this thread and those of the other cases on it. */
export function customerHistory(c: Case, all: Case[]): HistoryMessage[] {
  const related = all.filter(
    (x) =>
      x.id === c.id ||
      (!!c.invoiceNumber && x.invoiceNumber === c.invoiceNumber && fromCustomerSide(c, x.from)),
  )
  if (!related.some((x) => x.id === c.id)) related.push(c)
  return related
    .flatMap((x) => conversation(x).map((m) => ({ ...m, caseId: x.id })))
    .sort((a, b) => a.at.localeCompare(b.at))
}

export interface ReplySuggestion {
  text: string
  kind: ReplyKind
  /** Who wrote the wording: the model, or the template when there is no model or its wording failed the check. */
  by: 'model' | 'template'
  /** How many emails it read. */
  emails: number
  note: string | null
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

/** Whom the reply greets: the person's name when the address has one, otherwise their company. */
function greeting(c: Case) {
  const name = senderName(c.from)
  return name && !name.includes('@') ? `Dear ${name},` : 'Dear customer,'
}

/** What code knows about the case, in plain lines: the only source the reply may state as fact. */
export function replyFacts(c: Case): string[] {
  const p = primaryProposal(c)
  const d = p?.decision
  const doc = c.sapDocuments[c.sapDocuments.length - 1]
  const lines = [
    `Case ${c.id}, status: ${STATUS_LABELS[c.status]}.`,
    c.invoiceNumber ? `Invoice: ${c.invoiceNumber}.` : 'No invoice number known yet.',
  ]
  if (c.facts?.material) lines.push(`Material: ${c.facts.material}.`)
  if (c.facts?.claimedQuantity != null)
    lines.push(`Quantity claimed: ${c.facts.claimedQuantity} ${c.facts.unit ?? ''}`.trim() + '.')
  const outcome = caseOutcome(c)
  if (c.status === 'written_to_sap' && d && doc)
    lines.push(
      `Approved. ${doc.type === 'YRE' ? 'Return order' : 'Credit memo request'} ${doc.number}` +
        (d.amount ? ` for ${d.amount} ${d.currency}` : '') +
        '.',
    )
  else if (outcome === 'rejected') {
    const reason = [...c.approvals]
      .reverse()
      .find((a) => a.decision === 'rejected')
      ?.comment.trim()
    lines.push(`Rejected: no credit and no return.${reason ? ` Reason: ${reason}` : ''}`)
  } else if (outcome === 'approved') lines.push('Approved, no SAP document needed.')
  else if (c.status === 'needs_customer_input')
    lines.push(
      c.facts?.invoiceNumber && !c.findings?.invoice
        ? `Waiting for the customer: invoice ${c.facts.invoiceNumber} was not found; ask for the correct invoice number.`
        : 'Waiting for the customer: ask for the invoice number, the material and the quantity affected.',
    )
  else if (c.status === 'handed_over') lines.push('Handed over to a colleague in customer service.')
  else if (c.status === 'duplicate') lines.push('Already being handled in another case.')
  else
    lines.push(
      'Not decided yet: under review. Do not promise a credit, a return or an amount, and do not say it is approved.',
    )
  return lines
}

/** The prompt for the model: the facts code computed and the whole email history, oldest first. */
export function replyPrompt(c: Case, history: HistoryMessage[], kind: ReplyKind): string {
  const emails = history
    .map((m) => {
      const who =
        m.direction === 'out'
          ? `Us (${m.actor ?? 'returns desk'})`
          : fromCustomerSide(c, m.from)
            ? `Customer ${m.from}`
            : `${m.from}, not the customer`
      return `--- ${who}, ${m.at.slice(0, 10)}, case ${m.caseId} ---\n${m.text.trim()}`
    })
    .join('\n\n')
  return [
    `Write the ${kind === 'decision' ? 'reply that tells the customer the decision' : 'next email to the customer'}, to ${c.from}.`,
    'FACTS (computed by code; the only facts you may state)',
    ...replyFacts(c).map((l) => `- ${l}`),
    '',
    `EMAILS ABOUT THIS INVOICE WITH THIS CUSTOMER, oldest first (${history.length})`,
    emails,
  ].join('\n')
}

/** The suggestion without a model: a greeting, an acknowledgement of their latest email, and what the facts say. */
export function templateReply(c: Case, history: HistoryMessage[], kind: ReplyKind): string {
  const p = primaryProposal(c)
  const outcome = caseOutcome(c)
  const theirs = history.filter((m) => m.direction === 'in' && fromCustomerSide(c, m.from))
  const latest = theirs[theirs.length - 1]
  const ours = history.filter((m) => m.direction === 'out').length
  const about = c.invoiceNumber ? ` about invoice ${c.invoiceNumber}` : ''
  const thanks =
    theirs.length > 1 && latest
      ? `Thank you for your email of ${day(latest.at)}${about}, and for the information you have sent us so far.`
      : `Thank you for contacting us${about}.`

  let body: string
  let closing = 'If you have any further questions, simply reply to this email.'
  if (kind === 'decision' && outcome === 'rejected') {
    const reason = [...c.approvals]
      .reverse()
      .find((a) => a.decision === 'rejected')
      ?.comment.trim()
    body = `We have carefully reviewed your complaint, and unfortunately we are unable to issue a credit or return in this case.${reason ? `\n\nReason: ${reason}` : ''}`
    closing =
      'If you have additional information or evidence, simply reply to this email and we will review it again.'
  } else if (c.status === 'needs_customer_input') {
    const named = c.facts?.invoiceNumber
    body = `${named && !c.findings?.invoice ? `We could not find invoice ${named} in our system.` : 'To look into your complaint, we need the invoice it relates to.'}\n\nCould you please reply with the correct invoice number, the material and the quantity affected? A photo helps if goods arrived damaged.`
    closing = 'As soon as we have it, we will review your complaint.'
  } else if (kind === 'decision' && p?.replyDraft && outcome !== 'closed') return p.replyDraft
  else if (c.status === 'handed_over')
    body =
      'A colleague in customer service is looking into your request and will contact you directly.'
  else if (c.status === 'duplicate')
    body = 'We are already handling this complaint in an earlier case; you will hear from us there.'
  else if (kind === 'message' && c.status === 'written_to_sap')
    body = 'Your claim has been approved; the reference is in our previous email.'
  else
    body = `We have received your ${ours ? 'message' : 'complaint'} and are reviewing it. We will come back to you as soon as we have a decision.`
  return `${greeting(c)}\n\n${thanks} ${body}\n\n${closing}\n\nKind regards,\nCustomer Service`
}

/** True when every number in the wording is in the facts or the emails. */
export function replyGrounded(text: string, c: Case, history: HistoryMessage[]): boolean {
  const source = [
    ...replyFacts(c),
    c.from,
    ...history.map((m) => `${m.from} ${m.at} ${m.subject} ${m.text}`),
    ...history.map((m) => day(m.at)),
  ].join('\n')
  return isGrounded(text, source)
}
