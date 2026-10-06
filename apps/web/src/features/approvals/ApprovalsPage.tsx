import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react'
import { useSearch } from '@tanstack/react-router'
import { APPROVAL_THRESHOLDS, ROLE_LABELS, primaryProposal, type CaseSummary, type Role } from '@reclaim/shared'
import { useCase, useCases } from '@/api'
import { useUi } from '@/store/ui'
import { useIsMobile } from '@/lib/useIsMobile'
import { Button } from '@/components/ui/button'
import { ApprovalPanel } from './ApprovalPanel'
import { StatusChip } from '@/components/domain/StatusChip'
import { RuleBadge } from '@/components/domain/RuleBadge'
import { EmptyState } from '@/components/domain/EmptyState'
import { Pagination, usePagination } from '@/components/domain/Pagination'
import { PageHeader } from '@/components/domain/PageHeader'
import { formatMoney, formatRelative } from '@/lib/format'

const RANK: Record<Role, number> = { customer_service_lead: 0, credit_manager: 1, finance_director: 2, returns_desk: -1 }
const QUEUE_STATUSES = ['awaiting_approval', 'approved', 'written_to_sap', 'sap_write_failed', 'closed']

/** The outcome at a glance: green approved, red rejected or failed, amber still waiting. */
const WAITING = { bar: 'border-l-warn', idle: 'bg-surface', active: 'bg-warn-soft/70' }
const GOOD = { bar: 'border-l-ok', idle: 'bg-ok-soft/30', active: 'bg-ok-soft' }
const BAD = { bar: 'border-l-bad', idle: 'bg-bad-soft/30', active: 'bg-bad-soft' }
const NEUTRAL = { bar: 'border-l-muted/50', idle: 'bg-surface', active: 'bg-surface-2' }
const look = (r: CaseSummary) =>
  r.status === 'awaiting_approval'
    ? WAITING
    : r.status === 'sap_write_failed' || r.outcome === 'rejected'
      ? BAD
      : r.outcome === 'approved'
        ? GOOD
        : NEUTRAL

const waitingFirst = (r: CaseSummary) => (r.status === 'awaiting_approval' ? 0 : 1)
/** When the case last moved: received, or changed since. Newest first in the queue. */
const latest = (r: CaseSummary) => (r.updatedAt > r.receivedAt ? r.updatedAt : r.receivedAt)

export function ApprovalsPage() {
  const { role } = useUi()
  const q = useCases()
  const search = useSearch({ strict: false }) as { case?: string }
  const [sel, setSel] = useState<string | null>(search.case ?? null)
  const [all, setAll] = useState(false)
  // On a phone the queue and the case are two steps: tap a row to open the case, go back for the queue.
  const mobile = useIsMobile()
  const [opened, setOpened] = useState(false)
  // The Returns desk has its own queue: returns written to SAP whose goods receipt it must confirm (step 5.1.3).
  const returnsDesk = role === 'returns_desk'
  const mine = (r: CaseSummary) =>
    returnsDesk ? r.status === 'written_to_sap' && r.documentType === 'YRE' : all || r.id === search.case || !r.approverRole || RANK[role] >= RANK[r.approverRole]
  const rows = (q.data ?? [])
    .filter((r) => QUEUE_STATUSES.includes(r.status) && mine(r))
    .sort((a, b) => waitingFirst(a) - waitingFirst(b) || latest(b).localeCompare(latest(a)))
  // Selection sticks to the case the person is working on, even after its status changes and it moves down the list.
  const selected = sel && rows.some((r) => r.id === sel) ? sel : (rows[0]?.id ?? '')
  useEffect(() => {
    if (!sel && rows[0]) setSel(rows[0].id)
  }, [sel, rows])
  const detail = useCase(selected)
  const c = detail.data
  const p = c ? primaryProposal(c) : undefined
  const waiting = rows.filter((r) => r.status === 'awaiting_approval').length
  const pager = usePagination(rows, 10, `${role}|${all}`)
  const panel = c && p ? <ApprovalPanel key={c.id} c={c} p={p} role={role} actor={ROLE_LABELS[role]} /> : <div />
  if (mobile && opened) {
    return (
      <div>
        <Button variant="ghost" size="sm" className="mb-3 -ml-2" onClick={() => setOpened(false)}>
          <ChevronLeft className="size-4" /> Back to the list
        </Button>
        {panel}
      </div>
    )
  }
  return (
    <div>
      <PageHeader
        title={returnsDesk ? 'Returns waiting for goods' : 'To approve'}
        description={
          returnsDesk
            ? `${rows.length} return${rows.length === 1 ? '' : 's'} to confirm once the warehouse has the goods.`
            : waiting
              ? `${waiting} proposal${waiting > 1 ? 's' : ''} waiting for ${all ? 'a decision' : `you as ${ROLE_LABELS[role]}`}. Check the briefing, then approve or reject.`
              : `Nothing is waiting for ${all ? 'a decision' : `you as ${ROLE_LABELS[role]}`}.`
        }
        extra={
          !returnsDesk && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer select-none hover:text-fg">Who approves what?</summary>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {APPROVAL_THRESHOLDS.map((t) => (
                  <li key={t.role}>
                    {t.upTo === Infinity ? 'Above 5 000' : `Up to ${t.upTo.toLocaleString('en-GB').replace(',', ' ')}`}:{' '}
                    <span className="text-fg">{ROLE_LABELS[t.role]}</span>
                  </li>
                ))}
                <li>No goods coming back: at least the <span className="text-fg">Credit manager</span></li>
              </ul>
            </details>
          )
        }
        actions={
          !returnsDesk && (
            <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show all roles
            </label>
          )
        }
      />
      {rows.length === 0 ? (
        returnsDesk ? (
          <EmptyState icon={CheckCircle2} title="No returns waiting" description="When an approver creates a customer return, it appears here until you confirm the goods receipt." />
        ) : (
          <EmptyState icon={CheckCircle2} title="Nothing to approve" description="You're all caught up. New proposals for your role appear here as soon as the agent has investigated a complaint." />
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="min-w-0">
          <ul className="space-y-2">
            {pager.pageRows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSel(r.id)
                    setOpened(true)
                  }}
                  aria-current={selected === r.id ? 'true' : undefined}
                  // Selected: the same outcome colour, only stronger, lifted towards the panel. Never another colour.
                  className={`relative w-full rounded-lg border border-y-line border-r-line p-3 text-left transition-all duration-150 ${
                    look(r).bar
                  } ${
                    selected === r.id
                      ? `border-l-8 pr-8 shadow-md md:translate-x-1 ${look(r).active}`
                      : `border-l-4 hover:shadow-card hover:brightness-[0.97] ${look(r).idle}`
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
                  {selected === r.id && (
                    <ChevronRight
                      className="absolute right-2 top-1/2 size-5 -translate-y-1/2 text-fg/60 max-md:hidden"
                      aria-hidden
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <Pagination page={pager.page} pages={pager.pages} pageSize={pager.pageSize} total={pager.total} onPage={pager.setPage} onPageSize={pager.setPageSize} noun="cases" />
          </div>
          {!mobile && panel}
        </div>
      )}
    </div>
  )
}
