import { INVOICE_CASE_LABELS, type CaseSummary, type InvoiceCaseStatus } from '@reclaim/shared'
import { cn } from '@/lib/utils'
import { CASE_FILTERS, matchesStatus, type StatusFilter } from './view'

/** One chip per case status (Open, Pending, Closed) with its count; "Needs action" groups what waits on a person. */
export function StatusFilters({
  rows,
  caseStatus,
  value,
  onChange,
}: {
  rows: CaseSummary[]
  caseStatus: Map<string, InvoiceCaseStatus>
  value: StatusFilter
  onChange: (f: StatusFilter) => void
}) {
  const count = (f: StatusFilter) =>
    rows.filter((r) => matchesStatus(r, f, caseStatus.get(r.id))).length
  const present = CASE_FILTERS.filter((s) => s === value || count(s) > 0)
  const chips: { f: StatusFilter; label: string }[] = [
    { f: '', label: 'All' },
    { f: 'action', label: 'Needs action' },
    ...present.map((s) => ({ f: s, label: INVOICE_CASE_LABELS[s] })),
  ]
  return (
    <div role="group" aria-label="Filter by status" className="mb-3 flex flex-wrap gap-1.5">
      {chips.map(({ f, label }) => {
        const n = count(f)
        const on = value === f
        return (
          <button
            key={f || 'all'}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on && f ? '' : f)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors',
              on
                ? 'border-accent bg-accent-soft font-medium text-fg'
                : 'border-line bg-surface text-muted hover:bg-surface-2 hover:text-fg',
              f === 'action' && !on && n > 0 && 'border-warn text-warn',
            )}
          >
            {label}
            <span className="tnum opacity-70">{n}</span>
          </button>
        )
      })}
    </div>
  )
}
