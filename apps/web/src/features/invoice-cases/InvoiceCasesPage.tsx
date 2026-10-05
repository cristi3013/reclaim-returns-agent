import { Link, useNavigate } from '@tanstack/react-router'
import { groupByInvoice } from '@reclaim/shared'
import { useCases } from '@/api'
import { PageHeader } from '@/components/domain/PageHeader'
import { StatusChip } from '@/components/domain/StatusChip'
import { ErrorState } from '@/components/domain/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatRelative } from '@/lib/format'
import { CHIP } from './status'

const th = 'px-3 py-2 text-left font-semibold'

/** One case per invoice: every complaint and email about that invoice in one place. */
export function InvoiceCasesPage() {
  const q = useCases()
  const navigate = useNavigate()
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const rows = q.data ?? []
  const cases = groupByInvoice(rows)
  const noInvoice = rows.filter((r) => !r.invoiceNumber).length
  const open = (invoice: string) => navigate({ to: '/invoices/$invoice', params: { invoice } })
  const now = Date.now()
  return (
    <div>
      <PageHeader
        title="Cases"
        description="One case per invoice. A new invoice opens a new case; a new email about an invoice that already has a case lands in it and reopens it."
        extra={
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>
              {cases.filter((c) => c.status === 'open').length} open ·{' '}
              {cases.filter((c) => c.status === 'pending').length} pending ·{' '}
              {cases.filter((c) => c.status === 'closed').length} closed
            </span>
            {noInvoice > 0 && (
              <Link to="/inbox" className="hover:text-fg hover:underline">
                {noInvoice} complaint{noInvoice === 1 ? '' : 's'} without an invoice yet, in the
                Inbox
              </Link>
            )}
          </div>
        }
      />
      {cases.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-8 text-center text-sm text-muted shadow-card">
          No cases yet. A case opens when a complaint names an invoice.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-surface-2 text-xs font-medium text-muted">
              <tr>
                <th className={th}>Invoice</th>
                <th className={th}>Status</th>
                <th className={th}>Customer</th>
                <th className={th}>Latest email</th>
                <th className={`${th} text-right`}>Complaints</th>
                <th className={th}>Opened</th>
                <th className={th}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr
                  key={c.invoice}
                  onClick={() => open(c.invoice)}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && open(c.invoice)}
                  className="cursor-pointer border-t border-line outline-none hover:bg-surface-2 focus:bg-surface-2"
                >
                  <td className="px-3 py-2 font-mono font-medium">{c.invoice}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <StatusChip status={CHIP[c.status]} />
                      {c.reopened && (
                        <span className="rounded bg-info-soft px-1.5 py-0.5 text-[11px] font-medium text-info">
                          Reopened
                        </span>
                      )}
                      {c.awaitingApproval > 0 && (
                        <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn">
                          {c.awaitingApproval} to approve
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {c.customerName ?? '–'}
                    {c.customer && (
                      <span className="ml-1 font-mono text-xs text-muted">{c.customer}</span>
                    )}
                  </td>
                  <td className="max-w-[20rem] truncate px-3 py-2">{c.subject}</td>
                  <td className="px-3 py-2 text-right tnum">{c.complaints.length}</td>
                  <td className="whitespace-nowrap px-3 py-2 tnum text-muted">
                    {formatDateTime(c.openedAt).replace(/ \d{4}/, '')}
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2 text-muted"
                    title={formatDateTime(c.lastActivityAt)}
                  >
                    {formatRelative(c.lastActivityAt, now)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
