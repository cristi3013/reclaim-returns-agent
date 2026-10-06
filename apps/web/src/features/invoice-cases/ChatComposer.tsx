import { useEffect, useState, type RefObject } from 'react'
import { toast } from 'sonner'
import { CornerUpLeft, Send, Sparkles } from 'lucide-react'
import {
  decisionReplyDue,
  fromCustomerSide,
  participantKey,
  senderName,
  type Case,
  type InvoiceMessage,
  type Role,
} from '@reclaim/shared'
import { useReplySuggestion, useSendReply, type SendReplyResult } from '@/api'
import { Avatar, type Person } from '@/components/domain/MessageBubble'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The email a reply answers by default: the customer's latest, else the latest anyone sent us. */
export function defaultTarget(messages: InvoiceMessage[], customerFrom: string) {
  const inbound = messages.filter((m) => m.direction === 'in')
  const customer = inbound.filter((m) => fromCustomerSide({ from: customerFrom }, m.from))
  return (customer[customer.length - 1] ?? inbound[inbound.length - 1])?.id ?? null
}

/**
 * Chat with whoever wrote on the invoice: pick a person (or press Reply under one of their emails) and answer
 * that email in its thread. To the customer, the box starts with the suggested reply, and once a person has
 * decided, it is the decision reply with the SAP reference. To anyone else, a plain message.
 */
export function ChatComposer({
  messages,
  cases,
  people,
  target,
  onTarget,
  role,
  actor,
  inputRef,
}: {
  messages: InvoiceMessage[]
  cases: Map<string, Case>
  people: Map<string, Person>
  target: string | null
  onTarget: (id: string) => void
  role: Role
  actor: string
  inputRef?: RefObject<HTMLTextAreaElement>
}) {
  const inbound = messages.filter((m) => m.direction === 'in')
  // One chip per person: answering them answers their latest email.
  const latest = new Map<string, InvoiceMessage>()
  for (const m of inbound) latest.set(participantKey(m), m)
  const m = inbound.find((x) => x.id === target)
  const c = m ? cases.get(m.caseId) : undefined

  if (!inbound.length) return null
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div
        className="flex flex-wrap items-center gap-1.5 text-xs"
        role="group"
        aria-label="Reply to"
      >
        <span className="font-semibold text-muted">Reply to</span>
        {[...latest.entries()].map(([key, last]) => {
          const p = people.get(key)
          const active = m ? participantKey(m) === key : false
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => onTarget(last.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 hover:bg-surface-2',
                active ? 'border-fg bg-surface-2' : 'border-line',
              )}
            >
              {p && <Avatar p={p} className="size-5" />}
              <span className="font-medium text-fg">{senderName(last.from)}</span>
              {p && <span className="text-muted">{p.label}</span>}
            </button>
          )
        })}
      </div>
      {m && c && (
        <Composer
          key={m.id}
          m={m}
          c={c}
          person={people.get(participantKey(m))}
          role={role}
          actor={actor}
          inputRef={inputRef}
        />
      )}
    </div>
  )
}

function Composer({
  m,
  c,
  person,
  role,
  actor,
  inputRef,
}: {
  m: InvoiceMessage
  c: Case
  person?: Person
  role: Role
  actor: string
  inputRef?: RefObject<HTMLTextAreaElement>
}) {
  const toCustomer = fromCustomerSide(c, m.from)
  const decision = toCustomer && decisionReplyDue(c)
  const suggestion = useReplySuggestion(c.id, c.events.length, toCustomer)
  const [text, setText] = useState('')
  const [edited, setEdited] = useState(false)
  const [result, setResult] = useState<SendReplyResult | null>(null)
  const send = useSendReply()
  const s = suggestion.data
  const byEmail =
    c.events.some((e) => e.kind === 'intake' && e.detail.channel === 'mailbox') &&
    m.from.includes('@')

  useEffect(() => {
    if (s && !edited) setText(s.text)
  }, [s, edited])

  const submit = () => {
    if (!text.trim() || send.isPending) return
    send.mutate(
      {
        caseId: c.id,
        input: decision
          ? { actor, role, text, kind: 'decision' }
          : { actor, role, text, kind: 'message', replyTo: m.id },
      },
      {
        onSuccess: (r) => {
          setResult(r)
          if (!r.ok) return
          toast.success(`Sent to ${r.to}`)
          setText('')
          setEdited(true)
        },
      },
    )
  }

  const quote = m.text.trim().split('\n').find(Boolean) ?? ''
  return (
    <div className="mt-2">
      <div
        className="flex items-start gap-1.5 rounded-t-md border border-b-0 border-line bg-surface-2 px-3 py-1.5 text-xs text-muted"
        style={person ? { borderLeftColor: person.color, borderLeftWidth: 3 } : undefined}
      >
        <CornerUpLeft className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0">
          Replying to <span className="font-medium text-fg">{m.from}</span>
          {decision && (
            <span className="font-medium text-ok"> · decision reply, with the SAP reference</span>
          )}
          <span className="block truncate italic">“{quote}”</span>
        </span>
      </div>
      <textarea
        ref={inputRef}
        aria-label={`Reply to ${senderName(m.from)}`}
        className="min-h-28 w-full rounded-b-md border border-line bg-surface p-3 text-sm leading-relaxed"
        placeholder={`Write to ${senderName(m.from)}…  (Ctrl+Enter to send)`}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setEdited(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            submit()
          }
        }}
      />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={submit} disabled={!byEmail || send.isPending || !text.trim()}>
          <Send className="size-4" /> {send.isPending ? 'Sending…' : 'Send'}
        </Button>
        {toCustomer && (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg disabled:opacity-50"
            disabled={suggestion.isFetching}
            onClick={() => {
              setEdited(false)
              if (s) setText(s.text)
              void suggestion.refetch()
            }}
          >
            <Sparkles className="size-3.5" aria-hidden />
            {suggestion.isFetching
              ? 'Reading every email with this customer…'
              : s
                ? `Suggested from ${s.emails} ${s.emails === 1 ? 'email' : 'emails'} · use the suggestion`
                : 'Suggest a reply'}
          </button>
        )}
        {!byEmail && (
          <span className="text-xs text-muted">
            This complaint did not arrive by email: there is no thread to answer in.
          </span>
        )}
      </div>
      {s?.note && toCustomer && <p className="mt-1 text-xs text-warn">{s.note}</p>}
      {result && !result.ok && (
        <div
          role="alert"
          className="mt-2 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad"
        >
          <div className="font-semibold">Not sent · HTTP {result.status}</div>
          <div>{result.message}</div>
        </div>
      )}
    </div>
  )
}
