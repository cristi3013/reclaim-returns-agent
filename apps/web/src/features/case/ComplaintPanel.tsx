import { RotateCcw } from 'lucide-react'
import { COMPLAINT_LABELS, conversation, type Case, type InvoiceMessage } from '@reclaim/shared'
import { Conversation } from '@/components/domain/Conversation'
import { Attachments } from '@/components/domain/Attachments'

/** The conversation: this complaint's emails, or every email on the invoice when it has more complaints. */
export function ComplaintPanel({
  c,
  invoiceMessages,
}: {
  c: Case
  invoiceMessages?: InvoiceMessage[]
}) {
  const messages = invoiceMessages ?? conversation(c)
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-card">
      <h2 className="text-base font-semibold text-fg">
        Conversation · {messages.length} email{messages.length === 1 ? '' : 's'}
      </h2>
      <div className="mt-1 text-sm font-medium">{c.subject}</div>
      <Attachments list={c.attachments} compact />
      <Conversation
        messages={messages}
        customerFrom={c.from}
        label="Emails in this case"
        extras={(m) => {
          const x = m as InvoiceMessage
          return x.startsComplaint
            ? {
                before: (
                  <li className="flex items-center gap-2 py-1 text-xs text-muted" role="separator">
                    <span className="h-px flex-1 bg-line" />
                    <RotateCcw className="size-3.5" aria-hidden />
                    {x.reopens
                      ? 'New email on this invoice · case reopened'
                      : 'New complaint on this invoice'}
                    <span className="h-px flex-1 bg-line" />
                  </li>
                ),
              }
            : {}
        }}
      />
    </section>
  )
}

/** What the agent read in the emails: the facts the rules decide on, for the sidebar. */
export function AgentReadPanel({ c }: { c: Case }) {
  const f = c.facts
  if (!f && c.anomalies.length === 0) return null
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-card">
      <h2 className="text-sm font-semibold text-fg">What the agent read</h2>
      {c.anomalies.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {c.anomalies.map((a) => (
            <span key={a} className="rounded bg-warn-soft px-2 py-0.5 text-xs text-warn">
              {a}
            </span>
          ))}
        </div>
      )}
      {f && (
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">Complaint</dt>
          <dd>{COMPLAINT_LABELS[f.complaintType]}</dd>
          <dt className="text-muted">Invoice named</dt>
          <dd className="font-mono">
            {f.invoiceNumber ?? <span className="text-warn">none</span>}
          </dd>
          <dt className="text-muted">Quantity claimed</dt>
          <dd className="tnum">
            {f.claimedQuantity ?? '–'} {f.claimedQuantity != null ? f.unit : ''}
          </dd>
          {f.claimedUnitPrice != null && (
            <>
              <dt className="text-muted">Price claimed</dt>
              <dd className="tnum">
                {f.claimedUnitPrice.toFixed(2)} per {f.unit}
              </dd>
            </>
          )}
          <dt className="text-muted">Wants replacement</dt>
          <dd>{f.wantsReplacement ? 'Yes' : 'No'}</dd>
          <dt className="text-muted">Goods returnable</dt>
          <dd>
            {f.goodsReturnable == null
              ? 'Unclear'
              : f.goodsReturnable
                ? 'Yes'
                : 'No (lost or ruined)'}
          </dd>
          <dt className="text-muted">Evidence</dt>
          <dd>{f.evidence || '–'}</dd>
        </dl>
      )}
    </section>
  )
}
