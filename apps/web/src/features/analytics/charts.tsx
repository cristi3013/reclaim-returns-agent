import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalyticsSummary } from '@reclaim/shared'
import { COMPLAINT_LABELS, STATUS_LABELS, type CaseStatus, type ComplaintType } from '@reclaim/shared'
import { useUi } from '@/store/ui'
import { formatMoney } from '@/lib/format'

/**
 * Categorical series in a fixed order, validated for colour-vision deficiency and contrast
 * on both surfaces with the dataviz palette validator. Light and dark are separate sets, not a flip.
 */
const SERIES: { key: 'damaged' | 'price' | 'short_delivery' | 'other' | 'quality' | 'ruined'; label: string }[] = [
  { key: 'damaged', label: 'Damaged in transit' },
  { key: 'price', label: 'Price difference' },
  { key: 'short_delivery', label: 'Short delivery' },
  { key: 'other', label: 'Other' },
  { key: 'quality', label: 'Poor quality' },
  { key: 'ruined', label: 'Goods ruined' },
]
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

function useChartTokens() {
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

const weekLabel = (w: string) => {
  const d = new Date(w)
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}`
}

function tooltipStyle(t: ReturnType<typeof useChartTokens>) {
  return {
    contentStyle: { background: t.surface, border: `1px solid ${t.line}`, borderRadius: 6, color: t.text, fontSize: 12 },
    labelStyle: { color: t.ink, fontSize: 11 },
    itemStyle: { color: t.text },
    cursor: { fill: t.grid, opacity: 0.5 },
  }
}

function Card({ title, reading, children }: { title: string; reading: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-card">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted">{reading}</p>
      {children}
    </section>
  )
}

export function CasesByWeek({ data }: { data: AnalyticsSummary }) {
  const t = useChartTokens()
  const rows = data.weeks.map((w) => ({ ...w, label: weekLabel(w.week) }))
  const total = rows.reduce((s, w) => s + SERIES.reduce((x, k) => x + w[k.key], 0), 0)
  return (
    <Card title="Complaints per week by type" reading={`${total} complaints in 12 weeks. Damage in transit is the largest share every week.`}>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke={t.grid} />
            <XAxis dataKey="label" tick={{ fill: t.ink, fontSize: 11 }} axisLine={{ stroke: t.line }} tickLine={false} />
            <YAxis tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip {...tooltipStyle(t)} />
            <Legend wrapperStyle={{ fontSize: 11, color: t.ink }} iconType="square" iconSize={8} />
            {SERIES.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={t.palette[i]} stroke={t.surface} strokeWidth={2} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

export function ValueByWeek({ data }: { data: AnalyticsSummary }) {
  const t = useChartTokens()
  const rows = data.weeks.map((w) => ({ label: weekLabel(w.week), approved: w.approvedValue, rejected: w.rejectedValue }))
  const approved = rows.reduce((s, r) => s + r.approved, 0)
  const rejected = rows.reduce((s, r) => s + r.rejected, 0)
  return (
    <Card
      title="Credit value approved vs rejected per week"
      reading={`${formatMoney(approved, data.currency)} approved, ${formatMoney(rejected, data.currency)} rejected. Rejections are a small share of the value proposed.`}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%" barGap={2}>
            <CartesianGrid vertical={false} stroke={t.grid} />
            <XAxis dataKey="label" tick={{ fill: t.ink, fontSize: 11 }} axisLine={{ stroke: t.line }} tickLine={false} />
            <YAxis tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
            <Tooltip {...tooltipStyle(t)} formatter={(v: number) => formatMoney(v, data.currency)} />
            <Legend wrapperStyle={{ fontSize: 11, color: t.ink }} iconType="square" iconSize={8} />
            <Bar dataKey="approved" name="Approved" fill={t.palette[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="rejected" name="Rejected" fill={t.palette[2]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

export function OutcomeMix({ data }: { data: AnalyticsSummary }) {
  const t = useChartTokens()
  const rows = Object.entries(data.byStatus)
    .map(([k, v]) => ({ label: STATUS_LABELS[k as CaseStatus] ?? k, value: v }))
    .sort((a, b) => b.value - a.value)
  const types = Object.entries(data.byType)
    .map(([k, v]) => ({ label: COMPLAINT_LABELS[k as ComplaintType] ?? k, value: v }))
    .sort((a, b) => b.value - a.value)
  return (
    <Card title="Live cases by outcome" reading={rows.length ? `${rows.reduce((s, r) => s + r.value, 0)} cases in this session, grouped by what happened to them.` : 'No cases yet. Seed and run the demo cases to fill this chart.'}>
      {rows.length === 0 ? (
        <div className="h-64" />
      ) : (
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 24, left: 8, bottom: 0 }} barCategoryGap="25%">
              <CartesianGrid horizontal={false} stroke={t.grid} />
              <XAxis type="number" tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={150} tick={{ fill: t.ink, fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...tooltipStyle(t)} />
              <Bar dataKey="value" name="Cases" fill={t.palette[0]} radius={[0, 3, 3, 0]} isAnimationActive={false} label={{ position: 'right', fill: t.ink, fontSize: 11 }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {types.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
          {types.map((x) => (
            <span key={x.label} className="rounded bg-surface-2 px-2 py-0.5">
              {x.label}: <span className="tnum text-fg">{x.value}</span>
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}
