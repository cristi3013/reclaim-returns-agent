import { useMemo, useState } from 'react'
import { FileSpreadsheet, FileText, FileCode } from 'lucide-react'
import { toast } from 'sonner'
import { buildReport, ROLE_LABELS, type Report } from '@reclaim/shared'
import { useFullCases, useStatus } from '@/api'
import { useUi } from '@/store/ui'
import { KpiTile } from '@/components/domain/KpiTile'
import { Pagination, usePagination } from '@/components/domain/Pagination'
import { ErrorState } from '@/components/domain/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Card } from '@/features/analytics/charts'
import { formatDateTime, formatMoney } from '@/lib/format'
import { PageHeader } from '@/components/domain/PageHeader'
import { exportReport, type ExportFormat } from './export'

const PRESETS = [
  { key: 'all', label: 'All cases', days: null },
  { key: 'today', label: 'Today', days: 0 },
  { key: '7d', label: 'Last 7 days', days: 6 },
  { key: '30d', label: 'Last 30 days', days: 29 },
] as const

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

export const FORMATS: { format: ExportFormat; label: string; hint: string; icon: typeof FileText }[] = [
  { format: 'xlsx', label: 'Excel', hint: 'One sheet per table, filters on', icon: FileSpreadsheet },
  { format: 'pdf', label: 'PDF', hint: 'Printable audit pack', icon: FileText },
  { format: 'xml', label: 'XML', hint: 'For import into other systems', icon: FileCode },
]

export async function runExport(r: Report, format: ExportFormat, suffix = '') {
  try {
    await exportReport(r, format, suffix)
    toast.success(`${format.toUpperCase()} report downloaded`)
  } catch (e) {
    toast.error(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed')
  }
}

export function ReportsPage() {
  const q = useFullCases()
  const status = useStatus()
  const { role } = useUi()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState<ExportFormat | null>(null)

  const report = useMemo(
    () => (q.data ? buildReport(q.data, { from: from || null, to: to || null, generatedBy: ROLE_LABELS[role], sapMode: status.data?.sapSystem ?? 'DS4' }) : null),
    [q.data, from, to, role, status.data?.sapSystem],
  )

  const preset = (days: number | null) => {
    if (days === null) return (setFrom(''), setTo(''))
    const now = new Date()
    setFrom(isoDay(new Date(now.getTime() - days * 86_400_000)))
    setTo(isoDay(now))
  }

  const download = async (format: ExportFormat) => {
    if (!report) return
    setBusy(format)
    await runExport(report, format)
    setBusy(null)
  }

  const events = useMemo(() => report?.tables.find((t) => t.key === 'events')?.rows ?? [], [report])
  const newestFirst = useMemo(() => [...events].reverse(), [events])
  const pager = usePagination(newestFirst, 25, `${from}|${to}`)

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Download the audit trail for finance and audit: a summary, every complaint, who approved what, the SAP documents and the full event log. Pick a period, then a format."
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <Button key={p.key} variant="outline" size="sm" onClick={() => preset(p.days)}>
            {p.label}
          </Button>
        ))}
        <label className="ml-2 text-xs text-muted">
          From
          <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="ml-1 h-8 rounded-md border border-line bg-surface px-2 text-sm text-fg" />
        </label>
        <label className="text-xs text-muted">
          To
          <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="ml-1 h-8 rounded-md border border-line bg-surface px-2 text-sm text-fg" />
        </label>
      </div>

      {q.isLoading || !report ? (
        q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Skeleton className="h-96" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="Cases" value={String(report.meta.caseCount)} hint={report.meta.from || report.meta.to ? `${report.meta.from ?? 'start'} to ${report.meta.to ?? 'today'}` : 'all time'} />
            <KpiTile label="Credit approved" value={formatMoney(report.analytics.value.approved, report.meta.currency)} hint={`${formatMoney(report.analytics.value.released, report.meta.currency)} released`} tone="ok" />
            <KpiTile label="Credit pending" value={formatMoney(report.analytics.value.pending, report.meta.currency)} hint="awaiting a person" />
            <KpiTile label="Approvals" value={String(report.tables[2]!.rows.length)} hint={`${report.analytics.approvals.rejected} rejected`} />
            <KpiTile label="SAP documents" value={String(report.tables[3]!.rows.length)} hint={`${report.analytics.sap.released} released`} />
            <KpiTile label="Audit events" value={String(events.length)} hint="every step, with its L4 id" />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {FORMATS.map((f) => (
              <button
                key={f.format}
                type="button"
                onClick={() => download(f.format)}
                disabled={busy !== null}
                className="flex items-center gap-3 rounded-lg border border-line bg-surface p-4 text-left shadow-card hover:bg-surface-2 disabled:opacity-60"
              >
                <f.icon className="size-8 shrink-0 text-accent" />
                <span>
                  <span className="block font-semibold">{busy === f.format ? 'Preparing…' : `Download ${f.label}`}</span>
                  <span className="block text-xs text-muted">{f.hint}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4">
            <Card title="Audit log" reading={`${events.length} events in this period, newest first. The exports hold the same.`}>
              {events.length === 0 ? (
                <p className="text-sm text-muted">No events in this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-muted">
                      <tr>
                        <th className="py-1 pr-3 font-medium">Time</th>
                        <th className="py-1 pr-3 font-medium">Case</th>
                        <th className="py-1 pr-3 font-medium">L4</th>
                        <th className="py-1 pr-3 font-medium">Kind</th>
                        <th className="py-1 font-medium">Event</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pager.pageRows.map((e, i) => (
                        <tr key={i} className="border-t border-line">
                          <td className="tnum whitespace-nowrap py-1 pr-3">{formatDateTime(String(e.at))}</td>
                          <td className="whitespace-nowrap py-1 pr-3 font-mono text-xs">{e.caseId}</td>
                          <td className="py-1 pr-3 font-mono text-xs" title={e.l4Name ? String(e.l4Name) : undefined}>{e.l4Step ?? '–'}</td>
                          <td className="py-1 pr-3 text-xs">{e.kind}</td>
                          <td className="py-1">{e.title}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination page={pager.page} pages={pager.pages} pageSize={pager.pageSize} total={pager.total} onPage={pager.setPage} onPageSize={pager.setPageSize} noun="events" />
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
