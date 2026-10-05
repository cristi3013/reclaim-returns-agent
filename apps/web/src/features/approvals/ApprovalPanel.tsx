import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { approverFor, DEMO_INVOICES, REASON_CODES, ROLE_LABELS, type Case, type Proposal, type Role } from '@reclaim/shared'
import { useApprove, useReject, useRelease, useReturnStatus, useSettings, type ApproveResult, type ReleaseResult } from '@/api'
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
  const { data: settings } = useSettings()
  const [edit, setEdit] = useState<{ quantity: number; valid: boolean } | null>(null)
  const [comment, setComment] = useState('')
  const [result, setResult] = useState<ApproveResult | null>(null)
  const [rel, setRel] = useState<ReleaseResult | null>(null)
  const [goodsReceived, setGoodsReceived] = useState(false)
  const d = p.decision
  const max = c.findings?.invoice?.items[0]?.quantity ?? d.quantity
  // For a difference credit (R4) the unit price is the difference, not the invoice price.
  const unitPrice = d.quantity > 0 ? d.amount / d.quantity : (c.findings?.invoice?.items[0]?.unitPrice ?? 0)
  const effectiveAmount = edit && edit.valid ? Math.round(edit.quantity * unitPrice * 100) / 100 : d.amount
  const effectiveApprover = d.documentType === 'NONE' ? d.approverRole : approverFor(effectiveAmount, d.ruleId)
  const allowed = !effectiveApprover || RANK[role] >= RANK[effectiveApprover]
  const demoBlocked = settings?.sapMode === 'real' && DEMO_INVOICES.includes(c.invoiceNumber ?? '')
  const canApprove = c.status === 'awaiting_approval' && allowed && !demoBlocked && !approve.isPending && (!edit || edit.valid)
  const doc = c.sapDocuments[c.sapDocuments.length - 1]
  const warehouse = useReturnStatus(doc && doc.type === 'YRE' && !doc.released && c.status === 'written_to_sap' ? doc.id : null)
  const receivedInSap = warehouse.data?.source === 'sap' && warehouse.data.received
  const canRelease = !doc || doc.type !== 'YRE' || receivedInSap || goodsReceived
  const lastApproval = c.approvals[c.approvals.length - 1]
  const lastError = [...c.events].reverse().find((e) => e.kind === 'error')
  const failure = result && !result.ok ? result : c.status === 'sap_write_failed' && lastError ? { status: Number(lastError.detail.status ?? 0), message: String(lastError.detail.message ?? lastError.title) } : null

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
        <dd>
          {effectiveApprover ? ROLE_LABELS[effectiveApprover] : '–'}
          {effectiveApprover !== d.approverRole && <span className="ml-1 text-xs text-warn">(changed by the edited quantity)</span>}
        </dd>
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
        <div className="mt-4 space-y-3 border-t border-line pt-3 max-md:pb-16">
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
          <div className="flex gap-2 max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:z-10 max-md:border-t max-md:border-line max-md:bg-surface max-md:px-4 max-md:py-3">
            <Button className="flex-1 md:flex-none" onClick={onApprove} disabled={!canApprove}>
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

      {demoBlocked && c.status === 'awaiting_approval' && (
        <div role="alert" className="mt-4 rounded-md border border-warn bg-warn-soft p-3 text-sm text-warn">
          Invoice {c.invoiceNumber} is hackathon demo data and must never be written to the real DS4. Switch SAP mode to Mock, or use one of the team's own invoices.
        </div>
      )}

      {failure && (
        <div role="alert" className="mt-4 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad">
          <div className="font-semibold">
            {failure.status === 412 ? 'SAP refused the write · HTTP 412 Precondition Failed' : `Write refused · HTTP ${failure.status || '—'}`}
          </div>
          <div>{failure.message}</div>
          {c.status === 'sap_write_failed' && (
            <div className="mt-1 text-xs">Nothing was written. Re-run the case to read the record again, then approve.</div>
          )}
          {result && !result.ok && c.status !== 'sap_write_failed' && (
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={() => setResult(null)}>
                Dismiss
              </Button>
            </div>
          )}
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
          {!doc.released && doc.type === 'YRE' && (
            <div className="mt-2 rounded-md border border-line bg-surface p-2 text-sm">
              <div className="flex items-center gap-2">
                <span className={`inline-block size-2 rounded-full ${receivedInSap ? 'bg-ok' : warehouse.data?.source === 'sap' ? 'bg-warn' : 'bg-muted'}`} aria-hidden />
                <span className="font-semibold">Goods receipt, step 5.1.3:</span>
                <span className="text-muted">
                  {warehouse.isLoading
                    ? 'asking SAP…'
                    : receivedInSap
                      ? `received by the warehouse (SAP status ${warehouse.data?.status})`
                      : warehouse.data?.source === 'sap'
                        ? `not received yet (SAP status ${warehouse.data.status}); checked ${new Date(warehouse.data.checkedAt).toLocaleTimeString()}`
                        : 'not known to this system'}
                </span>
              </div>
              {!receivedInSap && (
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" checked={goodsReceived} onChange={(e) => setGoodsReceived(e.target.checked)} />
                  I confirm the goods receipt by hand (recorded as a manual confirmation in the audit trail)
                </label>
              )}
            </div>
          )}
          {!doc.released && (
            <Button
              size="sm"
              className="mt-2"
              disabled={release.isPending || demoBlocked || !canRelease}
              onClick={() =>
                release.mutate({ id: doc.id, input: { actor, role, goodsReceived: goodsReceived && !receivedInSap } }, {
                  onSuccess: (r) => {
                    setRel(r)
                    if (r.ok) toast.success('Billing block removed')
                  },
                })
              }
            >
              {release.isPending ? 'Releasing…' : 'Release billing block'}
            </Button>
          )}
          {rel && !rel.ok && (
            <div role="alert" className="mt-3 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad">
              <div className="font-semibold">SAP refused the release · HTTP {rel.status}</div>
              <div>{rel.message}</div>
              <div className="mt-1 text-xs">The billing block stays. Nothing was changed.</div>
            </div>
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
