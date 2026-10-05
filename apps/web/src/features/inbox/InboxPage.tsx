import { useMemo, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useCases, useSeed, useStatus } from '@/api'
import { InboxToolbar } from './InboxToolbar'
import { InboxTable } from './InboxTable'
import { StatusFilters } from './StatusFilters'
import { matchesQuery, matchesStatus, sortRows } from './view'
import { useUi } from '@/store/ui'
import { EmptyState } from '@/components/domain/EmptyState'
import { PageHeader } from '@/components/domain/PageHeader'
import { ErrorState } from '@/components/domain/ErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatRelative } from '@/lib/format'

export function InboxPage() {
  const nav = useNavigate()
  const search = useSearch({ strict: false }) as { filter?: 'intercompany' }
  return <InboxView onOpen={(id) => nav({ to: '/cases/$id', params: { id } })} initialIntercompany={search.filter === 'intercompany'} />
}

/** Hooks, toolbar and table without a router dependency, so it can be tested on its own. */
export function InboxView({ onOpen, initialIntercompany = false }: { onOpen: (id: string) => void; initialIntercompany?: boolean }) {
  const q = useCases()
  const seed = useSeed()
  const { data: agent } = useStatus()
  const [query, setQuery] = useState('')
  // Intercompany (step 5.2.2): the finance view, reachable from the dashboard tile.
  const [intercompany, setIntercompany] = useState(initialIntercompany)
  const { inboxSort: sort, setInboxSort, inboxStatus: status, setInboxStatus } = useUi()
  const all = useMemo(() => q.data ?? [], [q.data])
  const searched = all.filter((r) => matchesQuery(r, query) && (!intercompany || r.intercompany))
  const rows = sortRows(
    searched.filter((r) => matchesStatus(r, status)),
    sort,
  )
  const filtered = Boolean(query.trim() || status || intercompany)
  const clear = () => {
    setQuery('')
    setInboxStatus('')
    setIntercompany(false)
  }
  const pending = all.filter((r) => r.status === 'awaiting_approval').length
  return (
    <div>
      <PageHeader
        title="Inbox"
        description="Every complaint email as it arrives, what the agent found in SAP and what it proposes. Complaints about the same invoice are grouped under Cases. Nothing reaches SAP without a person's approval."
        extra={
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {pending > 0 && (
              <button
                type="button"
                onClick={() => setInboxStatus('awaiting_approval')}
                className="rounded-full bg-warn-soft px-2.5 py-1 font-medium text-warn hover:underline"
              >
                {pending} waiting for approval
              </button>
            )}
            {agent?.mailbox && (
              <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1">
                <span
                  className={`size-2 rounded-full ${agent.mailbox.connected ? 'bg-ok' : 'bg-warn'}`}
                  aria-hidden
                />
                Emails to <span className="font-mono text-fg">{agent.mailbox.address}</span>
                {agent.mailbox.connected
                  ? ' arrive here automatically'
                  : ` · reconnecting${agent.mailbox.lastError ? ` (${agent.mailbox.lastError.slice(0, 60)})` : ''}`}
                {agent.mailbox.lastMessageAt &&
                  ` · last one ${formatRelative(agent.mailbox.lastMessageAt)}`}
              </span>
            )}
          </div>
        }
      />
      <InboxToolbar
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setInboxSort}
        intercompany={intercompany}
        onIntercompany={setIntercompany}
        hasCases={all.length > 0}
      />
      {all.length > 0 && <StatusFilters rows={searched} value={status} onChange={setInboxStatus} />}
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : all.length === 0 ? (
        <EmptyState
          title="No complaints yet"
          description="Load the eight demo complaints from the hackathon mock data, or upload .eml files from the returns mailbox."
          action={<Button onClick={() => seed.mutate()}>Load demo complaints</Button>}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No matches"
          description="No complaint matches this search or filter."
          action={
            <Button variant="outline" onClick={clear}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
          <InboxTable rows={rows} onOpen={onOpen} sort={sort} onSort={setInboxSort} />
          {filtered && (
            <p className="mt-2 text-xs text-muted">
              Showing {rows.length} of {all.length} complaints ·{' '}
              <button type="button" className="underline hover:text-fg" onClick={clear}>
                Clear filters
              </button>
            </p>
          )}
        </>
      )}
    </div>
  )
}
