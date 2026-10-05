import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Analytics } from '@reclaim/shared'
import { Link } from '@tanstack/react-router'
import { Card, useChartTokens } from './charts'
import { KpiTile } from '@/components/domain/KpiTile'

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} M` : n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(n))
const usd = (n: number, digits = 2) => `$${n.toFixed(digits)}`

/** What the model costs: tokens and estimated dollars per call, per case and per day, from the audit trail. */
export function ModelUsage({ data }: { data: Analytics }) {
  const t = useChartTokens()
  const m = data.model
  if (m.calls === 0) {
    return (
      <Card title="Model usage" reading="Tokens and cost per model call, from the audit trail. Nothing yet: cases so far ran rules-only or in the in-browser mock, which makes no model calls.">
        <div className="h-16" />
      </Card>
    )
  }
  const ex = m.byPurpose['extract']
  const na = m.byPurpose['narrate']
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Model usage</h3>
          <p className="text-xs text-muted">
            {m.calls} calls over {m.casesWithModel} cases on {m.models.join(', ')}. Costs are Anthropic list-price estimates; Bedrock invoices separately.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiTile label="Tokens in / out" value={`${k(m.inputTokens)} / ${k(m.outputTokens)}`} hint={m.cacheReadTokens ? `${k(m.cacheReadTokens)} served from cache` : 'no cache hits yet'} />
        <KpiTile label="Avg tokens per call" value={m.avgTokensPerCall == null ? '–' : k(m.avgTokensPerCall)} hint={m.avgLatencyMs == null ? '' : `${(m.avgLatencyMs / 1000).toFixed(1)} s per call on average`} />
        <KpiTile label="Avg tokens per case" value={m.avgTokensPerCase == null ? '–' : k(m.avgTokensPerCase)} hint={m.avgCostPerCaseUsd == null ? '' : `${usd(m.avgCostPerCaseUsd, 3)} per case`} />
        <KpiTile label="Estimated cost so far" value={usd(m.estimatedCostUsd, 3)} hint={m.projectedMonthlyCostUsd == null ? '' : `about ${usd(m.projectedMonthlyCostUsd)} / month at this pace`} />
        <KpiTile label="Heaviest case" value={m.maxCase ? k(m.maxCase.tokens) : '–'} hint={m.maxCase ? `${m.maxCase.caseId} · ${usd(m.maxCase.costUsd, 3)}` : ''} tone="warn" />
        <KpiTile label="Lightest case" value={m.minCase ? k(m.minCase.tokens) : '–'} hint={m.minCase ? `${m.minCase.caseId} · ${usd(m.minCase.costUsd, 3)}` : ''} tone="ok" />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0">
          <div className="mb-2 text-xs text-muted">Tokens per day, input and output</div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={m.perDay} margin={{ top: 4, right: 8, left: -10, bottom: 0 }} barCategoryGap="35%">
                <CartesianGrid vertical={false} stroke={t.grid} />
                <XAxis dataKey="day" tick={{ fill: t.ink, fontSize: 11 }} axisLine={{ stroke: t.line }} tickLine={false} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip
                  contentStyle={{ background: t.surface, border: `1px solid ${t.line}`, borderRadius: 6, color: t.text, fontSize: 12 }}
                  labelStyle={{ color: t.ink, fontSize: 11 }}
                  itemStyle={{ color: t.text }}
                  cursor={{ fill: t.grid, opacity: 0.5 }}
                  formatter={(v: number, name: string, item) => (name === 'Cost' ? usd(v, 3) : [k(v), `${name} · ${(item.payload as { calls: number }).calls} calls`])}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: t.ink }} iconType="square" iconSize={8} />
                <Bar dataKey="inputTokens" name="Input" stackId="a" fill={t.palette[1]} stroke={t.surface} strokeWidth={2} isAnimationActive={false} />
                <Bar dataKey="outputTokens" name="Output" stackId="a" fill={t.palette[0]} stroke={t.surface} strokeWidth={2} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="min-w-0 overflow-x-auto">
          <div className="mb-2 text-xs text-muted">By purpose</div>
          <table className="w-full min-w-[22rem] text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted">
              <tr><th className="text-left font-semibold">Call</th><th className="text-right font-semibold">Calls</th><th className="text-right font-semibold">In</th><th className="text-right font-semibold">Out</th><th className="text-right font-semibold">Avg time</th><th className="text-right font-semibold">Cost</th></tr>
            </thead>
            <tbody>
              {[['Read the email and photo', ex], ['Explain and draft the reply', na]].map(([label, p]) =>
                p && typeof p === 'object' ? (
                  <tr key={String(label)} className="border-t border-line">
                    <td className="py-1">{String(label)}</td>
                    <td className="py-1 text-right tnum">{p.calls}</td>
                    <td className="py-1 text-right tnum">{k(p.inputTokens)}</td>
                    <td className="py-1 text-right tnum">{k(p.outputTokens)}</td>
                    <td className="py-1 text-right tnum">{(p.avgLatencyMs / 1000).toFixed(1)} s</td>
                    <td className="py-1 text-right tnum font-mono">{usd(p.costUsd, 3)}</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">
            Every call is recorded on the case it served: open a case and look at the model events in its timeline.
            {m.maxCase && (
              <>
                {' '}The heaviest one is <Link to="/cases/$id" params={{ id: m.maxCase.caseId }} className="underline">{m.maxCase.caseId}</Link>.
              </>
            )}
          </p>
        </div>
      </div>
    </section>
  )
}
