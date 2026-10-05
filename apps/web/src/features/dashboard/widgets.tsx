import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRight, Database, Inbox, MailPlus, Play, Unlock, Upload, UserCheck } from 'lucide-react'
import { COMPLAINT_LABELS, ROLE_LABELS, RULES, type Analytics, type CaseSummary, type Role, type RuleId } from '@reclaim/shared'
import { useIngest, useRunAll, useRunCase, useSeed } from '@/api'
import { Button } from '@/components/ui/button'
import { StatusChip } from '@/components/domain/StatusChip'
import { RuleBadge } from '@/components/domain/RuleBadge'
import { DocTypeBadge } from '@/components/domain/DocTypeBadge'
import { NewComplaintDialog } from '@/features/inbox/NewComplaintDialog'
import { formatMoney, formatRelative } from '@/lib/format'

const RANK: Record<Role, number> = { customer_service_lead: 0, credit_manager: 1, finance_director: 2, returns_desk: -1 }

export function Widget({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface shadow-card" aria-label={title}>
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {hint && <p className="truncate text-xs text-muted">{hint}</p>}
        </div>
        {action}
      </header>
      <div className="p-2">{children}</div>
    </section>
  )
}

function Row({ children, to, params, search }: { children: React.ReactNode; to: string; params?: Record<string, string>; search?: Record<string, string> }) {
  return (
    <Link to={to} params={params} search={search} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-2">
      {children}
    </Link>
  )
}

const Empty = ({ text }: { text: string }) => <p className="px-2 py-6 text-center text-sm text-muted">{text}</p>

