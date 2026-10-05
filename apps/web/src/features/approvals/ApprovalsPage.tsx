import { useEffect, useState } from 'react'
import { APPROVAL_THRESHOLDS, ROLE_LABELS, primaryProposal, type CaseSummary, type Role } from '@reclaim/shared'
import { useCase, useCases } from '@/api'
import { useUi } from '@/store/ui'
import { ApprovalPanel } from './ApprovalPanel'
import { StatusChip } from '@/components/domain/StatusChip'
import { RuleBadge } from '@/components/domain/RuleBadge'
import { EmptyState } from '@/components/domain/EmptyState'
import { formatMoney, formatRelative } from '@/lib/format'

const RANK: Record<Role, number> = { customer_service_lead: 0, credit_manager: 1, finance_director: 2, returns_desk: -1 }
const QUEUE_STATUSES = ['awaiting_approval', 'approved', 'written_to_sap', 'sap_write_failed', 'closed', 'rejected']

export function ApprovalsPage() {
  const { role } = useUi()
  const q = useCases()
  const [sel, setSel] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const mine = (r: CaseSummary) => all || !r.approverRole || RANK[role] >= RANK[r.approverRole]
  const rows = (q.data ?? [])
    .filter((r) => QUEUE_STATUSES.includes(r.status) && mine(r))
    .sort((a, b) => (a.status === 'awaiting_approval' ? 0 : 1) - (b.status === 'awaiting_approval' ? 0 : 1))
  // Selection sticks to the case the person is working on, even after its status changes and it moves down the list.
  const selected = sel && rows.some((r) => r.id === sel) ? sel : (rows[0]?.id ?? '')
  useEffect(() => {
    if (!sel && rows[0]) setSel(rows[0].id)
  }, [sel, rows])
  const detail = useCase(selected)
  const c = detail.data
  const p = c ? primaryProposal(c) : undefined
  const waiting = rows.filter((r) => r.status === 'awaiting_approval').length
  return (
    <div>
      <div className="mb-4 flex items-end gap-4">
        <div>
          <h1 className="text-xl font-semibold">Approvals</h1>
          <p className="text-sm text-muted">
            Queue for {ROLE_LABELS[role]} · {waiting} waiting
            <span className="ml-2 text-xs">
              {APPROVAL_THRESHOLDS.map((t) => `${t.upTo === Infinity ? 'above 5 000' : `up to ${t.upTo.toLocaleString('en-GB').replace(',', ' ')}`}: ${ROLE_LABELS[t.role]}`).join(' · ')} · no goods back: credit manager at least
            </span>
          </p>
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show all roles
        </label>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing to approve" description="Run cases from the inbox. Proposals that need your role will appear here." />
      ) : (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSel(r.id)}
                  aria-current={selected === r.id ? 'true' : undefined}
                  className={`w-full rounded-lg border p-3 text-left ${
                    selected === r.id ? 'border-accent bg-accent-soft/50' : 'border-line bg-surface hover:bg-surface-2'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <RuleBadge ruleId={r.ruleId} />
                    <span className="truncate font-medium">{r.subject}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <StatusChip status={r.status} />
                    <span>{r.customerName}</span>
                    <span className="font-mono tnum">{r.amount ? formatMoney(r.amount, r.currency) : 'no credit'}</span>
                    <span className="ml-auto">{formatRelative(r.updatedAt)}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
          {c && p ? <ApprovalPanel key={c.id} c={c} p={p} role={role} actor={ROLE_LABELS[role]} /> : <div />}
        </div>
      )}
    </div>
  )
}
