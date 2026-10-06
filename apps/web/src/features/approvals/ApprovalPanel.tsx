import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { approverFor, caseOutcome, DEMO_INVOICES, REASON_CODES, ROLE_LABELS, type Case, type Proposal, type Role } from '@reclaim/shared'
import { useApprove, useChoose, useConfirmGoodsReceipt, useReject, useRelease, useReturnStatus, type ApproveResult, type ReleaseResult } from '@/api'
import { QuantityEditor } from './QuantityEditor'
import { defaultOption } from './defaultOption'
import { ProposalCard } from '@/features/case/ProposalCard'
import { ReplyPanel } from '@/features/case/ReplyPanel'
import { PayloadView } from '@/components/domain/PayloadView'
import { StatusMenu } from '@/components/domain/StatusMenu'
import { RuleBadge } from '@/components/domain/RuleBadge'
import { DocTypeBadge } from '@/components/domain/DocTypeBadge'
import { Button } from '@/components/ui/button'
import { formatMoney, formatQty, formatRelative } from '@/lib/format'
import { Archive, Check, CheckCircle2, Clock, Send, XCircle, AlertTriangle } from 'lucide-react'

const RANK: Record<Role, number> = { customer_service_lead: 0, credit_manager: 1, finance_director: 2, returns_desk: -1 }

/** The case as an approver sees it: what happened, what we propose, then the decision. */
export function ApprovalPanel({ c, p: first, role, actor }: { c: Case; p: Proposal; role: Role; actor: string }) {
  // Two options: the person picks one, then sends it to approval, or approves or rejects it.
  const [pick, setPick] = useState(defaultOption(c.proposals) ?? first.id)
  const choose = useChoose()
  const p = c.proposals.find((x) => x.id === pick) ?? first
  const d = p.decision
  const waiting = c.status === 'awaiting_approval'
  const options = waiting && c.proposals.length > 1
  return (
    <aside className="rounded-lg border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <OutcomeBanner c={c} />
        </div>
        <StatusMenu c={c} role={role} actor={actor} />
      </div>
      <div className="mt-3 text-xs text-muted">
        <Link to="/cases/$id" params={{ id: c.id }} className="font-mono underline hover:text-fg">
          {c.id}
        </Link>{' '}
        · {c.customerName} · invoice <span className="font-mono">{c.invoiceNumber ?? 'none'}</span>
      </div>
      <h2 className="mt-1 text-lg font-semibold">{c.subject}</h2>
      {options && (
        <div role="radiogroup" aria-label="Options" className="mt-3 space-y-3">
          {c.proposals.map((x) => (
            <ProposalCard
              key={x.id}
              proposal={x}
              selected={x.id === p.id}
              onSelect={choose.isPending ? undefined : () => setPick(x.id)}
            />
          ))}
        </div>
      )}
      {options && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Option {p.option} selected</span>
          <Button
            variant="outline"
            size="sm"
            disabled={p.chosen || choose.isPending}
            onClick={() =>
              choose.mutate(p.id, {
                onSuccess: () => toast.success(`Option ${p.option} sent to approval`),
                onError: (e) => toast.error(e instanceof Error ? e.message : 'Not sent'),
              })
            }
          >
            {p.chosen ? <Check className="size-4" /> : <Send className="size-4" />}
            {p.chosen ? `Option ${p.option} sent to approval` : 'Send to approval'}
          </Button>
          <span className="text-xs text-muted">
            {p.chosen ? 'It waits here for the approver.' : 'Or approve or reject it yourself, below.'}
          </span>
        </div>
      )}

      <div className="mt-3 space-y-1.5 rounded-md border border-line border-l-4 border-l-muted/50 bg-surface-2 p-3 text-sm leading-relaxed">
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

      {!options && (
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
      )}

      <ApprovalActions key={p.id} c={c} p={p} role={role} actor={actor} showPayload={!options} showOutcome={false} />
    </aside>
  )
}

/**
 * The decision on a proposal: authority, quantity, comment, approve or reject, the SAP result, release and the
 * reply. Used by the approvals queue and by the case page, so a case can be decided wherever it is opened.
 */
