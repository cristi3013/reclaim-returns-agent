import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, Send } from 'lucide-react'
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

/** The reply to the customer: edit, then send it by email in their thread, or copy it. */
export function ReplyPanel({ c, role, actor }: { c: Case; role: Role; actor: string }) {
  const p = primaryProposal(c)
  const [text, setText] = useState(p?.replyDraft ?? '')
  const [result, setResult] = useState<SendReplyResult | null>(null)
  const send = useSendReply()
  if (!p || !REPLY_STATUSES.includes(c.status)) return null

  const sent = c.events.find((e) => e.kind === 'status' && e.detail.replySent === true)
  const byEmail =
    c.events.some((e) => e.kind === 'intake' && e.detail.channel === 'mailbox') &&
    c.from.includes('@')
  const doc = c.sapDocuments[c.sapDocuments.length - 1]

  if (sent) {
    return (
      <div className="mt-4 rounded-md border border-ok bg-ok-soft p-3 text-sm text-ok">
        Reply sent to {String(sent.detail.to)} by {String(sent.detail.actor)} at{' '}
        {new Date(sent.at).toLocaleTimeString()}.
      </div>
    )
  }

  const copy = async () => {
    await navigator.clipboard.writeText(text)
    toast.success('Reply copied')
  }

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface p-4 shadow-card">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="font-semibold">Reply to the customer</h3>
        <span className="text-xs text-muted">
          {byEmail
            ? `to ${c.from}, in the thread "${c.subject}"`
            : 'this complaint did not arrive by email: copy the reply'}
        </span>
      </div>
      <textarea
        aria-label="Reply to the customer"
        className="min-h-40 w-full rounded-md border border-line bg-surface-2 p-3 text-sm leading-relaxed"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {doc && !text.includes(doc.number) && (
        <p className="mt-1 text-xs text-muted">
          The reference {doc.type} {doc.number} is added at the end when the reply is sent.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        {byEmail && (
          <Button
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
        <Button variant="outline" onClick={() => void copy()}>
          <Copy className="size-4" /> Copy reply
        </Button>
      </div>
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
