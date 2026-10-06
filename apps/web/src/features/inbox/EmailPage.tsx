import { Link, useParams } from '@tanstack/react-router'
import { ArrowRight, ChevronRight } from 'lucide-react'
import { caseHome, conversation } from '@reclaim/shared'
import { useCase, useCases } from '@/api'
import { Attachments } from '@/components/domain/Attachments'
import { ErrorState } from '@/components/domain/ErrorState'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'

/** One email from the Inbox, as it arrived. The conversation, the proposal and the decision are on the case. */
export function EmailPage() {
  const { id } = useParams({ from: '/inbox/$id' })
  const q = useCase(id)
  const list = useCases()
  const c = q.data
  if (q.isLoading) return <Skeleton className="h-96" />
  if (q.error || !c)
    return <ErrorState error={q.error ?? 'Email not found'} onRetry={() => q.refetch()} />
  const more = conversation(c).length - 1
  return (
    <div>
      <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-muted">
        <Link to="/inbox" className="hover:text-fg hover:underline">
          Inbox
        </Link>
        <ChevronRight className="size-3" aria-hidden />
        <span>Email</span>
      </nav>
      <div className="mb-4 flex flex-wrap items-start gap-4">
        <h1 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight">{c.subject}</h1>
        <Button asChild>
          {/* The same case as from Cases: every email on the invoice opens its main complaint. */}
          <Link to="/cases/$id" params={{ id: caseHome(list.data ?? [], c.id) }}>
            Go to case <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
      <article className="rounded-lg border border-line bg-surface p-4 shadow-card">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">From</dt>
          <dd className="font-medium">{c.from}</dd>
          <dt className="text-muted">Received</dt>
          <dd>{formatDateTime(c.receivedAt)}</dd>
          <dt className="text-muted">Invoice</dt>
          <dd className="font-mono">
            {c.invoiceNumber ?? <span className="font-sans text-warn">none yet</span>}
          </dd>
        </dl>
        <pre className="mt-4 whitespace-pre-wrap border-t border-line pt-4 font-sans text-sm leading-relaxed">
          {c.bodyText}
        </pre>
        <Attachments list={c.attachments} />
      </article>
      {more > 0 && (
        <p className="mt-2 text-xs text-muted">
          {more} more email{more === 1 ? '' : 's'} in this conversation, on the case.
        </p>
      )}
    </div>
  )
}