export function ApprovalActions({
  c,
  p,
  role,
  actor,
  showPayload = false,
  showOutcome = true,
}: {
  c: Case
  p: Proposal
  role: Role
  actor: string
  showPayload?: boolean
  /** The closed/rejected boxes; off where an OutcomeBanner already says it at the top. */
  showOutcome?: boolean
}) {
  const approve = useApprove()
  const reject = useReject()
  const release = useRelease()
  const confirmReceipt = useConfirmGoodsReceipt()
  const [edit, setEdit] = useState<{ quantity: number; valid: boolean } | null>(null)
  const [comment, setComment] = useState('')
  const [result, setResult] = useState<ApproveResult | null>(null)
  const [rel, setRel] = useState<ReleaseResult | null>(null)
  const d = p.decision
  const max = c.findings?.invoice?.items[0]?.quantity ?? d.quantity
  // For a difference credit (R4) the unit price is the difference, not the invoice price.
  const unitPrice = d.quantity > 0 ? d.amount / d.quantity : (c.findings?.invoice?.items[0]?.unitPrice ?? 0)
  const effectiveAmount = edit && edit.valid ? Math.round(edit.quantity * unitPrice * 100) / 100 : d.amount
  const effectiveApprover = d.documentType === 'NONE' ? d.approverRole : approverFor(effectiveAmount, d.ruleId)
  const allowed = !effectiveApprover || RANK[role] >= RANK[effectiveApprover]
  // The hackathon's shared demo invoices are read from DS4 but never written: approval is refused on both sides.
  const demoBlocked = DEMO_INVOICES.includes(c.invoiceNumber ?? '')
  const canApprove = c.status === 'awaiting_approval' && allowed && !demoBlocked && !approve.isPending && (!edit || edit.valid)
  const doc = c.sapDocuments[c.sapDocuments.length - 1]
  const warehouse = useReturnStatus(doc && doc.type === 'YRE' && !doc.released && c.status === 'written_to_sap' ? doc.id : null)
  const receivedInSap = warehouse.data?.source === 'sap' && warehouse.data.received
  const receiptConfirmed = !!doc?.goodsReceivedAt
  const canRelease = !doc || doc.type !== 'YRE' || receivedInSap || receiptConfirmed
  const releaseRole = RANK[role] >= RANK[d.approverRole ?? 'credit_manager']
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
    <>
      {/* Who may decide matters only while it waits; once decided, the outcome below says it. */}
      {c.status === 'awaiting_approval' && (
      <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
        {/* No document and no money: quantity and amount would only be two dashes. */}
        {(d.documentType !== 'NONE' || d.amount > 0) && (
          <>
            <dt className="text-muted">Quantity</dt>
            <dd className="tnum">{d.quantity > 0 ? formatQty(d.quantity, d.unit) : '–'}</dd>
            <dt className="text-muted">Amount</dt>
            <dd className="font-mono tnum">{d.amount > 0 ? formatMoney(d.amount, d.currency) : '–'}</dd>
          </>
        )}
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
      )}

      {showPayload && p.sapPayload && (
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
            <span className="font-medium">Comment</span>{' '}
            <span className="text-xs text-muted">optional to approve, needed to reject</span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={
                d.documentType === 'NONE'
                  ? 'e.g. Invoice not in SAP, asked the customer for the number'
                  : 'e.g. Photo does not show the damage'
              }
              className="mt-1 w-full rounded-md border border-line bg-surface p-2 placeholder:text-muted/70"
              rows={2}
            />
          </label>
          <div className="flex gap-2 max-md:fixed max-md:inset-x-0 max-md:bottom-[calc(3.5rem+env(safe-area-inset-bottom))] max-md:z-10 max-md:border-t max-md:border-line max-md:bg-surface max-md:px-4 max-md:py-3">
            <Button className="flex-1 md:flex-none" onClick={onApprove} disabled={!canApprove}>
              {approve.isPending
                ? d.documentType === 'NONE'
                  ? 'Approving…'
                  : 'Writing to SAP…'
                : d.documentType === 'NONE'
                  ? 'Approve reply'
                  : `Approve and create ${d.documentType}`}
            </Button>
            <Button
              variant="outline"
              className="flex-1 border-bad/40 text-bad hover:bg-bad-soft md:flex-none"
              title={comment.trim() ? undefined : 'Add a comment to reject'}
              disabled={!comment.trim() || reject.isPending || !allowed}
              onClick={() =>
                reject.mutate({ proposalId: p.id, input: { actor, role, comment } }, { onSuccess: () => toast('Proposal rejected') })
              }
            >
              {reject.isPending ? 'Rejecting…' : 'Reject'}
            </Button>
            {!comment.trim() && allowed && (
              <span className="self-center text-xs text-muted max-md:hidden">Add a comment to reject</span>
            )}
          </div>
          <p className="text-xs text-muted">
            {d.documentType === 'NONE'
              ? 'Approving closes the case without a SAP document. Either way, you then reply to the customer.'
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
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-block size-2 rounded-full ${receivedInSap || receiptConfirmed ? 'bg-ok' : warehouse.data?.source === 'sap' ? 'bg-warn' : 'bg-muted'}`} aria-hidden />
                <span className="font-semibold">Goods receipt, step 5.1.3:</span>
                <span className="text-muted">
                  {receiptConfirmed
                    ? `confirmed by ${doc.goodsReceivedBy} (Returns desk) at ${new Date(doc.goodsReceivedAt!).toLocaleTimeString()}`
                    : warehouse.isLoading
                      ? 'asking SAP…'
                      : receivedInSap
                        ? `received by the warehouse (SAP status ${warehouse.data?.status})`
                        : warehouse.data?.source === 'sap'
                          ? `not received yet (SAP status ${warehouse.data.status}); waiting for the Returns desk`
                          : 'not known to this system; waiting for the Returns desk to confirm it'}
                </span>
              </div>
              {!receivedInSap && !receiptConfirmed && role === 'returns_desk' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={confirmReceipt.isPending}
                  onClick={() =>
                    confirmReceipt.mutate({ id: doc.id, input: { actor, role } }, {
                      onSuccess: (r) => (r.ok ? toast.success('Goods receipt confirmed; the approver can now release the credit') : toast.error(r.message)),
                    })
                  }
                >
                  {confirmReceipt.isPending ? 'Confirming…' : 'Confirm goods receipt'}
                </Button>
              )}
              {!receivedInSap && !receiptConfirmed && role !== 'returns_desk' && (
                <p className="mt-1 text-xs text-muted">The Returns desk confirms the receipt under its own name; the person who releases the money never confirms the goods.</p>
              )}
            </div>
          )}
          {!doc.released && role !== 'returns_desk' && (
            <Button
              size="sm"
              className="mt-2"
              disabled={release.isPending || demoBlocked || !canRelease || !releaseRole}
              title={!releaseRole ? `Releasing needs the ${ROLE_LABELS[d.approverRole ?? 'credit_manager']}` : undefined}
              onClick={() =>
                release.mutate({ id: doc.id, input: { actor, role } }, {
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

      {showOutcome && c.status === 'closed' && caseOutcome(c) === 'approved' && (
        <div className="mt-4 rounded-md border border-ok bg-ok-soft p-3 text-sm text-ok">
          <div className="font-semibold">Approved. No SAP document.</div>
          {lastApproval && (
            <div>
              By {lastApproval.actor}
              {lastApproval.comment ? `: ${lastApproval.comment}` : ''}
            </div>
          )}
        </div>
      )}
      {showOutcome && caseOutcome(c) === 'rejected' && lastApproval && (
        <div className="mt-4 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad">
          <div className="font-semibold">Rejected. No SAP document.</div>
          <div>
            By {lastApproval.actor}: {lastApproval.comment}
          </div>
        </div>
      )}
      <ReplyPanel c={c} role={role} actor={actor} />
    </>
  )
}

const OUTCOME = {
  waiting: { box: 'border-warn/40 bg-warn-soft text-warn', Icon: Clock },
  good: { box: 'border-ok/40 bg-ok-soft text-ok', Icon: CheckCircle2 },
  bad: { box: 'border-bad/40 bg-bad-soft text-bad', Icon: XCircle },
  failed: { box: 'border-bad/40 bg-bad-soft text-bad', Icon: AlertTriangle },
  neutral: { box: 'border-line bg-surface-2 text-fg', Icon: Archive },
}

/** The result of the case in one line, first thing on the panel: approved, rejected or still waiting. */
function OutcomeBanner({ c }: { c: Case }) {
  const outcome = caseOutcome(c)
  const byHand = outcome === 'closed' ? [...c.events].reverse().find((e) => e.kind === 'status' && e.detail.to === 'closed') : undefined
  const last = byHand
    ? { actor: String(byHand.detail.actor ?? 'a person'), decidedAt: byHand.at, comment: String(byHand.detail.comment ?? '') }
    : c.approvals[c.approvals.length - 1]
  const doc = c.sapDocuments[c.sapDocuments.length - 1]
  const by = last ? `${last.actor} · ${formatRelative(last.decidedAt)}` : null
  const o =
    c.status === 'awaiting_approval'
      ? { tone: OUTCOME.waiting, label: 'Awaiting decision', detail: null }
      : outcome === 'rejected'
        ? { tone: OUTCOME.bad, label: 'Rejected · closed', detail: by }
        : outcome === 'closed'
          ? { tone: OUTCOME.neutral, label: 'Closed by hand · no SAP document', detail: by }
        : c.status === 'sap_write_failed'
          ? { tone: OUTCOME.failed, label: 'Approved, but the SAP write failed', detail: by }
          : c.status === 'written_to_sap' && doc
            ? {
                tone: OUTCOME.good,
                label: `Approved · ${doc.type} ${doc.number} in SAP${doc.released ? ', released' : ''}`,
                detail: by,
              }
            : outcome === 'approved'
              ? { tone: OUTCOME.good, label: c.status === 'closed' ? 'Approved · no SAP document' : 'Approved', detail: by }
              : null
  if (!o) return null
  const { Icon } = o.tone
  return (
    <div role="status" className={`flex items-start gap-2.5 rounded-md border px-3 py-2 ${o.tone.box}`}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <div className="font-semibold">{o.label}</div>
        {o.detail && (
          <div className="text-xs opacity-90">
            By {o.detail}
            {last?.comment ? <span className="text-fg/80"> · “{last.comment}”</span> : null}
          </div>
        )}
      </div>
    </div>
  )
}
