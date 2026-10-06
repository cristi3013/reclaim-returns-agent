import { REASON_CODES, ROLE_LABELS, type Proposal } from '@reclaim/shared'
import { RuleBadge } from '@/components/domain/RuleBadge'
import { DocTypeBadge } from '@/components/domain/DocTypeBadge'
import { PayloadView } from '@/components/domain/PayloadView'
import { formatMoney, formatQty } from '@/lib/format'

export function ProposalCard({
  proposal: p,
  selected = false,
  onSelect,
}: {
  proposal: Proposal
  /** The option selected for the decision below. */
  selected?: boolean
  /** Given while a person still picks between two options: the card selects itself on click. */
  onSelect?: () => void
}) {
  const d = p.decision
  const twoOption = p.option !== 'single'
  return (
    <article
      aria-label={twoOption ? `Option ${p.option}` : 'Proposal'}
      onClick={onSelect}
      className={`rounded-lg border bg-surface p-4 shadow-card ${twoOption && p.recommended ? 'border-accent' : 'border-line'} ${selected ? 'ring-2 ring-accent' : ''} ${onSelect && !selected ? 'cursor-pointer hover:bg-surface-2' : ''}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        {twoOption && onSelect ? (
          <button
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={(e) => {
              e.stopPropagation()
              onSelect()
            }}
            className="inline-flex items-center gap-2 font-semibold"
          >
            <span
              aria-hidden
              className={`size-4 rounded-full border ${selected ? 'border-[5px] border-accent' : 'border-line bg-surface'}`}
            />
            Option {p.option}
          </button>
        ) : (
          twoOption && <span className="font-semibold">Option {p.option}</span>
        )}
        <RuleBadge ruleId={d.ruleId} />
        <DocTypeBadge type={d.documentType} />
        {twoOption && p.recommended && (
          <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-green">Recommended</span>
        )}
        {twoOption && p.chosen && <span className="rounded bg-ok-soft px-2 py-0.5 text-xs text-ok">Chosen</span>}
        {selected && <span className="rounded bg-surface-2 px-2 py-0.5 text-xs font-medium">Selected</span>}
        {d.intercompany && <span className="rounded bg-warn-soft px-2 py-0.5 text-xs text-warn">Intercompany</span>}
        {d.requiresCustomerConfirmation && (
          <span className="rounded bg-warn-soft px-2 py-0.5 text-xs text-warn">Customer must confirm</span>
        )}
      </header>

      <blockquote className="mt-3 border-l-2 border-accent pl-3 text-sm text-muted">
        {p.policyCitations.map((c) => (
          <p key={c.ruleId}>{c.text}</p>
        ))}
      </blockquote>

      <p className="mt-3 text-sm leading-relaxed">{p.explanation}</p>

      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 rounded-md bg-surface-2 p-3 text-sm">
        <dt className="text-muted">Document</dt>
        <dd>
          {d.documentType === 'NONE' ? 'none' : d.documentType}
          {d.reasonCode && ` · reason ${d.reasonCode} (${REASON_CODES[d.reasonCode]})`}
        </dd>
        <dt className="text-muted">Quantity</dt>
        <dd className="tnum">{d.quantity > 0 ? formatQty(d.quantity, d.unit) : '–'}</dd>
        <dt className="text-muted">Amount</dt>
        <dd className="font-mono tnum">{d.amount > 0 ? formatMoney(d.amount, d.currency) : '–'}</dd>
        <dt className="text-muted">Approver</dt>
        <dd>{d.approverRole ? ROLE_LABELS[d.approverRole] : 'not required'}</dd>
        {d.documentType !== 'NONE' && (
          <>
            <dt className="text-muted">Billing block</dt>
            <dd>08 Check Credit Memo, until the approver releases it</dd>
          </>
        )}
      </dl>

      {p.sapPayload && (
        <div className="mt-3">
          <PayloadView payload={p.sapPayload} />
        </div>
      )}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted hover:text-fg">
          {d.ruleId === 'R6' ? 'Handover note and reply to the customer' : 'Reply draft to the customer'}
        </summary>
        <pre className="mt-2 whitespace-pre-wrap rounded bg-surface-2 p-3 font-sans leading-relaxed">{p.replyDraft}</pre>
      </details>

    </article>
  )
}
