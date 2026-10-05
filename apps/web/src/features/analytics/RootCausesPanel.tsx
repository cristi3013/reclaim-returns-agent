import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Minus,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { COMPLAINT_LABELS, type RootCauseBriefing, type RootCauseCluster } from '@reclaim/shared'
import { useGenerateRootCauses, useRootCauses } from '@/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/domain/ErrorState'
import { formatDate, formatDateTime, formatMoney, formatPercent } from '@/lib/format'

const TREND = {
  rising: { icon: TrendingUp, label: 'Rising', cls: 'bg-warn-soft text-warn' },
  stable: { icon: Minus, label: 'Stable', cls: 'bg-info-soft text-info' },
  falling: { icon: TrendingDown, label: 'Falling', cls: 'bg-ok-soft text-ok' },
} as const

/**
 * Root causes: similar complaints grouped by meaning, the model names cause and fix, code computes every figure.
 * Read-only; nothing here changes a case or SAP.
 */
export function RootCausesPanel() {
  const q = useRootCauses()
  const gen = useGenerateRootCauses()
  const b = q.data

  return (
    <section className="mb-8" aria-labelledby="root-causes">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="root-causes" className="text-base font-semibold text-fg">
            Root causes
          </h2>
          <p className="text-sm text-muted">
            Why money leaks through complaints, and what to fix upstream so they stop. The model
            reads the complaints and photos; every figure is computed from the data.
          </p>
        </div>
        <Button size="sm" onClick={() => gen.mutate()} disabled={gen.isPending}>
          {gen.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {gen.isPending ? 'Reading the complaints…' : b ? 'Refresh briefing' : 'Generate briefing'}
        </Button>
      </div>
      {gen.error && (
        <div className="mb-3">
          <ErrorState error={gen.error} onRetry={() => gen.mutate()} />
        </div>
      )}
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !b ? (
        <div className="rounded-lg border border-dashed border-line bg-surface p-6 text-sm text-muted">
          {gen.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : (
            <>
              No briefing yet. <span className="text-fg">Generate briefing</span> groups every
              complaint (this desk's and a quarter of archive) by what it is about, in any language,
              and names the cause and the fix for each group.
            </>
          )}
        </div>
      ) : (
        <Briefing b={b} />
      )}
    </section>
  )
}

function Briefing({ b }: { b: RootCauseBriefing }) {
  const cur = b.totals.currency
  const share = b.totals.value ? b.totals.clusteredValue / b.totals.value : 0
  return (
    <div>
      <div className="rounded-lg border border-line bg-surface p-4 shadow-card">
        <p className="text-lg font-semibold tracking-tight text-fg">
          {b.clusters.length === 0 ? (
            'No pattern of three or more similar complaints yet.'
          ) : (
            <>
              {b.clusters.length} {b.clusters.length === 1 ? 'issue explains' : 'issues explain'}{' '}
              <span className="tnum">{formatMoney(b.totals.clusteredValue, cur)}</span> of credit
              <span className="text-muted">
                {' '}
                ({formatPercent(share)} of {formatMoney(b.totals.value, cur)})
              </span>
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-muted">
          {b.totals.complaints} complaints from {formatDate(b.period.from)} to{' '}
          {formatDate(b.period.to)}: {b.totals.live} from this desk, {b.totals.archive} from the
          archive (sample data). Grouped by {b.embeddings.model}, vectors in {b.embeddings.store}.
          Worded by {b.generatedBy}
          {b.usage && (
            <>
              {' '}
              ({(b.usage.inputTokens + b.usage.outputTokens).toLocaleString()} tokens,{' '}
              {(b.usage.latencyMs / 1000).toFixed(0)} s)
            </>
          )}
          . Updated {formatDateTime(b.generatedAt)}.
        </p>
        {b.note && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-warn">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {b.note}
          </p>
        )}
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        {b.clusters.map((c) => (
          <ClusterCard key={c.id} c={c} total={b.totals.value} />
        ))}
      </div>
    </div>
  )
}

function ClusterCard({ c, total }: { c: RootCauseCluster; total: number }) {
  const [open, setOpen] = useState(false)
  const t = TREND[c.trend]
  const TrendIcon = t.icon
  return (
    <article className="min-w-0 rounded-lg border border-line bg-surface p-4 shadow-card">
      <header className="flex items-start gap-3">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
          aria-label={`Rank ${c.rank}`}
        >
          {c.rank}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-fg">{c.title}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${t.cls}`}
            >
              <TrendIcon className="size-3.5" aria-hidden /> {t.label}
            </span>
            <span className="tnum">
              {c.last30Days} in the last 30 days, {c.prior30DayAverage} a month before
            </span>
            <span>Confidence {c.confidence}</span>
          </div>
        </div>
      </header>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted">Credit</dt>
          <dd className="font-mono text-base font-semibold tnum text-fg">
            {formatMoney(c.value, c.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Complaints</dt>
          <dd className="text-base font-semibold tnum text-fg">{c.complaints}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Desk time</dt>
          <dd className="text-base font-semibold tnum text-fg">{c.deskHours} h</dd>
        </div>
      </dl>
      <div className="mt-2" title={`${formatPercent(c.share)} of all credit value`}>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-line"
          role="img"
          aria-label={`${formatPercent(c.share)} of all credit value`}
        >
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.max(2, Math.round((total ? c.value / total : 0) * 100))}%` }}
          />
        </div>
        <div className="mt-0.5 text-xs text-muted tnum">
          {formatPercent(c.share)} of all credit value
        </div>
      </div>

      <p className="mt-3 text-sm text-fg">{c.rootCause}</p>
      <div className="mt-3 rounded-md border border-accent/30 bg-accent-soft p-3 text-sm">
        <div className="text-xs font-semibold text-accent">Recommended action · {c.owner}</div>
        <div className="mt-0.5 text-fg">{c.action}</div>
      </div>

      {c.quotes.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {c.quotes.map((x) => (
            <li key={x.id} className="border-l-2 border-line pl-2 italic text-muted">
              “{x.text}”{' '}
              <span className="not-italic font-mono text-xs uppercase">{x.language}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {c.plants.map((p) => (
          <span key={p} className="rounded-full border border-line px-2 py-0.5">
            Plant {p}
          </span>
        ))}
        {c.materials.map((m) => (
          <span key={m} className="rounded-full border border-line px-2 py-0.5">
            Material {m}
          </span>
        ))}
        {c.customers.slice(0, 3).map((x) => (
          <span key={x.customer} className="rounded-full border border-line px-2 py-0.5">
            {x.name} · {x.count}
          </span>
        ))}
        {c.customers.length > 3 && (
          <span className="px-1 py-0.5 text-muted">+{c.customers.length - 3} customers</span>
        )}
      </div>

      {c.openCaseIds.length > 0 && (
        <p className="mt-3 text-sm">
          <span className="font-medium text-warn">Happening now:</span>{' '}
          {c.openCaseIds.map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              <Link to="/cases/$id" params={{ id }} className="font-mono underline hover:text-fg">
                {id}
              </Link>
            </span>
          ))}{' '}
          <span className="text-muted">
            {c.openCaseIds.length === 1 ? 'is' : 'are'} open and{' '}
            {c.openCaseIds.length === 1 ? 'fits' : 'fit'} this pattern.
          </span>
        </p>
      )}

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          {c.wordedBy === 'model' ? (
            <>
              <ShieldCheck className="size-3.5 text-ok" aria-hidden /> Model wording, checked: no
              figure that is not in the data
            </>
          ) : c.groundingNote ? (
            <>
              <TriangleAlert className="size-3.5 text-warn" aria-hidden /> {c.groundingNote}
            </>
          ) : (
            'Template wording'
          )}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 font-medium text-fg hover:underline"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}{' '}
          {open ? 'Hide' : 'Show'} {c.complaints} complaints
        </button>
      </footer>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr>
                <th className="py-1 text-left font-semibold">Received</th>
                <th className="text-left font-semibold">Customer</th>
                <th className="text-left font-semibold">Type</th>
                <th className="text-right font-semibold">Credit</th>
                <th className="text-right font-semibold">Complaint</th>
              </tr>
            </thead>
            <tbody>
              {c.members.map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="py-1 tnum">{formatDate(m.receivedAt)}</td>
                  <td>{m.customerName}</td>
                  <td>{COMPLAINT_LABELS[m.complaintType]}</td>
                  <td className="text-right font-mono tnum">
                    {m.documentType === 'NONE' ? '–' : formatMoney(m.amount, c.currency)}
                  </td>
                  <td className="text-right">
                    {m.source === 'live' ? (
                      <Link
                        to="/cases/$id"
                        params={{ id: m.id }}
                        className="font-mono underline hover:text-fg"
                      >
                        {m.id}
                      </Link>
                    ) : (
                      <span className="font-mono text-muted" title="Archive, sample data">
                        {m.id}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}
