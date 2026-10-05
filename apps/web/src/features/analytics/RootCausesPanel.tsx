import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Download,
  Loader2,
  Minus,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { COMPLAINT_LABELS, type RootCauseBriefing, type RootCauseCluster } from '@reclaim/shared'
import { useGenerateRootCauses, useRootCauses } from '@/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/domain/ErrorState'
import { formatDate, formatMoney, formatPercent } from '@/lib/format'
import { exportRootCauses } from '@/features/reports/export'

const TREND = {
  rising: { icon: TrendingUp, label: 'Getting worse', cls: 'bg-warn-soft text-warn' },
  stable: { icon: Minus, label: 'Steady', cls: 'bg-info-soft text-info' },
  falling: { icon: TrendingDown, label: 'Easing', cls: 'bg-ok-soft text-ok' },
} as const

const SHOWN = 3

/**
 * Root causes: complaints that keep coming back, grouped by meaning, with what each costs and who can stop it.
 * The model names the problem and the fix; code computes every figure. Read-only: nothing here changes a case or SAP.
 */
export function RootCausesPanel() {
  const q = useRootCauses()
  const gen = useGenerateRootCauses()
  const b = q.data
  const [busy, setBusy] = useState(false)

  const download = async () => {
    if (!b) return
    setBusy(true)
    try {
      await exportRootCauses(b)
      toast.success('Report downloaded')
    } catch (e) {
      toast.error(e instanceof Error ? `Report failed: ${e.message}` : 'Report failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      className="mb-8 rounded-lg border border-line bg-surface p-4 shadow-card"
      aria-labelledby="root-causes"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="root-causes" className="text-base font-semibold text-fg">
            Root causes
          </h2>
          <p className="text-sm text-muted">
            Complaints that keep coming back, and who can stop them.
          </p>
        </div>
        <div className="flex gap-2">
          {b && (
            <Button size="sm" variant="outline" onClick={download} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}{' '}
              Download report
            </Button>
          )}
          <Button
            size="sm"
            variant={b ? 'outline' : 'default'}
            onClick={() => gen.mutate()}
            disabled={gen.isPending}
          >
            {gen.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {gen.isPending ? 'Reading complaints…' : b ? 'Check again' : 'Find root causes'}
          </Button>
        </div>
      </div>
      {gen.error && (
        <div className="mt-3">
          <ErrorState error={gen.error} onRetry={() => gen.mutate()} />
        </div>
      )}
      <div className="mt-3">
        {q.isLoading || (gen.isPending && !b) ? (
          <div className="space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !b ? (
          <p className="text-sm text-muted">
            The agent reads every complaint, in any language, and groups the ones about the same
            problem: what it costs, whether it is getting worse, and what to fix.
          </p>
        ) : (
          <Briefing b={b} />
        )}
      </div>
    </section>
  )
}

function Briefing({ b }: { b: RootCauseBriefing }) {
  const [all, setAll] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const cur = b.totals.currency
  const shown = all ? b.clusters : b.clusters.slice(0, SHOWN)
  const open = b.clusters.find((c) => c.id === openId) ?? null
  const languages = new Set(b.clusters.flatMap((c) => c.languages)).size

  if (!b.clusters.length)
    return (
      <p className="text-sm text-muted">
        No problem has come back three times or more. Nothing to fix upstream yet.
      </p>
    )
  return (
    <div>
      <p className="text-lg font-semibold tracking-tight text-fg">
        {b.clusters.length} {b.clusters.length === 1 ? 'problem' : 'problems'} caused{' '}
        <span className="tnum">{formatMoney(b.totals.clusteredValue, cur)}</span> of credit notes
        since {formatDate(b.period.from)}
      </p>
      <p className="text-xs text-muted">
        {formatPercent(b.totals.value ? b.totals.clusteredValue / b.totals.value : 0)} of all
        credit, from {b.totals.complaints} complaints in {languages}{' '}
        {languages === 1 ? 'language' : 'languages'}. Numbers computed from the data;{' '}
        {b.clusters.some((c) => c.wordedBy === 'model')
          ? `wording by ${b.generatedBy}, checked.`
          : 'standard wording.'}
      </p>
      {b.note && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-warn">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {b.note}
        </p>
      )}

      <ol className="mt-3 divide-y divide-line rounded-md border border-line">
        {shown.map((c) => (
          <ProblemRow key={c.id} c={c} onOpen={() => setOpenId(c.id)} />
        ))}
      </ol>
      {b.clusters.length > SHOWN && (
        <button
          type="button"
          className="mt-2 text-xs font-medium text-muted hover:text-fg hover:underline"
          onClick={() => setAll((a) => !a)}
        >
          {all ? 'Show fewer' : `Show ${b.clusters.length - SHOWN} more`}
        </button>
      )}
      {open && <ProblemDrawer c={open} onClose={() => setOpenId(null)} />}
    </div>
  )
}

function TrendChip({ c }: { c: RootCauseCluster }) {
  const t = TREND[c.trend]
  const Icon = t.icon
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${t.cls}`}
    >
      <Icon className="size-3.5" aria-hidden /> {t.label}
    </span>
  )
}

function ProblemRow({ c, onOpen }: { c: RootCauseCluster; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2.5 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
        aria-label={`${c.title}: details`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-fg">{c.title}</span>
            {c.trend === 'rising' && <TrendChip c={c} />}
          </div>
          <div className="mt-0.5 flex items-start gap-1 text-sm text-muted">
            <ArrowRight className="mt-0.5 size-3.5 shrink-0" aria-hidden /> <span>{c.action}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-sm font-semibold tnum text-fg">
            {formatMoney(c.value, c.currency)}
          </div>
          <div className="text-xs text-muted tnum">{c.complaints} complaints</div>
          {c.openCaseIds.length > 0 && (
            <div className="text-xs font-medium text-warn">
              {c.openCaseIds.length} open {c.openCaseIds.length === 1 ? 'case' : 'cases'} now
            </div>
          )}
        </div>
      </button>
    </li>
  )
}

function ProblemDrawer({ c, onClose }: { c: RootCauseCluster; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={c.title}
        className="h-full w-full max-w-xl overflow-y-auto border-l border-line bg-surface p-5 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <h3 className="min-w-0 flex-1 text-lg font-semibold text-fg">{c.title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted hover:text-fg"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <TrendChip c={c} />
          <span className="tnum">
            {c.last30Days} in the last 30 days, about {c.prior30DayAverage} a month before
          </span>
        </div>

        <dl className="mt-4 grid grid-cols-3 gap-2">
          <div>
            <dt className="text-xs text-muted">Credit given</dt>
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

        <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">
          Why it happens
        </h4>
        <p className="mt-1 text-sm text-fg">{c.rootCause}</p>
        <div className="mt-4 rounded-md border border-accent/30 bg-accent-soft p-3 text-sm">
          <div className="text-xs font-semibold text-accent">What to do · {c.owner}</div>
          <div className="mt-0.5 text-fg">{c.action}</div>
        </div>

        {c.openCaseIds.length > 0 && (
          <p className="mt-4 text-sm">
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
              {c.openCaseIds.length === 1 ? 'fits' : 'fit'} this problem.
            </span>
          </p>
        )}

        {c.quotes.length > 0 && (
          <>
            <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">
              In the customers' words
            </h4>
            <ul className="mt-1 space-y-1 text-sm">
              {c.quotes.map((x) => (
                <li key={x.id} className="border-l-2 border-line pl-2 italic text-muted">
                  “{x.text}”{' '}
                  <span className="font-mono text-xs uppercase not-italic">{x.language}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
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
          {c.customers.slice(0, 4).map((x) => (
            <span key={x.customer} className="rounded-full border border-line px-2 py-0.5">
              {x.name} · {x.count}
            </span>
          ))}
          {c.customers.length > 4 && (
            <span className="px-1 py-0.5 text-muted">+{c.customers.length - 4} customers</span>
          )}
        </div>

        <h4 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted">
          The {c.complaints} complaints
        </h4>
        <div className="mt-1 overflow-x-auto">
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

        <p className="mt-4 flex items-start gap-1.5 border-t border-line pt-3 text-xs text-muted">
          {c.wordedBy === 'model' ? (
            <>
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden /> Wording by
              the model, checked: it contains no number that is not in the data. Every figure above
              is computed.
            </>
          ) : c.groundingNote ? (
            <>
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />{' '}
              {c.groundingNote}
            </>
          ) : (
            'Standard wording. Every figure above is computed.'
          )}
        </p>
      </aside>
    </div>
  )
}
