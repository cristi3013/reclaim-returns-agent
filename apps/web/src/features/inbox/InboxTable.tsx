import { COMPLAINT_LABELS, ROLE_LABELS, type CaseSummary } from '@reclaim/shared'
import { StatusChip } from '@/components/domain/StatusChip'
import { RuleBadge } from '@/components/domain/RuleBadge'
import { DocTypeBadge } from '@/components/domain/DocTypeBadge'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { formatDateTime, formatMoney, formatRelative } from '@/lib/format'
import { isFresh, lastActivity, toggleSort, type InboxSort, type SortKey } from './view'

const th = 'px-3 py-2 text-left font-semibold'

/** A column header that sorts the table; aria-sort tells screen readers the current order. */
function SortTh({
  k,
  sort,
  onSort,
  right,
  children,
}: {
  k: SortKey
  sort: InboxSort
  onSort: (s: InboxSort) => void
  right?: boolean
  children: React.ReactNode
}) {
  const on = sort.key === k
  const Arrow = sort.dir === 'desc' ? ArrowDown : ArrowUp
  return (
    <th
      className={`${th} ${right ? 'text-right' : ''}`}
      aria-sort={on ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(toggleSort(sort, k))}
        className={`inline-flex items-center gap-1 uppercase tracking-wider hover:text-fg ${on ? 'text-fg' : ''}`}
      >
        {children}
        {on && <Arrow className="size-3" aria-hidden />}
      </button>
    </th>
  )
}

export function InboxTable({
  rows,
  onOpen,
  sort,
  onSort,
}: {
  rows: CaseSummary[]
  onOpen: (id: string) => void
  sort: InboxSort
  onSort: (s: InboxSort) => void
}) {
  const now = Date.now()
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
      <table className="w-full min-w-[1040px] text-sm">
        <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
          <tr>
            <SortTh k="received" sort={sort} onSort={onSort}>
              Received
            </SortTh>
            <th className={th}>Complaint</th>
            <th className={th}>Status</th>
            <th className={th}>Invoice</th>
            <th className={th}>Type</th>
            <th className={th}>Rule</th>
            <th className={th}>Proposed</th>
            <SortTh k="amount" sort={sort} onSort={onSort} right>
              Amount
            </SortTh>
            <th className={th}>Approver</th>
            <SortTh k="activity" sort={sort} onSort={onSort}>
              Updated
            </SortTh>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onOpen(r.id)}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)}
              className="cursor-pointer border-t border-line outline-none hover:bg-surface-2 focus:bg-surface-2"
            >
              <td className="whitespace-nowrap px-3 py-2 tnum text-muted">
                {formatDateTime(r.receivedAt).replace(/ \d{4}/, '')}
              </td>
              <td className="min-w-0 px-3 py-2">
                <div className="flex max-w-[17rem] items-center gap-1.5 font-medium">
                  {isFresh(r, now) && (
                    <span
                      className="size-2 shrink-0 rounded-full bg-info"
                      title="Changed in the last 2 minutes"
                      aria-label="New activity"
                    />
                  )}
                  <span className="truncate">{r.subject}</span>
                </div>
                <div className="max-w-[17rem] truncate text-xs text-muted">{r.from}</div>
              </td>
              <td className="px-3 py-2">
                <StatusChip status={r.status} />
              </td>
              <td className="px-3 py-2 font-mono">
                {r.invoiceNumber ?? <span className="text-muted">none</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2">{COMPLAINT_LABELS[r.complaintType]}</td>
              <td className="px-3 py-2">
                <RuleBadge ruleId={r.ruleId} />
              </td>
              <td className="px-3 py-2">
                {r.ruleId ? (
                  <DocTypeBadge type={r.documentType} compact />
                ) : (
                  <span className="text-muted">–</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tnum">
                {r.amount != null && r.amount > 0 ? formatMoney(r.amount, r.currency) : '–'}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                {r.approverRole ? ROLE_LABELS[r.approverRole] : '–'}
              </td>
              <td
                className="whitespace-nowrap px-3 py-2 text-muted"
                title={formatDateTime(lastActivity(r))}
              >
                {formatRelative(lastActivity(r), now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
