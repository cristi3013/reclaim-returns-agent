import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, Send, Sparkles } from 'lucide-react'
import {
  caseOutcome,
  currentReply,
  customerHistory,
  decisionReplyDue,
  templateReply,
  type Case,
  type ReplyKind,
  type Role,
} from '@reclaim/shared'
import { useReplySuggestion, useSendReply, type SendReplyResult } from '@/api'
import { Button } from '@/components/ui/button'

/** The reply to the customer: a suggested answer to edit, then send by email in their thread. */
export function ReplyPanel(props: { c: Case; role: Role; actor: string }) {
  const { c } = props
  const kind: ReplyKind = decisionReplyDue(props.c) ? 'decision' : 'message'
  const sent = currentReply(c.events)
  // Keyed by kind and status: a decision, or the decision reply going out, starts a fresh suggestion.
  return (
    <>
      {sent && kind === 'message' && (
        <div className="mt-4 rounded-md border border-ok bg-ok-soft p-3 text-sm text-ok">
          Reply sent to {String(sent.detail.to)} by {String(sent.detail.actor)} at{' '}
          {new Date(sent.at).toLocaleTimeString()}.
        </div>
      )}
      <ReplyForm key={`${kind}:${c.status}:${caseOutcome(c)}`} kind={kind} {...props} />
    </>
  )
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

function ReplyForm({
  c,
  role,
  actor,
  kind,
}: {
  c: Case
  role: Role
  actor: string
  kind: ReplyKind
}) {
  // The template from this case's own thread is there at once; the suggestion from every email replaces it.
  const [text, setText] = useState(() => templateReply(c, customerHistory(c, [c]), kind))
  const [edited, setEdited] = useState(false)
  const [result, setResult] = useState<SendReplyResult | null>(null)
  const send = useSendReply()
  const suggestion = useReplySuggestion(c.id, c.events.length)
  const s = suggestion.data

  useEffect(() => {
    if (s && !edited) setText(s.text)
  }, [s, edited])

  const byEmail =
    c.events.some((e) => e.kind === 'intake' && e.detail.channel === 'mailbox') &&
    c.from.includes('@')
  const tone =
    kind === 'decision' ? TONE[c.status === 'closed' ? `closed:${caseOutcome(c)}` : c.status] : null

  const copy = async () => {
    await navigator.clipboard?.writeText(text)
    toast.success('Reply copied')
  }

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-muted">
          {kind === 'decision' ? 'Reply to the customer' : 'Message to the customer'}
        </span>
        <span className="text-muted">
          to <span className="font-medium text-fg">{c.from}</span>
        </span>
        {tone && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${tone.cls}`}
          >
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {tone.label}
          </span>
        )}
      </div>
      <textarea
        aria-label="Reply to the customer"
        className="min-h-40 w-full rounded-md border border-line bg-surface p-3 text-sm leading-relaxed"
        value={text}
        placeholder="Write to the customer…"
        onChange={(e) => {
          setText(e.target.value)
          setEdited(true)
        }}
      />
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <Sparkles className="size-3.5 shrink-0" aria-hidden />
        <span>
          {suggestion.isFetching
            ? 'Reading every email with this customer…'
            : s
              ? `Suggested from ${s.emails} ${s.emails === 1 ? 'email' : 'emails'} with this customer${
                  c.invoiceNumber ? ` about invoice ${c.invoiceNumber}` : ''
                } · ${s.by === 'model' ? 'worded by the model, facts from the case' : 'standard wording'}`
              : 'Suggested from this conversation · standard wording'}
        </span>
        <button
          type="button"
          className="font-medium text-fg underline disabled:opacity-50"
          disabled={suggestion.isFetching}
          onClick={() => {
            setEdited(false)
            if (s) setText(s.text)
            void suggestion.refetch()
          }}
        >
          {edited ? 'Use the suggestion' : 'Suggest again'}
        </button>
        {s?.note && <span className="w-full text-warn">{s.note}</span>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {byEmail && (
          <Button
            disabled={send.isPending || !text.trim()}
            onClick={() =>
              send.mutate(
                { caseId: c.id, input: { actor, role, text, kind } },
                {
                  onSuccess: (r) => {
                    setResult(r)
                    if (r.ok) {
                      toast.success(`${kind === 'decision' ? 'Reply' : 'Message'} sent to ${r.to}`)
                      setEdited(false)
                    }
                  },
                },
              )
            }
          >
            <Send className="size-4" /> {send.isPending ? 'Sending…' : 'Send reply'}
          </Button>
        )}
        <Button variant="outline" onClick={copy} disabled={!text.trim()}>
          <Copy className="size-4" /> Copy
        </Button>
      </div>
      {!byEmail && (
        <p className="mt-1 text-xs text-muted">
          This complaint did not arrive by email, so there is no thread to answer in: copy the reply
          instead.
        </p>
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
