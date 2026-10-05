import { Link } from '@tanstack/react-router'
import { useAnalytics, useCases, useSettings, useStatus } from '@/api'
import { useUi } from '@/store/ui'
import { KpiTile } from '@/components/domain/KpiTile'
import { ErrorState } from '@/components/domain/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { ROLE_LABELS } from '@reclaim/shared'
import { formatMoney, formatRelative } from '@/lib/format'
import { ApprovalsWidget, AttentionWidget, MiniCharts, QuickActions, RecentActivity } from './widgets'

const minutes = (m: number | null) => (m == null ? '–' : m < 1 ? '< 1 min' : m < 90 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`)

/**
 * The home page: what needs a person right now, the few numbers that matter today, and one-click ways in.
 * Everything comes from the same cases, analytics and status the other pages use; nothing is computed here.
 */
export function DashboardPage() {
  const cases = useCases()
  const analytics = useAnalytics()
  const { data: agent } = useStatus()
  const { data: settings } = useSettings()
  const { role } = useUi()
  const all = cases.data ?? []
  const d = analytics.data
  const waiting = all.filter((c) => c.status === 'awaiting_approval').length
  const unprocessed = all.filter((c) => c.status === 'received').length

  if (cases.error) return <ErrorState error={cases.error} onRetry={() => cases.refetch()} />

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted">
            {all.length === 0
              ? 'No complaints yet. Seed the demo cases or send an email to the mailbox.'
              : waiting
                ? `${waiting} complaint${waiting > 1 ? 's' : ''} waiting for a decision${d?.timing.oldestPendingMinutes != null ? `, the oldest for ${minutes(d.timing.oldestPendingMinutes)}` : ''}.`
                : 'Nothing is waiting for a decision.'}
            {unprocessed > 0 && ` ${unprocessed} not investigated yet.`}
          </p>
        </div>
        <ul className="ml-auto flex flex-wrap gap-2 text-xs text-muted" aria-label="System">
          {agent?.mailbox && (
            <li className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1">
              <span className={`size-1.5 rounded-full ${agent.mailbox.connected ? 'bg-ok' : 'bg-warn'}`} aria-hidden />
              {agent.mailbox.connected ? 'Mailbox listening' : 'Mailbox reconnecting'}
              {agent.mailbox.lastMessageAt && <span className="hidden sm:inline"> · last email {formatRelative(agent.mailbox.lastMessageAt)}</span>}
            </li>
          )}
          {settings && <li className="rounded-md border border-line bg-surface px-2 py-1">SAP {settings.sapMode === 'real' ? 'DS4' : 'mock'}</li>}
          {agent && <li className="rounded-md border border-line bg-surface px-2 py-1">{agent.ai}</li>}
          <li className="rounded-md border border-line bg-surface px-2 py-1">You are {ROLE_LABELS[role]}</li>
        </ul>
      </div>

      {!d ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Link to="/approvals"><KpiTile label="Awaiting approval" value={String(waiting)} hint={d.timing.oldestPendingMinutes != null ? `oldest waiting ${minutes(d.timing.oldestPendingMinutes)}` : 'queue is empty'} tone={waiting ? 'warn' : 'neutral'} /></Link>
          <Link to="/inbox"><KpiTile label="Complaints, 24 h" value={String(d.totals.last24h)} hint={`${d.totals.cases} in total`} /></Link>
          <Link to="/analytics"><KpiTile label="Credit approved" value={formatMoney(d.value.approved, d.currency)} hint={`${formatMoney(d.value.released, d.currency)} released`} tone="ok" /></Link>
          <Link to="/analytics"><KpiTile label="Email to decision" value={minutes(d.timing.medianMinutesToDecision)} hint={d.timing.medianAgentSeconds != null ? `agent ${Math.round(d.timing.medianAgentSeconds)} s of it` : 'median'} /></Link>
          <Link to="/analytics"><KpiTile label="Duplicates prevented" value={String(d.control.duplicatesPrevented)} hint={`${d.control.intercompanyFlagged} intercompany flagged`} tone={d.control.duplicatesPrevented ? 'ok' : 'neutral'} /></Link>
          <Link to="/analytics"><KpiTile label="Model cost" value={`$${d.model.estimatedCostUsd.toFixed(2)}`} hint={d.model.avgCostPerCaseUsd != null ? `$${d.model.avgCostPerCaseUsd.toFixed(3)} per case` : 'no model calls yet'} /></Link>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <ApprovalsWidget cases={all} role={role} />
          <AttentionWidget cases={all} />
          {d && <MiniCharts data={d} />}
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <QuickActions unprocessed={unprocessed} hasCases={all.length > 0} />
          <RecentActivity cases={all} />
        </div>
      </div>
    </div>
  )
}
