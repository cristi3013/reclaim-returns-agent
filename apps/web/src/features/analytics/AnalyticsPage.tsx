import { useAnalytics } from '@/api'
import { KpiTile } from '@/components/domain/KpiTile'
import { ErrorState } from '@/components/domain/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { CasesByWeek, OutcomeMix, ValueByWeek } from './charts'
import { ValueCalculator } from './ValueCalculator'
import { formatMoney, formatPercent } from '@/lib/format'

export function AnalyticsPage() {
  const q = useAnalytics()
  const d = q.data
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted">
          How the returns desk is doing, and what the agent is worth. Twelve weeks of demo history plus the cases from this session.
        </p>
      </div>
      {q.isLoading || !d ? (
        q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <Skeleton className="h-96" />
        )
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3 xl:grid-cols-7">
            <KpiTile label="Cases this month" value={String(d.casesThisMonth)} />
            <KpiTile label="Pending approvals" value={String(d.pendingApprovals)} tone={d.pendingApprovals > 0 ? 'warn' : 'neutral'} />
            <KpiTile label="Credit value approved" value={formatMoney(Math.round(d.approvedValue), d.currency)} tone="ok" />
            <KpiTile label="Median hours to approval" value={d.medianHoursToApproval.toFixed(1)} hint="from email to decision" />
            <KpiTile label="Accepted unchanged" value={formatPercent(d.acceptedUnchangedRatio)} hint="proposals approved as proposed" />
            <KpiTile label="Duplicates prevented" value={String(d.duplicatesPrevented)} hint="rule R8" />
            <KpiTile label="Intercompany flagged" value={String(d.intercompanyFlagged)} hint="step 5.2.2" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <CasesByWeek data={d} />
            <ValueByWeek data={d} />
          </div>
          <div className="mt-4">
            <OutcomeMix data={d} />
          </div>
          <p className="mt-2 text-xs text-muted">
            Weekly series are demo history, generated for the hackathon and marked as such. Live cases from this session are counted on top.
          </p>
          <div className="mt-6">
            <ValueCalculator />
          </div>
        </>
      )}
    </div>
  )
}
