import type { CaseStatus, CaseSummary, InvoiceCaseStatus } from '@reclaim/shared'

export type SortKey = 'activity' | 'received' | 'amount'
export type SortDir = 'asc' | 'desc'
export interface InboxSort {
  key: SortKey
  dir: SortDir
}

export const DEFAULT_SORT: InboxSort = { key: 'activity', dir: 'desc' }

export const SORT_OPTIONS: { value: string; label: string; sort: InboxSort }[] = [
  { value: 'activity:desc', label: 'Latest activity', sort: { key: 'activity', dir: 'desc' } },
  { value: 'received:desc', label: 'Newest received', sort: { key: 'received', dir: 'desc' } },
  { value: 'received:asc', label: 'Oldest received', sort: { key: 'received', dir: 'asc' } },
  { value: 'amount:desc', label: 'Highest amount', sort: { key: 'amount', dir: 'desc' } },
]

/** Statuses that wait on us: approve, or retry the SAP write. Pending waits on the customer. */
export const NEEDS_ACTION: readonly CaseStatus[] = ['awaiting_approval', 'sap_write_failed']

/** '' is every email, 'action' the ones in NEEDS_ACTION, anything else the status of their case. */
export type StatusFilter = '' | 'action' | InvoiceCaseStatus

export const CASE_FILTERS: readonly InvoiceCaseStatus[] = ['open', 'pending', 'closed']

/** The last time anything happened on the case: received, or updated since. */
export function lastActivity(r: CaseSummary): string {
  return r.updatedAt > r.receivedAt ? r.updatedAt : r.receivedAt
}

export function matchesStatus(
  r: CaseSummary,
  f: StatusFilter,
  caseStatus: InvoiceCaseStatus | undefined,
): boolean {
  if (!f) return true
  if (f === 'action') return NEEDS_ACTION.includes(r.status)
  return caseStatus === f
}

export function matchesQuery(r: CaseSummary, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return `${r.subject} ${r.from} ${r.invoiceNumber ?? ''} ${r.customerName ?? ''} ${r.customer ?? ''}`
    .toLowerCase()
    .includes(q)
}

export function sortRows(rows: CaseSummary[], s: InboxSort): CaseSummary[] {
  const value = (r: CaseSummary): string | number =>
    s.key === 'amount' ? (r.amount ?? -1) : s.key === 'received' ? r.receivedAt : lastActivity(r)
  const sign = s.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = value(a)
    const y = value(b)
    const c = x < y ? -1 : x > y ? 1 : 0
    // Ties (same amount, same second): newest received first, so the order is stable between refreshes.
    return c !== 0 ? c * sign : b.receivedAt.localeCompare(a.receivedAt)
  })
}

/** Click on a column header: the same column flips direction, a new column starts newest/highest first. */
export function toggleSort(current: InboxSort, key: SortKey): InboxSort {
  if (current.key === key) return { key, dir: current.dir === 'desc' ? 'asc' : 'desc' }
  return { key, dir: 'desc' }
}

/** Changed in the last two minutes: marked in the table so a new email or a decision stands out. */
export function isFresh(r: CaseSummary, now = Date.now()): boolean {
  return now - new Date(lastActivity(r)).getTime() < 2 * 60_000
}