/** Cases the current role can decide, oldest first. Others' are counted, not listed: the queue is per role. */
export function ApprovalsWidget({ cases, role }: { cases: CaseSummary[]; role: Role }) {
  const waiting = cases.filter((c) => c.status === 'awaiting_approval').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
  const mine = waiting.filter((c) => !c.approverRole || RANK[role] >= RANK[c.approverRole])
  const higher = waiting.length - mine.length
  return (
    <Widget
      title="Waiting for your approval"
      hint={waiting.length ? `${mine.length} for ${ROLE_LABELS[role]}${higher ? `, ${higher} need a higher role` : ''}` : 'Nothing waiting for a decision'}
      action={
        <Link to="/approvals" className="flex items-center gap-1 text-xs text-muted hover:text-fg">
          All approvals <ArrowRight className="size-3" />
        </Link>
      }
    >
      {mine.length === 0 ? (
        <Empty text={higher ? `${higher} waiting for ${ROLE_LABELS[waiting[0]!.approverRole ?? 'credit_manager']}. Switch role in the top bar to review.` : 'Run a case and its proposal lands here.'} />
      ) : (
        <ul>
          {mine.slice(0, 5).map((c) => (
            <li key={c.id}>
              <Row to="/approvals" search={{ case: c.id }}>
                <UserCheck className="size-4 shrink-0 text-warn" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.subject}</span>
                  <span className="block truncate text-xs text-muted">
                    {c.customerName ?? c.customer} · invoice {c.invoiceNumber ?? 'none'} · {COMPLAINT_LABELS[c.complaintType]} · waiting {formatRelative(c.updatedAt).replace(' ago', '')}
                  </span>
                </span>
                <RuleBadge ruleId={c.ruleId} />
                <DocTypeBadge type={c.documentType ?? 'NONE'} />
                <span className="hidden w-28 text-right font-mono tnum sm:block">{c.amount ? formatMoney(c.amount, c.currency) : '–'}</span>
              </Row>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  )
}

/** Things a person has to unblock: failed writes, blocks waiting for release, complaints never run, customer input. */
export function AttentionWidget({ cases }: { cases: CaseSummary[] }) {
  const run = useRunCase()
  const items: { c: CaseSummary; why: string; tone: 'bad' | 'warn' | 'info'; action?: React.ReactNode }[] = []
  for (const c of cases) {
    if (c.status === 'sap_write_failed') items.push({ c, why: 'SAP refused the write; nothing was written', tone: 'bad' })
    else if (c.status === 'written_to_sap') items.push({ c, why: `${c.documentType} created with billing block 08, waiting for release`, tone: 'warn', action: <Link to="/approvals" search={{ case: c.id }} className="flex items-center gap-1 text-xs text-accent hover:underline"><Unlock className="size-3" /> Release</Link> })
    else if (c.status === 'needs_customer_input') items.push({ c, why: 'Waiting for the customer to confirm', tone: 'info' })
    else if (c.status === 'received') items.push({ c, why: `Received ${formatRelative(c.receivedAt)}, not investigated yet`, tone: 'info', action: <Button size="sm" variant="outline" className="h-7" disabled={run.isPending} onClick={(e) => { e.preventDefault(); run.mutate(c.id, { onError: (err) => toast.error(err instanceof Error ? err.message : 'Run failed') }) }}><Play className="size-3" /> Run</Button> })
  }
  const order = { bad: 0, warn: 1, info: 2 }
  items.sort((a, b) => order[a.tone] - order[b.tone] || a.c.updatedAt.localeCompare(b.c.updatedAt))
  const dot = { bad: 'bg-bad', warn: 'bg-warn', info: 'bg-info' }
  return (
    <Widget title="Needs your attention" hint={items.length ? `${items.length} item(s) a person has to unblock` : 'Nothing is stuck'}>
      {items.length === 0 ? (
        <Empty text="No failed writes, no blocks waiting, nothing unprocessed." />
      ) : (
        <ul>
          {items.slice(0, 6).map(({ c, why, tone, action }) => (
            <li key={c.id} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-2">
              <span className={`size-2 shrink-0 rounded-full ${dot[tone]}`} aria-hidden />
              <Link to="/cases/$id" params={{ id: c.id }} className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.subject}</span>
                <span className="block truncate text-xs text-muted">{why}</span>
              </Link>
              {action}
            </li>
          ))}
          {items.length > 6 && <li className="px-2 pt-1 text-xs text-muted">and {items.length - 6} more in the inbox</li>}
        </ul>
      )}
    </Widget>
  )
}

export function QuickActions({ unprocessed, hasCases }: { unprocessed: number; hasCases: boolean }) {
  const seed = useSeed()
  const runAll = useRunAll()
  const ingest = useIngest()
  const file = useRef<HTMLInputElement>(null)
  const [compose, setCompose] = useState(false)
  const Item = ({ icon: Icon, label, hint, onClick, disabled, primary }: { icon: typeof Play; label: string; hint: string; onClick: () => void; disabled?: boolean; primary?: boolean }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-50 ${primary ? 'text-accent' : ''}`}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </button>
  )
  return (
    <Widget title="Quick actions">
      <NewComplaintDialog open={compose} onClose={() => setCompose(false)} />
      <input ref={file} type="file" accept=".eml,message/rfc822" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) ingest.mutate(fs, { onSuccess: (r) => toast.success(`${r.length} email(s) added`) }); e.target.value = '' }} />
      <Item icon={Play} label={runAll.isPending ? 'Investigating…' : unprocessed ? `Investigate ${unprocessed} new` : 'Investigate all'} hint="Investigate every complaint that has not been run" primary disabled={runAll.isPending || !hasCases} onClick={() => runAll.mutate(undefined, { onSuccess: () => toast.success('All complaints investigated'), onError: (e) => toast.error(e instanceof Error ? e.message : 'Run failed') })} />
      <Item icon={MailPlus} label="New complaint" hint="Type the email a customer would send" onClick={() => setCompose(true)} />
      <Item icon={Upload} label="Upload email" hint="Emails saved from the returns mailbox" onClick={() => file.current?.click()} />
      <Item icon={Database} label="Load demo complaints" hint="The eight hackathon complaints" disabled={seed.isPending} onClick={() => seed.mutate(undefined, { onSuccess: () => toast.success('Eight demo complaints loaded') })} />
      <Link to="/inbox" className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-2">
        <Inbox className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block font-medium">Open the inbox</span><span className="block text-xs text-muted">Every complaint, searchable</span></span>
      </Link>
    </Widget>
  )
}

export function RecentActivity({ cases }: { cases: CaseSummary[] }) {
  const recent = [...cases].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6)
  return (
    <Widget title="Recent activity" hint="Latest change first">
      {recent.length === 0 ? (
        <Empty text="No cases yet." />
      ) : (
        <ul>
          {recent.map((c) => (
            <li key={c.id}>
              <Row to="/cases/$id" params={{ id: c.id }}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.subject}</span>
                  <span className="block truncate text-xs text-muted">{c.customerName ?? c.customer} · {formatRelative(c.updatedAt)}</span>
                </span>
                <StatusChip status={c.status} />
              </Row>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  )
}

/** Two small charts drawn with plain elements: no library, readable in a 300px column, fine for screen readers. */
export function MiniCharts({ data }: { data: Analytics }) {
  const pts = data.series.points.slice(-8)
  const max = Math.max(1, ...pts.map((p) => p.received))
  const rules = (Object.entries(data.totals.byRule) as [RuleId, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const rmax = Math.max(1, ...rules.map(([, n]) => n))
  return (
    <Widget
      title="At a glance"
      hint={`Complaints per ${data.series.bucket}, and the rules that decided them`}
      action={<Link to="/analytics" className="flex items-center gap-1 text-xs text-muted hover:text-fg">Analytics <ArrowRight className="size-3" /></Link>}
    >
      {pts.length === 0 ? (
        <Empty text="Charts appear once there are cases." />
      ) : (
        <div className="grid gap-4 px-2 py-1">
          <div>
            <ul className="flex h-20 items-end gap-1" aria-label={`Complaints per ${data.series.bucket}`}>
              {pts.map((p) => (
                <li key={p.label} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${p.label}: ${p.received} received, ${p.approved} approved`}>
                  <span className="w-full rounded-t-sm bg-accent/80" style={{ height: `${Math.max(4, (p.received / max) * 64)}px` }} aria-hidden />
                  <span className="w-full truncate text-center text-[10px] text-muted">{p.label}</span>
                  <span className="sr-only">{p.label}: {p.received} received</span>
                </li>
              ))}
            </ul>
          </div>
          {rules.length > 0 && (
            <ul className="grid gap-1.5" aria-label="Decisions by rule">
              {rules.map(([r, n]) => (
                <li key={r} className="grid grid-cols-[3.5rem_1fr_2rem] items-center gap-2 text-xs" title={RULES[r].situation}>
                  <span className="font-mono">{r === 'NONE' ? 'no rule' : r}</span>
                  <span className="h-2 rounded-sm bg-surface-2"><span className="block h-2 rounded-sm bg-blue" style={{ width: `${(n / rmax) * 100}%` }} aria-hidden /></span>
                  <span className="text-right tnum text-muted">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Widget>
  )
}

export function AttentionIcon() {
  return <AlertTriangle className="size-4" aria-hidden />
}
