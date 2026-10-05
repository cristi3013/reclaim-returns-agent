import { useState } from 'react'
import { toast } from 'sonner'
import { Send } from 'lucide-react'
import { primaryProposal, type Case, type Role } from '@reclaim/shared'
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

/** Placeholder suggestion until the generated reply is wired in. */
const DUMMY_SUGGESTION = `Dear customer,

Thank you for contacting us about your order. We have reviewed your complaint and processed it according to our returns policy.

If you have any further questions, simply reply to this email.

Kind regards,
Customer Service`

/** The reply to the customer: a suggested answer to edit, then send by email in their thread. */
export function ReplyPanel({ c, role, actor }: { c: Case; role: Role; actor: string }) {
  const p = primaryProposal(c)
  const [text, setText] = useState(DUMMY_SUGGESTION)
  const [result, setResult] = useState<SendReplyResult | null>(null)
  const send = useSendReply()
  if (!p || !REPLY_STATUSES.includes(c.status)) return null

  const sent = c.events.find((e) => e.kind === 'status' && e.detail.replySent === true)
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

  return (
    <div className="mt-4">
      <textarea
        aria-label="Reply to the customer"
        className="min-h-40 w-full rounded-md border border-line bg-surface-2 p-3 text-sm leading-relaxed"
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
