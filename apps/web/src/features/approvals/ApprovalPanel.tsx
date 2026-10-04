import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { REASON_CODES, ROLE_LABELS, type Case, type Proposal, type Role } from '@reclaim/shared'
import { useApprove, useReject, useRelease, type ApproveResult } from '@/api'
import { QuantityEditor } from './QuantityEditor'
import { PayloadView } from '@/components/domain/PayloadView'
import { RuleBadge } from '@/components/domain/RuleBadge'
import { DocTypeBadge } from '@/components/domain/DocTypeBadge'
import { Button } from '@/components/ui/button'
import { formatMoney, formatQty } from '@/lib/format'

const RANK: Record<Role, number> = { customer_service_lead: 0, credit_manager: 1, finance_director: 2, returns_desk: -1 }

export function ApprovalPanel({ c, p, role, actor }: { c: Case; p: Proposal; role: Role; actor: string }) {
  const approve = useApprove()
  const reject = useReject()
  const release = useRelease()
  const [edit, setEdit] = useState<{ quantity: number; valid: boolean } | null>(null)
  const [comment, setComment] = useState('')
  const [result, setResult] = useState<ApproveResult | null>(null)
  const d = p.decision
  const max = c.findings?.invoice?.items[0]?.quantity ?? d.quantity
  const unitPrice = c.findings?.invoice?.items[0]?.unitPrice ?? 0
  const allowed = !d.approverRole || RANK[role] >= RANK[d.approverRole]
  const canApprove = c.status === 'awaiting_approval' && allowed && !approve.isPending && (!edit || edit.valid)
  const doc = c.sapDocuments[c.sapDocuments.length - 1]
  const lastApproval = c.approvals[c.approvals.length - 1]

  const onApprove = () =>
    approve.mutate(
      {
        proposalId: p.id,
        input: {
          actor,
          role,
          editedQuantity: edit && edit.valid && edit.quantity !== d.quantity ? edit.quantity : undefined,
          comment,
        },
      },
      {
        onSuccess: (r) => {
          setResult(r)
          if (r.ok) toast.success(r.document ? `${r.document.type} ${r.document.number} created in SAP` : 'Reply approved, case closed')
        },
      },
    )

  return (
    <aside className="rounded-lg border border-line bg-surface p-4 shadow-card">
      <div className="text-xs text-muted">
        <Link to="/cases/$id" params={{ id: c.id }} className="font-mono underline hover:text-fg">
          {c.id}
        </Link>{' '}
        · {c.customerName} · invoice <span className="font-mono">{c.invoiceNumber ?? 'none'}</span>
      </div>
      <h2 className="mt-1 text-lg font-semibold">{c.subject}</h2>

      <div className="mt-3 rounded-md border-l-2 border-accent bg-accent-soft/50 p-3 text-sm">
        <div>
          <span className="font-semibold">What happened.</span> {p.briefing.whatHappened}
        </div>
        <div>
          <span className="font-semibold">What we propose.</span> {p.briefing.whatWePropose}
        </div>
        <div>
          <span className="font-semibold">Risk.</span> {p.briefing.risk}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <RuleBadge ruleId={d.ruleId} />
        <DocTypeBadge type={d.documentType} />
        {d.reasonCode && (
          <span className="text-xs text-muted">
            reason {d.reasonCode} · {REASON_CODES[d.reasonCode]}
          </span>
        )}
        {d.intercompany && <span className="rounded bg-warn-soft px-2 py-0.5 text-xs text-warn">Intercompany: flag for finance</span>}
      </div>

      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted">Quantity</dt>
        <dd className="tnum">{d.quantity > 0 ? formatQty(d.quantity, d.unit) : '–'}</dd>
        <dt className="text-muted">Amount</dt>
        <dd className="font-mono tnum">{d.amount > 0 ? formatMoney(d.amount, d.currency) : '–'}</dd>
        <dt className="text-muted">Required approver</dt>
        <dd>{d.approverRole ? ROLE_LABELS[d.approverRole] : '–'}</dd>
        <dt className="text-muted">You are</dt>
        <dd className={allowed ? '' : 'text-warn'}>
          {ROLE_LABELS[role]}
          {!allowed && ' · not enough authority for this value'}
        </dd>
      </dl>

      {p.sapPayload && (
        <div className="mt-3">
          <PayloadView payload={p.sapPayload} />
        </div>
      )}

      {c.status === 'awaiting_approval' && (
        <div className="mt-4 space-y-3 border-t border-line pt-3">
          {d.documentType !== 'NONE' && (
            <QuantityEditor value={d.quantity} max={max} unit={d.unit} unitPrice={unitPrice} currency={d.currency} onChange={setEdit} />
          )}
          <label className="block text-sm">
            <span>Comment{d.documentType === 'NONE' ? '' : ' (required to reject)'}</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="mt-1 w-full rounded-md border border-line bg-surface p-2"
              rows={2}
            />
          </label>
          <div className="flex gap-2">
            <Button onClick={onApprove} disabled={!canApprove}>
              {approve.isPending
                ? d.documentType === 'NONE'
                  ? 'Sending…'
                  : 'Writing to SAP…'
                : d.documentType === 'NONE'
                  ? 'Approve reply'
                  : `Approve and create ${d.documentType}`}
            </Button>
            <Button
              variant="outline"
              disabled={!comment.trim() || reject.isPending || !allowed}
              onClick={() =>
                reject.mutate({ proposalId: p.id, input: { actor, role, comment } }, { onSuccess: () => toast('Proposal rejected') })
              }
            >
              Reject
            </Button>
          </div>
          <p className="text-xs text-muted">
            {d.documentType === 'NONE'
              ? 'Approving sends the drafted reply. Nothing is created in SAP.'
              : 'Approving sends exactly the payload above to SAP, with the record’s version stamp. If the record changed since it was read, SAP refuses with 412 and nothing is written.'}
          </p>
        </div>
      )}

      {result && !result.ok && (
        <div role="alert" className="mt-4 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad">
          <div className="font-semibold">SAP refused the write · HTTP {result.status}</div>
          <div>{result.message}</div>
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={() => setResult(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {c.status === 'sap_write_failed' && !result && (
        <div role="alert" className="mt-4 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad">
          <div className="font-semibold">The last write to SAP was refused</div>
          <div>Nothing was written. Re-run the case to read the record again, then approve.</div>
        </div>
      )}

      {c.status === 'written_to_sap' && doc && (
        <div className="mt-4 rounded-md border border-ok bg-ok-soft p-3 text-sm">
          <div className="font-semibold text-ok">
            {doc.type} {doc.number} created in SAP with billing block 08
          </div>
          <div className="text-muted">
            Step {doc.type === 'YRE' ? '5.1.2' : '5.2.1'} done.{' '}
            {doc.released
              ? 'Billing block removed: billing can now create the credit memo.'
              : 'Releasing removes the block so billing can create the credit memo.'}
          </div>
          {!doc.released && (
            <Button
              size="sm"
              className="mt-2"
              disabled={release.isPending}
              onClick={() =>
                release.mutate(doc.id, {
                  onSuccess: (r) => (r.ok ? toast.success('Billing block removed') : toast.error(`${r.status}: ${r.message}`)),
                })
              }
            >
              {release.isPending ? 'Releasing…' : 'Release billing block'}
            </Button>
          )}
        </div>
      )}

      {c.status === 'closed' && (
        <div className="mt-4 rounded-md border border-ok bg-ok-soft p-3 text-sm text-ok">Reply approved and sent. No SAP document.</div>
      )}
      {c.status === 'rejected' && lastApproval && (
        <div className="mt-4 rounded-md border border-line bg-surface-2 p-3 text-sm text-muted">
          Rejected by {lastApproval.actor}: {lastApproval.comment}
        </div>
      )}
    </aside>
  )
}
