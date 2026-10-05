import { useState } from 'react'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { caseOutcome, currentReply, primaryProposal, type Case, type Role } from '@reclaim/shared'
import { useSendReply, type SendReplyResult } from '@/api'
import { Button } from '@/components/ui/button'

/** Statuses where a person has decided and the customer can be told. Mirrors Service.sendReply. */
const REPLY_STATUSES = [
  'written_to_sap',
  'closed',
  'needs_customer_input',
  'handed_over',
  'duplicate',
]

/** Placeholder suggestions until the generated reply is wired in. */
const DUMMY_SUGGESTION = `Dear customer,

Thank you for contacting us about your order. We have reviewed your complaint and processed it according to our returns policy.

If you have any further questions, simply reply to this email.

Kind regards,
Customer Service`

function rejectionSuggestion(c: Case): string {
  const reason = [...c.approvals]
    .reverse()
    .find((a) => a.decision === 'rejected')
    ?.comment.trim()
  return `Dear customer,

Thank you for contacting us${c.invoiceNumber ? ` about invoice ${c.invoiceNumber}` : ''}. We have carefully reviewed your complaint, and unfortunately we are unable to issue a credit or return in this case.${reason ? `\n\nReason: ${reason}` : ''}

If you have additional information or evidence, simply reply to this email and we will review it again.

Kind regards,
Customer Service`
}

/** Nothing in SAP to credit against: ask for the invoice number instead of a generic answer. */
function missingInvoiceSuggestion(c: Case): string {
  const named = c.facts?.invoiceNumber
  return `Dear customer,

Thank you for contacting us. ${
    named
      ? `We could not find invoice ${named} in our system.`
      : 'To look into your complaint, we need the invoice it relates to.'
  }

Could you please reply with the correct invoice number, the material and the quantity affected? A photo helps if goods arrived damaged. As soon as we have it, we will review your complaint.

Kind regards,
Customer Service`
}

function suggestion(c: Case): string {
  if (caseOutcome(c) === 'rejected') return rejectionSuggestion(c)
  const f = c.findings
  if (f && !f.invoice && f.candidateInvoices.length === 0) return missingInvoiceSuggestion(c)
  return DUMMY_SUGGESTION
}

/** The reply to the customer: a suggested answer to edit, then send by email in their thread. */
export function ReplyPanel(props: { c: Case; role: Role; actor: string }) {
  const { c } = props
  if (!primaryProposal(c) || !REPLY_STATUSES.includes(c.status)) return null
  // Keyed by status: the suggestion is chosen when the decision is made (approved or rejected), not before.
  return <ReplyForm key={`${c.status}:${caseOutcome(c)}`} {...props} />
}

/** What kind of answer this is, so a person sees at a glance whether the customer gets good or bad news. */
const TONE: Record<string, { label: string; cls: string }> = {
  written_to_sap: { label: 'Claim approved', cls: 'bg-ok-soft text-ok' },
  'closed:approved': { label: 'Approved, no SAP document', cls: 'bg-ok-soft text-ok' },
  'closed:rejected': { label: 'Claim rejected', cls: 'bg-bad-soft text-bad' },
  'closed:closed': { label: 'Case closed', cls: 'bg-surface-2 text-muted' },
  needs_customer_input: {
    label: 'More information needed',
    cls: 'bg-warn-soft text-warn',
  },
  handed_over: {
    label: 'Handed over to customer service',
    cls: 'bg-info-soft text-info',
  },
  duplicate: { label: 'Already in progress', cls: 'bg-surface-2 text-muted' },
}

function ReplyForm({ c, role, actor }: { c: Case; role: Role; actor: string }) {
  const [text, setText] = useState(() => suggestion(c))
  const [result, setResult] = useState<SendReplyResult | null>(null)
  const send = useSendReply()

  const sent = currentReply(c.events)
  const byEmail =
    c.events.some((e) => e.kind === 'intake' && e.detail.channel === 'mailbox') &&
    c.from.includes('@')

  if (sent) {
    return (
      <div className="mt-4 rounded-md border border-ok bg-ok-soft p-3 text-sm text-ok">
        Reply sent to {String(sent.detail.to)} by {String(sent.detail.actor)} at{' '}
        {new Date(sent.at).toLocaleTimeString()}.
      </div>
    )
  }

  const tone = TONE[c.status === 'closed' ? `closed:${caseOutcome(c)}` : c.status]
  return (
    <div className="mt-4">
      {tone && (
        <div className="mb-1.5 flex items-center gap-2 text-xs">
          <span className="font-semibold text-muted">Reply to the customer</span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${tone.cls}`}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {tone.label}
          </span>
        </div>
      )}
      <textarea
        aria-label="Reply to the customer"
        className="min-h-40 w-full rounded-md border border-line bg-surface p-3 text-sm leading-relaxed"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {byEmail && (
        <Button
          className="mt-2"
          disabled={send.isPending || !text.trim()}
          onClick={() =>
            send.mutate(
              { caseId: c.id, input: { actor, role, text } },
              {
                onSuccess: (r) => {
                  setResult(r)
                  if (r.ok) toast.success(`Reply sent to ${r.to}`)
                },
              },
            )
          }
        >
          <Send className="size-4" /> {send.isPending ? 'Sending…' : 'Send reply'}
        </Button>
      )}
      {result && !result.ok && (
        <div
          role="alert"
          className="mt-3 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad"
        >
          <div className="font-semibold">The reply was not sent · HTTP {result.status}</div>
          <div>{result.message}</div>
        </div>
      )}
    </div>
  )
}
