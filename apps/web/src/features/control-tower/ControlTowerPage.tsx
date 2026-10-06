import { useState } from 'react'
import { toast } from 'sonner'
import { Link } from '@tanstack/react-router'
import { AGENTS, type Answer, type Finding, type Route, type Snapshot } from '@reclaim/shared'
import { useAskControlTower, useControlTower, useControlTowerMemo, useControlTowerNotes, useHandoverFinding, useRunControlTower } from '@/api'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/domain/ErrorState'
import { KpiTile } from '@/components/domain/KpiTile'
import { Pagination, usePagination } from '@/components/domain/Pagination'
import { Markdown } from './Markdown'
import { formatRelative } from '@/lib/format'

const money = (m: Record<string, number>) => (Object.keys(m).length ? Object.entries(m).map(([c, v]) => `${v.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).replace(/,/g, ' ')} ${c}`).join(' + ') : 'not valued')
const amt = (v: number | null, c: string) => (v == null ? 'not valued' : `${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ' ')} ${c}`)

const SAMPLE = [
  'Why is DSO up for Norway?',
  'What blocks the September close?',
  'XYZ Partner Limited (customer 10044): what leaks most?',
  'Order 1876 is flagged as delivered, not billed. Is this revenue leakage?',
  'Is order 1937 a clean example from order to invoice?',
  'Please release the billing block on 1368 and invoice it today',
  'How much do Swiss customers owe us that is already overdue?',
]
const VERDICT = { ready: 'ok', 'at risk': 'warn', 'not ready': 'bad' } as const
const KIND_LABEL: Record<Finding['kind'], string> = { pod_pending: 'Waiting for POD', shipped_not_billed: 'Shipped, not billed', order_block: 'Blocked order', credit_block: 'Credit block', overdue_receivable: 'Overdue', return_without_credit: 'Return without credit', conformance_deviation: 'Deviation' }

/**
 * The O2C Control Tower (extra credit, agent 10). It reads SAP and changes nothing: KPIs per currency, findings
 * with their L4 step and route, the close memo, honest answers to management questions, routing notes.
 */
