import { COMPLAINT_LABELS, conversation, type Case } from '@reclaim/shared'
import { formatDateTime } from '@/lib/format'
import { Attachments, MessageBubble } from '@/components/domain/MessageBubble'

export function ComplaintPanel({ c }: { c: Case }) {
  const f = c.facts
  const messages = conversation(c)
  const thread = messages.length > 1
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-card">
      <h2 className="text-base font-semibold text-fg">
        {thread ? `Conversation · ${messages.length} emails` : 'Complaint'}
      </h2>
      {thread ? (
        <>
          <div className="mt-1 text-sm font-medium">{c.subject}</div>
          <ol className="mt-3 space-y-3" aria-label="Emails in this case">
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} />
            ))}
          </ol>
        </>
      ) : (
        <>
          <div className="mt-2 text-sm">
            <div className="font-medium">{c.subject}</div>
            <div className="text-muted">
              {c.from} · {formatDateTime(c.receivedAt)}
            </div>
          </div>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {c.bodyText}
          </pre>
          <Attachments list={c.attachments} />
        </>
      )}
      {c.anomalies.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {c.anomalies.map((a) => (
            <span key={a} className="rounded bg-warn-soft px-2 py-0.5 text-xs text-warn">
              {a}
            </span>
          ))}
        </div>
      )}
      {f && (
        <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
          <dt className="text-muted">What the agent read</dt>
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
