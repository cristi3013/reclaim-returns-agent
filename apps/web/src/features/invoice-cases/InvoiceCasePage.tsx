import { Navigate, useParams } from '@tanstack/react-router'
import { groupByInvoice, mainComplaint } from '@reclaim/shared'
import { useCases } from '@/api'
import { ErrorState } from '@/components/domain/ErrorState'
import { Skeleton } from '@/components/ui/skeleton'

/** An invoice opens its case: the same case page as from the Inbox, on the invoice's main complaint. */
export function InvoiceCasePage() {
  const { invoice } = useParams({ from: '/invoices/$invoice' })
  const list = useCases()
  if (list.isLoading) return <Skeleton className="h-96" />
  const ic = groupByInvoice(list.data ?? []).find((c) => c.invoice === invoice)
  if (list.error || !ic)
    return (
      <ErrorState
        error={list.error ?? `No case for invoice ${invoice}`}
        onRetry={() => list.refetch()}
      />
    )
  return <Navigate to="/cases/$id" params={{ id: mainComplaint(ic.complaints).id }} replace />
}