export function ControlTowerPage() {
  const q = useControlTower()
  const run = useRunControlTower()
  const [tab, setTab] = useState<'findings' | 'memo' | 'notes' | 'log'>('findings')
  const d = q.data
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">O2C Control Tower</h1>
          <p className="text-sm text-muted">Where money leaks out of order-to-cash, and which agent fixes each leak. Read-only: nothing here changes SAP.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {d && <span className="text-xs text-muted">Snapshot as of {d.asOf} · {d.requestLog.length} GET requests</span>}
          <Button size="sm" onClick={() => run.mutate(undefined, { onSuccess: () => toast.success('Snapshot refreshed from SAP reads') })} disabled={run.isPending}>
            {run.isPending ? 'Reading…' : 'Run the snapshot'}
          </Button>
        </div>
      </div>
      {!d ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          <Panels d={d} />
          <Ask />
          <div className="mt-6 flex gap-1 border-b border-line text-sm">
            {(['findings', 'memo', 'notes', 'log'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t} className={`-mb-px border-b-2 px-3 py-2 ${tab === t ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
                {{ findings: `Findings (${d.findings.filter((f) => f.severity !== 'watch').length})`, memo: 'Close memo', notes: 'Routing notes', log: `Request log (${d.requestLog.length})` }[t]}
              </button>
            ))}
          </div>
          {tab === 'findings' && <Findings d={d} />}
          {tab === 'memo' && <Memo />}
          {tab === 'notes' && <Notes />}
          {tab === 'log' && <Log d={d} />}
        </>
      )}
    </div>
  )
}

function Panels({ d }: { d: Snapshot }) {
  const k = d.kpis
  const overdue = Object.entries(k.overdue)
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <div className={`rounded-lg border p-4 ${{ ok: 'border-ok bg-ok-soft', warn: 'border-warn bg-warn-soft', bad: 'border-bad bg-bad-soft' }[VERDICT[d.verdict]]}`}>
        <div className="text-[11px] uppercase tracking-wider text-muted">Close verdict · {d.period}</div>
        <div className={`mt-1 text-xl font-semibold sm:text-2xl ${{ ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' }[VERDICT[d.verdict]]}`}>{d.verdict}</div>
        <div className="mt-1 text-xs text-muted">{d.verdictWhy}</div>
      </div>
      <KpiTile label="Blocked orders" value={money(k.blocked.value)} hint={`${k.blocked.count} orders · ageing 0–7: ${k.blocked.ageing['0-7']}, 8–30: ${k.blocked.ageing['8-30']}, 31+: ${k.blocked.ageing['31+']} · ${k.blocked.credit} credit${k.blocked.capped ? ' · list cut at its cap' : ''}`} tone={k.blocked.ageing['31+'] ? 'warn' : 'neutral'} />
      <KpiTile label="Overdue receivables" value={overdue.map(([, o]) => `${o.total.toLocaleString('en-GB', { maximumFractionDigits: 0 }).replace(/,/g, ' ')} ${o.currency}`).join(' + ') || 'none'} hint={overdue.map(([cc, o]) => `${o.customers} customers in ${cc}`).join(' · ')} tone={overdue.length ? 'bad' : 'neutral'} />
      <KpiTile label="Waiting for POD" value={`${k.awaitingPod.count} deliveries`} hint={`${k.awaitingPod.over14d} older than 14 days · ${money(k.awaitingPod.value)} valued · counted once with unbilled`} tone={k.awaitingPod.over14d ? 'warn' : 'neutral'} />
      <KpiTile label="Shipped, not billed" value={`${k.unbilled.count} deliveries`} hint={`${k.unbilled.currentPeriod} this period: ${k.unbilled.withinGrace} within grace, ${k.unbilled.over14d} past 14 days (${k.unbilled.over14dPod} POD, ${k.unbilled.over14dBilling} billing) · ${k.unbilled.legacy} legacy${k.unbilled.capped ? ' · list cut at its cap' : ''}`} />
      <KpiTile label="Returns without credit" value={String(k.returns.count)} hint="customer returns older than 7 days with no credit memo · routed to this agent" tone={k.returns.count ? 'warn' : 'neutral'} />
      <KpiTile label="Conformance" value={`${k.conformance.conform} of ${k.conformance.walked}`} hint={`orders walked; deviations ${Object.entries(k.conformance.deviationsByL4).map(([l, n]) => `${l}: ${n}`).join(', ') || 'none'}`} />
      <KpiTile label="Lists cut at their cap" value={String(d.rowCaps.length)} hint={d.rowCaps.length ? d.rowCaps[0]! : 'every list was read in full'} tone={d.rowCaps.length ? 'warn' : 'ok'} />
      {d.notRead.length > 0 && (
        <div role="alert" className="col-span-full rounded-md border border-warn bg-warn-soft p-3 text-sm text-warn">
          Not read this run: {d.notRead.map((n) => `${n.section} (${n.error})`).join('; ')}. The picture is incomplete for those sections; nothing was guessed.
        </div>
      )}
    </div>
  )
}

function Ask() {
  const ask = useAskControlTower()
  const [text, setText] = useState('')
  const [answer, setAnswer] = useState<Answer | null>(null)
  const submit = (question: string) => {
    setText(question)
    ask.mutate(question, { onSuccess: setAnswer, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not answer') })
  }
  return (
    <section className="mt-4 rounded-lg border border-line bg-surface p-4 shadow-card" aria-label="Ask the Control Tower">
      <h2 className="text-sm font-semibold">Ask a question</h2>
      <p className="text-xs text-muted">Every number in the answer comes from this run's SAP reads. No finding for the subject means an honest "no data", never an invented cause.</p>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (text.trim()) submit(text.trim())
        }}
      >
        <input aria-label="Question" value={text} onChange={(e) => setText(e.target.value)} placeholder="Why is DSO up for Norway?" className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-sm" />
        <Button type="submit" size="sm" disabled={ask.isPending || !text.trim()}>
          {ask.isPending ? 'Reading…' : 'Ask'}
        </Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SAMPLE.map((s) => (
          <button key={s} type="button" onClick={() => submit(s)} className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs text-muted hover:text-fg">
            {s}
          </button>
        ))}
      </div>
      {answer && (
        <div className="mt-4 rounded-md border border-line bg-surface-2 p-3" role="region" aria-label="Answer">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {answer.refused && <span className="rounded bg-bad-soft px-1.5 py-0.5 font-semibold text-bad">Refused: read-only</span>}
            {answer.noData && <span className="rounded bg-warn-soft px-1.5 py-0.5 font-semibold text-warn">No data for the subject</span>}
            <span className="rounded bg-surface px-1.5 py-0.5 text-muted">topic: {answer.topic.replace('_', ' ')}</span>
            {answer.subject.country && <span className="rounded bg-surface px-1.5 py-0.5 text-muted">country {answer.subject.country}</span>}
            {answer.subject.customer && <span className="rounded bg-surface px-1.5 py-0.5 text-muted">customer {answer.subject.customer}</span>}
            {answer.subject.order && <span className="rounded bg-surface px-1.5 py-0.5 text-muted">order {answer.subject.order}</span>}
            <span className="ml-auto text-muted">route: {AGENTS[answer.routeTo]} · worded by {answer.phrasedBy}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed">{answer.text}</p>
          {answer.facts.length > 0 && (
            <details className="mt-2 text-xs text-muted">
              <summary className="cursor-pointer">The computed facts behind it ({answer.facts.length})</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{answer.facts.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

function Findings({ d }: { d: Snapshot }) {
  const handover = useHandoverFinding()
  const [route, setRoute] = useState<Route | ''>('')
  const [legacy, setLegacy] = useState(false)
  const rows = d.findings.filter((f) => f.severity !== 'watch' && (route ? f.routeTo === route : true) && f.legacy === legacy)
  const pager = usePagination(rows, 25, `${route}|${legacy}|${d.asOf}`)
  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="Route" value={route} onChange={(e) => setRoute(e.target.value as Route | '')} className="h-8 rounded-md border border-line bg-surface px-2 text-sm">
          <option value="">Every fixing agent</option>
          {(['pod', 'billing', 'blocks', 'cash', 'returns'] as Route[]).map((r) => <option key={r} value={r}>{AGENTS[r]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={legacy} onChange={(e) => setLegacy(e.target.checked)} /> Legacy items (older than a year, reported apart)
        </label>
        <span className="ml-auto text-xs text-muted">{rows.length} findings · a delivery waiting for POD is never also a billing finding</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
            <tr>{['Document', 'Customer (country)', 'Value', 'Age', 'Severity', 'L4', 'Rule', 'Why', 'Route to', 'Owner of the data', ''].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {pager.pageRows.map((f) => (
              <tr key={f.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap px-3 py-2"><span className="text-xs text-muted">{KIND_LABEL[f.kind]}</span><br /><span className="font-mono">{f.documentType} {f.document}</span></td>
                <td className="px-3 py-2">{f.customerName ?? f.customer} <span className="text-xs text-muted">({f.country ?? '–'})</span></td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tnum">{amt(f.value, f.currency)}</td>
                <td className="whitespace-nowrap px-3 py-2 tnum">{f.ageDays} d</td>
                <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs font-medium ${f.severity === 'high' ? 'bg-bad-soft text-bad' : f.severity === 'medium' ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted'}`}>{f.severity}</span></td>
                <td className="px-3 py-2 font-mono text-xs">{f.l4}</td>
                <td className="px-3 py-2 font-mono text-xs">{f.rule}</td>
                <td className="max-w-md px-3 py-2 text-xs">{f.why}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{AGENTS[f.routeTo]}</td>
                <td className="px-3 py-2 text-xs">{f.dataOwner}</td>
                <td className="px-3 py-2">
                  {f.routeTo === 'returns' && (
                    <Button size="sm" variant="outline" className="h-7" disabled={handover.isPending} onClick={() => handover.mutate(f.id, { onSuccess: (r) => (r.ok ? toast.success(`Handed over: case ${r.caseId} in the complaints inbox`) : toast.error(r.message)) })}>
                      Hand over
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={pager.page} pages={pager.pages} pageSize={pager.pageSize} total={pager.total} onPage={pager.setPage} onPageSize={pager.setPageSize} noun="findings" />
    </div>
  )
}

function Memo() {
  const memo = useControlTowerMemo(true)
  if (memo.isLoading) return <Skeleton className="mt-3 h-64" />
  if (memo.error) return <ErrorState error={memo.error} onRetry={() => memo.refetch()} />
  return (
    <div className="mt-3 rounded-lg border border-line bg-surface p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-xs text-muted">The close-readiness memo in the organisers' template: verdict first, KPIs per currency, legacy apart.</span>
        <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => navigator.clipboard?.writeText(memo.data ?? '').then(() => toast.success('Memo copied as markdown'))}>Copy markdown</Button>
      </div>
      <Markdown text={memo.data ?? ''} />
    </div>
  )
}

function Notes() {
  const notes = useControlTowerNotes(true)
  if (notes.isLoading) return <Skeleton className="mt-3 h-40" />
  return (
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      {(notes.data ?? []).map((n) => (
        <section key={n.id} className="rounded-lg border border-line bg-surface p-4">
          <h3 className="text-sm font-semibold">{n.agent}</h3>
          <p className="text-xs text-muted">{n.subject} · L4 {n.l4.join(', ')} · {n.findingIds.length} documents · information only</p>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-xs">{n.body}</pre>
          {n.route === 'returns' && <p className="mt-2 text-xs text-muted">This agent is <Link to="/inbox" className="underline">this system</Link>: hand the findings over from the findings tab.</p>}
        </section>
      ))}
      {notes.data?.length === 0 && <p className="text-sm text-muted">No finding to route.</p>}
    </div>
  )
}

function Log({ d }: { d: Snapshot }) {
  return (
    <div className="mt-3 rounded-lg border border-line bg-surface p-4">
      <p className="text-xs text-muted">Every SAP request of this run. GET only: the Control Tower has no write call. Captured {formatRelative(new Date().toISOString())} from the organisers' DS4 answers of {d.asOf}.</p>
      <ol className="mt-2 list-decimal space-y-0.5 pl-6 font-mono text-[11px]">{d.requestLog.map((r, i) => <li key={i} className="break-all">{r}</li>)}</ol>
    </div>
  )
}
