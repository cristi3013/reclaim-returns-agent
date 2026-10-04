import { Link, useParams } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import { toast } from 'sonner'
import { useCase, useChoose, useRunCase } from '@/api'
import { ComplaintPanel } from './ComplaintPanel'
import { SapFindingsPanel } from './SapFindingsPanel'
import { ProposalCard } from './ProposalCard'
import { StatusChip } from '@/components/domain/StatusChip'
import { ErrorState } from '@/components/domain/ErrorState'
import { AuditTimeline } from '@/features/audit/AuditTimeline'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function CasePage() {
  const { id } = useParams({ from: '/cases/$id' })
  const q = useCase(id)
  const run = useRunCase()
  const choose = useChoose()
  const c = q.data
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.error || !c) return <ErrorState error={q.error ?? 'Case not found'} onRetry={() => q.refetch()} />
  const two = c.proposals.length > 1
  const running = c.status === 'investigating' || c.status === 'proposed' || run.isPending
  const canChoose = two && c.status === 'awaiting_approval' && !c.proposals.some((p) => p.chosen)
  return (
    <div>
      <div className="mb-4 flex items-start gap-4">
        <div className="min-w-0">
          <div className="text-xs text-muted">
            <Link to="/" className="underline hover:text-fg">
              Inbox
            </Link>{' '}
            / <span className="font-mono">{c.id}</span>
          </div>
          <h1 className="truncate text-xl font-semibold">{c.subject}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <StatusChip status={c.status} />
            {c.invoiceNumber && <span className="font-mono">invoice {c.invoiceNumber}</span>}
            <span>{c.customerName}</span>
            <span className="rounded bg-surface-2 px-1.5 text-xs">{c.aiMode === 'rules_only' ? 'rules only' : 'AI assisted'}</span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 gap-2">
          {c.status === 'awaiting_approval' && (
            <Button asChild variant="outline">
              <Link to="/approvals">Open in approvals</Link>
            </Button>
          )}
          <Button onClick={() => run.mutate(id)} disabled={running}>
            <Play className="size-4" /> {running ? 'Running…' : c.proposals.length ? 'Run again' : 'Run agent'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4">
        <ComplaintPanel c={c} />
        <SapFindingsPanel c={c} />
      </div>

      <section className="mt-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
          {two ? 'Proposal · two options, a person chooses' : 'Proposal'}
        </h2>
        {c.proposals.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line p-8 text-center text-muted">
            {running ? 'The agent is reading the complaint and looking up SAP…' : 'No proposal yet. Run the agent.'}
          </div>
        ) : (
          <div className={two ? 'grid grid-cols-2 gap-4' : ''}>
            {c.proposals.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                canChoose={canChoose}
                onChoose={(pid) => choose.mutate(pid, { onSuccess: () => toast.success('Option chosen; ready for approval') })}
              />
            ))}
          </div>
        )}
      </section>

      <Tabs defaultValue="timeline" className="mt-6">
        <TabsList>
          <TabsTrigger value="timeline">Timeline &amp; audit</TabsTrigger>
          <TabsTrigger value="raw">Raw data</TabsTrigger>
        </TabsList>
        <TabsContent value="timeline">
          <AuditTimeline c={c} />
        </TabsContent>
        <TabsContent value="raw">
          <pre className="max-h-[32rem] overflow-auto rounded-lg border border-line bg-surface-2 p-3 font-mono text-xs">
            {JSON.stringify(c, null, 2)}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  )
}
