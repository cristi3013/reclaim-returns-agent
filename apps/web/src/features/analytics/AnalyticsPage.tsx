import { useAnalytics, useCases } from '@/api'
import { KpiTile } from '@/components/domain/KpiTile'
import { ErrorState } from '@/components/domain/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Card, CasesOverTime, DecisionsByRule, Outcomes, ValueFunnel } from './charts'
import { ValueCalculator } from './ValueCalculator'
import { ModelUsage } from './ModelUsage'
import { formatDateTime, formatMoney, formatPercent } from '@/lib/format'
import { COMPLAINT_LABELS, ROLE_LABELS, STATUS_LABELS, type CaseStatus, type ComplaintType } from '@reclaim/shared'
import { Download } from 'lucide-react'
import { toast } from 'sonner'

const minutes = (m: number | null) => (m == null ? '–' : m < 1 ? '< 1 min' : m < 90 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`)

export function AnalyticsPage() {
  const q = useAnalytics()
  const cases = useCases()
  const d = q.data

  const exportCsv = () => {
    const rows = cases.data ?? []
    const head = ['id', 'received', 'from', 'subject', 'customer', 'invoice', 'type', 'rule', 'document', 'amount', 'currency', 'approver', 'status']
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [head.join(','), ...rows.map((r) => [r.id, r.receivedAt, r.from, r.subject, r.customerName ?? r.customer, r.invoiceNumber, COMPLAINT_LABELS[r.complaintType], r.ruleId, r.documentType, r.amount, r.currency, r.approverRole ? ROLE_LABELS[r.approverRole] : '', STATUS_LABELS[r.status]].map(esc).join(','))].join('\n')
    navigator.clipboard
      ?.writeText(csv)
      .then(() => toast.success(`${rows.length} cases copied as CSV`))
      .catch(() => toast.error('Copy is not available here'))
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div>
          <h1 className="text-xl font-semibold">Analytics</h1>
          <p className="text-sm text-muted">Computed from the cases in this system, nothing invented. {d && <span className="text-xs">Updated {formatDateTime(d.generatedAt)}.</span>}</p>
        </div>
        <Button variant="outline" size="sm" className="sm:ml-auto" onClick={exportCsv} disabled={!cases.data?.length}>
          <Download className="size-4" /> Copy cases as CSV
        </Button>
      </div>
      {q.isLoading || !d ? (
        q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Skeleton className="h-96" />
      ) : (
        <>
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Volume and money</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="Complaints" value={String(d.totals.cases)} hint={`${d.totals.last24h} in the last 24 h`} />
            <KpiTile label="Awaiting approval" value={String(d.totals.byStatus['awaiting_approval'] ?? 0)} hint={d.timing.oldestPendingMinutes != null ? `oldest waiting ${minutes(d.timing.oldestPendingMinutes)}` : 'queue is empty'} tone={(d.totals.byStatus['awaiting_approval'] ?? 0) > 0 ? 'warn' : 'neutral'} />
            <KpiTile label="Credit proposed" value={formatMoney(d.value.proposed, d.currency)} hint="by the agent, awaiting a person" />
            <KpiTile label="Credit approved" value={formatMoney(d.value.approved, d.currency)} hint={`${formatMoney(d.value.released, d.currency)} released to billing`} tone="ok" />
            <KpiTile label="Credit rejected" value={formatMoney(d.value.rejected, d.currency)} hint={`${d.approvals.rejected} proposal(s) rejected`} tone={d.value.rejected > 0 ? 'bad' : 'neutral'} />
            <KpiTile label="Accepted unchanged" value={d.approvals.acceptedUnchangedRatio == null ? '–' : formatPercent(d.approvals.acceptedUnchangedRatio)} hint={`${d.approvals.editedQuantity} with an edited quantity`} />
          </div>

          <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted">Speed and control</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="Email to proposal" value={minutes(d.timing.medianMinutesToProposal)} hint="median, includes mail delivery" />
            <KpiTile label="Email to decision" value={minutes(d.timing.medianMinutesToDecision)} hint="median, a person decided" />
            <KpiTile label="Agent processing" value={d.timing.medianAgentSeconds == null ? '–' : `${Math.round(d.timing.medianAgentSeconds)} s`} hint="median, read + SAP + decide + explain" />
            <KpiTile label="Duplicates prevented" value={String(d.control.duplicatesPrevented)} hint="rule R8, no second credit" tone={d.control.duplicatesPrevented > 0 ? 'ok' : 'neutral'} />
            <KpiTile label="Intercompany flagged" value={String(d.control.intercompanyFlagged)} hint="step 5.2.2, for finance" />
            <KpiTile label="SAP conflicts refused" value={String(d.control.sapConflicts)} hint={`${d.control.sapWriteFailures} write(s) failed, nothing overwritten`} tone={d.control.sapConflicts > 0 ? 'warn' : 'neutral'} />
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <CasesOverTime data={d} />
            <ValueFunnel data={d} />
            <DecisionsByRule data={d} />
            <Outcomes data={d} />
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <Card title="SAP and model" reading="How the agent worked, from the audit trail of every case.">
              <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
                <dt className="text-muted">SAP lookups</dt><dd className="tnum text-right">{d.sap.lookups}{d.sap.avgLookupMs != null && <span className="text-muted"> · {d.sap.avgLookupMs} ms avg</span>}</dd>
                <dt className="text-muted">Returns created (YRE)</dt><dd className="tnum text-right">{d.sap.returnsCreated}</dd>
                <dt className="text-muted">Credit requests created (YCR)</dt><dd className="tnum text-right">{d.sap.creditRequestsCreated}</dd>
                <dt className="text-muted">Billing blocks released</dt><dd className="tnum text-right">{d.sap.released}</dd>
                <dt className="text-muted">Run with the model</dt><dd className="tnum text-right">{d.totals.byAiMode['assisted'] ?? 0}</dd>
                <dt className="text-muted">Run rules-only</dt><dd className="tnum text-right">{d.totals.byAiMode['rules_only'] ?? 0}</dd>
                <dt className="text-muted">Policy gaps (no rule matched)</dt><dd className="tnum text-right">{d.control.policyGaps}</dd>
                <dt className="text-muted">Last evaluation</dt><dd className={`tnum text-right ${d.eval && d.eval.passed === d.eval.total ? 'text-ok' : ''}`}>{d.eval ? `${d.eval.passed} of ${d.eval.total}` : 'not run'}</dd>
              </dl>
            </Card>
            <Card title="By channel and type" reading="Where complaints come from and what they are about.">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <dl className="grid grid-cols-[1fr_auto] gap-y-1">
                  {Object.entries(d.totals.byChannel).sort((a, b) => b[1] - a[1]).map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted capitalize">{k}</dt><dd className="tnum text-right">{v}</dd></div>))}
                </dl>
                <dl className="grid grid-cols-[1fr_auto] gap-y-1">
                  {Object.entries(d.totals.byType).sort((a, b) => b[1] - a[1]).map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{COMPLAINT_LABELS[k as ComplaintType] ?? k}</dt><dd className="tnum text-right">{v}</dd></div>))}
                </dl>
              </div>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1 border-t border-line pt-2 text-sm">
                {Object.entries(d.totals.byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{STATUS_LABELS[k as CaseStatus] ?? k}</dt><dd className="tnum text-right">{v}</dd></div>))}
              </dl>
            </Card>
            <Card title="Top customers" reading="Who complains most, and how much credit is involved.">
              {d.topCustomers.length === 0 ? <div className="text-sm text-muted">No cases yet.</div> : (
                <table className="w-full text-sm">
                  <thead className="text-[11px] uppercase tracking-wider text-muted"><tr><th className="text-left font-semibold">Customer</th><th className="text-right font-semibold">Cases</th><th className="text-right font-semibold">Credit</th></tr></thead>
                  <tbody>{d.topCustomers.map((c) => (<tr key={c.customer} className="border-t border-line"><td className="py-1">{c.name} <span className="font-mono text-xs text-muted">{c.customer}</span></td><td className="py-1 text-right tnum">{c.cases}</td><td className="py-1 text-right font-mono tnum">{formatMoney(c.value, d.currency)}</td></tr>))}</tbody>
                </table>
              )}
            </Card>
          </div>

          <div className="mt-4">
            <ModelUsage data={d} />
          </div>

          <div className="mt-6">
            <ValueCalculator measured={{ agentSeconds: d.timing.medianAgentSeconds, minutesToDecision: d.timing.medianMinutesToDecision, cases: d.totals.cases, casesLast24h: d.totals.last24h, duplicatesPrevented: d.control.duplicatesPrevented, intercompanyFlagged: d.control.intercompanyFlagged }} />
          </div>
        </>
      )}
    </div>
  )
}
