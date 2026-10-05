import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useCases, useSeed, useStatus } from '@/api'
import { InboxToolbar } from './InboxToolbar'
import { InboxTable } from './InboxTable'
import { EmptyState } from '@/components/domain/EmptyState'
import { ErrorState } from '@/components/domain/ErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRelative } from '@/lib/format'

export function InboxPage() {
  const nav = useNavigate()
  return <InboxView onOpen={(id) => nav({ to: '/cases/$id', params: { id } })} />
}

/** Hooks, toolbar and table without a router dependency, so it can be tested on its own. */
export function InboxView({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useCases()
  const seed = useSeed()
  const { data: agent } = useStatus()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const all = q.data ?? []
  const rows = all.filter(
    (r) =>
      (!status || r.status === status) &&
      (!query ||
        `${r.subject} ${r.from} ${r.invoiceNumber ?? ''} ${r.customerName ?? ''}`.toLowerCase().includes(query.toLowerCase())),
  )
  const pending = all.filter((r) => r.status === 'awaiting_approval').length
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted">
          Every complaint, what the agent found in SAP and what it proposes. Nothing reaches SAP without a person's approval.
          {pending > 0 && <span className="ml-2 rounded bg-warn-soft px-1.5 py-0.5 text-xs text-warn">{pending} awaiting approval</span>}
        </p>
        {agent?.mailbox && (
          <p className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span className={`size-2 rounded-full ${agent.mailbox.connected ? 'bg-ok' : 'bg-warn'}`} aria-hidden />
            Complaints arrive from <span className="font-mono text-fg">{agent.mailbox.address}</span>
            {agent.mailbox.connected ? ' · listening' : ` · reconnecting${agent.mailbox.lastError ? ` (${agent.mailbox.lastError.slice(0, 60)})` : ''}`}
            {agent.mailbox.lastMessageAt && ` · last email ${formatRelative(agent.mailbox.lastMessageAt)}`}
          </p>
        )}
      </div>
      <InboxToolbar query={query} onQuery={setQuery} status={status} onStatus={setStatus} hasCases={all.length > 0} />
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState
          title="No complaints yet"
          description="Load the eight demo complaints from the hackathon mock data, or upload .eml files from the returns mailbox."
          action={<Button onClick={() => seed.mutate()}>Seed demo cases</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No matches" description="No case matches the current search or filter." />
      ) : (
        <InboxTable rows={rows} onOpen={onOpen} />
      )}
    </div>
  )
}
