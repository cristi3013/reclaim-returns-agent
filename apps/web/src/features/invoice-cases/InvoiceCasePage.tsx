import { Link, useParams } from '@tanstack/react-router'
import { useQueries } from '@tanstack/react-query'
import { ChevronRight, RotateCcw } from 'lucide-react'
import {
  COMPLAINT_LABELS,
  groupByInvoice,
  invoiceConversation,
  primaryProposal,
  type Case,
  type InvoiceMessage,
} from '@reclaim/shared'
import { useApi, useCases } from '@/api'
import { Conversation } from '@/components/domain/Conversation'
import { StatusChip } from '@/components/domain/StatusChip'
import { DocTypeBadge } from '@/components/domain/DocTypeBadge'
import { ErrorState } from '@/components/domain/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatMoney } from '@/lib/format'
import { CHIP } from './status'

/** The case for one invoice: the whole email conversation across its complaints, and each complaint's decision. */
export function InvoiceCasePage() {
  const { invoice } = useParams({ from: '/invoices/$invoice' })
  const api = useApi()
  const list = useCases()
  const ic = groupByInvoice(list.data ?? []).find((c) => c.invoice === invoice)
  // Same query keys as the complaint page, so live updates refresh both.
  const full = useQueries({
    queries: (ic?.complaints ?? []).map((s) => ({
      queryKey: ['case', s.id],
      queryFn: () => api.getCase(s.id),
    })),
  })
  if (list.isLoading) return <Skeleton className="h-96" />
  if (list.error || !ic)
    return (
      <ErrorState
        error={list.error ?? `No case for invoice ${invoice}`}
        onRetry={() => list.refetch()}
      />
    )
  const cases = full.map((q) => q.data).filter((c): c is Case => !!c)
  const messages = invoiceConversation(cases)
  const index = new Map(ic.complaints.map((c, i) => [c.id, i + 1]))
  const byId = new Map(cases.map((c) => [c.id, c]))
  const ordered = [...cases].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))

  return (
    <div>
      <div className="mb-6">
        <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-muted">
          <Link to="/invoices" className="hover:text-fg hover:underline">
            Cases
          </Link>
          <ChevronRight className="size-3" aria-hidden />
          <span className="font-mono">{invoice}</span>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">
          Invoice <span className="font-mono">{invoice}</span>
        </h1>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
          <StatusChip status={CHIP[ic.status]} />
          {ic.reopened && (
            <span className="rounded bg-info-soft px-1.5 py-0.5 text-xs font-medium text-info">
              Reopened
            </span>
          )}
          <span>{ic.customerName}</span>
          <span>
            {ic.complaints.length} complaint{ic.complaints.length === 1 ? '' : 's'} ·{' '}
            {messages.length} email
            {messages.length === 1 ? '' : 's'}
          </span>
          <span>opened {formatDateTime(ic.openedAt)}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="rounded-lg border border-line bg-surface p-4 shadow-card">
          <h2 className="text-base font-semibold">Conversation</h2>
          {full.some((q) => q.isLoading) && <Skeleton className="mt-3 h-40" />}
          <Conversation
            messages={messages}
            customerFrom={ordered[0]?.from ?? ''}
            label="Emails on this invoice"
            extras={(m) => {
              const x = m as InvoiceMessage
              return {
                before: x.startsComplaint ? (
                  <li
                    className="flex items-center gap-2 py-1 text-xs text-muted"
                    role="separator"
                  >
                    <span className="h-px flex-1 bg-line" />
                    <RotateCcw className="size-3.5" aria-hidden />
                    {x.reopens
                      ? 'New email on this invoice · case reopened'
                      : 'New complaint on this invoice'}
                    <span className="h-px flex-1 bg-line" />
                  </li>
                ) : undefined,
                footer: (
                  <Link
                    to="/cases/$id"
                    params={{ id: x.caseId }}
                    className="hover:text-fg hover:underline"
                  >
                    Complaint {index.get(x.caseId)} · {byId.get(x.caseId)?.subject}
                  </Link>
                ),
              }
            }}
          />
        </section>

        <aside aria-label="Complaints on this invoice" className="space-y-3">
          <h2 className="text-base font-semibold">Complaints</h2>
          {ic.complaints.map((s, i) => {
            const c = byId.get(s.id)
            const p = c ? primaryProposal(c) : undefined
            return (
              <Link
                key={s.id}
                to="/cases/$id"
                params={{ id: s.id }}
                className="block rounded-lg border border-line bg-surface p-3 shadow-card hover:bg-surface-2"
              >
                <div className="flex items-center justify-between gap-2 text-xs text-muted">
                  <span>
                    Complaint {i + 1} · {formatDateTime(s.receivedAt)}
                  </span>
                  <StatusChip status={s.status} />
                </div>
                <div className="mt-1 truncate text-sm font-medium">{s.subject}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span>{COMPLAINT_LABELS[s.complaintType]}</span>
                  {s.ruleId && <DocTypeBadge type={s.documentType} compact />}
                  {s.amount != null && s.amount > 0 && (
                    <span className="font-mono tnum">{formatMoney(s.amount, s.currency)}</span>
                  )}
                  {c?.sapDocuments.map((d) => (
                    <span key={d.id} className="font-mono">
                      {d.type} {d.number}
                    </span>
                  ))}
                </div>
                {p?.explanation && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{p.explanation}</p>
                )}
              </Link>
            )
          })}
        </aside>
      </div>
    </div>
  )
}
