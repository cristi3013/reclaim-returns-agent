import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Analytics } from '@reclaim/shared'
import { RULES, type RuleId } from '@reclaim/shared'
import { useUi } from '@/store/ui'
import { useIsMobile } from '@/lib/useIsMobile'
import { formatMoney } from '@/lib/format'

/** Categorical colours validated for colour-vision deficiency and contrast on both surfaces (dataviz validator). */
const LIGHT = ['#046A38', '#0073B1', '#9A6F0A', '#8B4A8F', '#5E8F00', '#0097A9']
const DARK = ['#4CA86F', '#3B8CD6', '#BD8822', '#B072BB', '#70A41F', '#2B93B0']

function useDark() {
  const theme = useUi((s) => s.theme)
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    const compute = () => setDark(theme === 'dark' || (theme === 'system' && !!mq?.matches))
    compute()
    mq?.addEventListener?.('change', compute)
    return () => mq?.removeEventListener?.('change', compute)
  }, [theme])
  return dark
}

export function useChartTokens() {
  const dark = useDark()
  return {
    palette: dark ? DARK : LIGHT,
    grid: dark ? '#2A3036' : '#E3E6EB',
    ink: dark ? '#9AA3AD' : '#5F6873',
    surface: dark ? '#15181C' : '#FFFFFF',
    line: dark ? '#2A3036' : '#D8DCE2',
    text: dark ? '#E8EAED' : '#121417',
  }
}

function tooltipStyle(t: ReturnType<typeof useChartTokens>) {
  return {
    contentStyle: { background: t.surface, border: `1px solid ${t.line}`, borderRadius: 6, color: t.text, fontSize: 12 },
    labelStyle: { color: t.ink, fontSize: 11 },
    itemStyle: { color: t.text },
    cursor: { fill: t.grid, opacity: 0.5 },
  }
}

export function Card({ title, reading, children }: { title: string; reading: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border border-line bg-surface p-4 shadow-card">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted">{reading}</p>
      {children}
    </section>
  )
}

const BUCKET_LABEL = { hour: 'hour', day: 'day', week: 'week' }

export function CasesOverTime({ data }: { data: Analytics }) {
  const t = useChartTokens()
  const rows = data.series.points
  const total = rows.reduce((s, p) => s + p.received, 0)
  return (
    <Card title={`Complaints per ${BUCKET_LABEL[data.series.bucket]}`} reading={total ? `${total} received, ${rows.reduce((s, p) => s + p.approved, 0)} approved so far. Buckets adapt to the span of the data.` : 'No cases yet.'}>
      <div className="h-60">
        {rows.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke={t.grid} />
              <XAxis dataKey="label" tick={{ fill: t.ink, fontSize: 11 }} axisLine={{ stroke: t.line }} tickLine={false} />
              <YAxis tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...tooltipStyle(t)} />
              <Legend wrapperStyle={{ fontSize: 11, color: t.ink }} iconType="square" iconSize={8} />
              <Bar dataKey="approved" name="Approved" stackId="a" fill={t.palette[0]} stroke={t.surface} strokeWidth={2} isAnimationActive={false} />
              <Bar dataKey="rejected" name="Rejected" stackId="a" fill={t.palette[2]} stroke={t.surface} strokeWidth={2} isAnimationActive={false} />
              <Bar dataKey="noDocument" name="No document" stackId="a" fill={t.palette[1]} stroke={t.surface} strokeWidth={2} isAnimationActive={false} />
              <Bar dataKey="received" name="Received" fill={t.palette[5]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}

export function DecisionsByRule({ data }: { data: Analytics }) {
  const t = useChartTokens()
  const rows = (Object.keys(RULES) as RuleId[])
    .map((r) => ({ rule: r === 'NONE' ? 'no rule' : r, label: RULES[r].situation, count: data.totals.byRule[r] ?? 0 }))
    .filter((r) => r.count > 0)
  return (
    <Card title="Decisions by policy rule" reading={rows.length ? `${rows.length} of the nine rules applied in this period. Hover a bar for the rule text.` : 'No decisions yet.'}>
      <div className="h-60">
        {rows.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }} barCategoryGap="25%">
              <CartesianGrid horizontal={false} stroke={t.grid} />
              <XAxis type="number" tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="rule" width={56} tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle(t)} formatter={(v: number, _n, item) => [v, (item.payload as { label: string }).label]} />
              <Bar dataKey="count" name="Cases" fill={t.palette[0]} radius={[0, 3, 3, 0]} isAnimationActive={false} label={{ position: 'right', fill: t.ink, fontSize: 11 }} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}

export function ValueFunnel({ data }: { data: Analytics }) {
  const t = useChartTokens()
  const mobile = useIsMobile()
  const v = data.value
  const rows = [
    { step: 'Proposed', value: v.proposed },
    { step: mobile ? 'Awaiting' : 'Awaiting approval', value: v.pending },
    { step: 'Approved', value: v.approved },
    { step: mobile ? 'Released' : 'Released to billing', value: v.released },
    { step: 'Rejected', value: v.rejected },
  ]
  const money = (x: number) => (mobile ? `${Math.round(x / 1000)}k` : formatMoney(x, data.currency))
  return (
    <Card title="Credit value through the process" reading={v.proposed ? `${formatMoney(v.proposed, data.currency)} proposed by the agent; ${formatMoney(v.approved, data.currency)} approved by a person; ${formatMoney(v.released, data.currency)} released to billing.` : 'No credit proposed yet.'}>
      <div className="h-60">
        {v.proposed > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: mobile ? 36 : 90, left: mobile ? 0 : 8, bottom: 0 }} barCategoryGap="25%">
              <CartesianGrid horizontal={false} stroke={t.grid} />
              <XAxis type="number" tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(x: number) => (x >= 1000 ? `${Math.round(x / 1000)}k` : String(x))} />
              <YAxis type="category" dataKey="step" width={mobile ? 70 : 130} tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle(t)} formatter={(x: number) => formatMoney(x, data.currency)} />
              <Bar dataKey="value" name="Value" fill={t.palette[0]} radius={[0, 3, 3, 0]} isAnimationActive={false} label={{ position: 'right', fill: t.ink, fontSize: 11, formatter: money }} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}

export function Outcomes({ data }: { data: Analytics }) {
  const t = useChartTokens()
  const mobile = useIsMobile()
  const rows = Object.entries(data.totals.byOutcome).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  const short = (s: string) => (mobile && s.length > 16 ? `${s.slice(0, 15)}…` : s)
  return (
    <Card title="What happened to each complaint" reading={rows.length ? 'Documents created versus cases that correctly ended without one.' : 'No outcomes yet.'}>
      <div className="h-60">
        {rows.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, left: mobile ? 0 : 8, bottom: 0 }} barCategoryGap="25%">
              <CartesianGrid horizontal={false} stroke={t.grid} />
              <XAxis type="number" tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={mobile ? 110 : 210} tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={short} />
              <Tooltip {...tooltipStyle(t)} />
              <Bar dataKey="value" name="Cases" fill={t.palette[1]} radius={[0, 3, 3, 0]} isAnimationActive={false} label={{ position: 'right', fill: t.ink, fontSize: 11 }} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}
