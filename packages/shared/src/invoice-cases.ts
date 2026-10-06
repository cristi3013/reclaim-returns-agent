import type { CaseStatus } from './enums'
import type { Case, CaseSummary } from './schemas'
import { conversation, type ThreadMessage } from './thread'

/**
 * Invoice cases. Every complaint stays its own record with its own decision and SAP document (so a second claim on
 * the same invoice still meets the duplicate rules), and all complaints that name the same invoice form one case.
 * A new email on an invoice that already has a case lands in it and reopens it; a new invoice starts a new case.
 */

export type InvoiceCaseStatus = 'open' | 'pending' | 'closed'

export const INVOICE_CASE_LABELS: Record<InvoiceCaseStatus, string> = {
  open: 'Open',
  pending: 'Pending',
  closed: 'Closed',
}

/** Complaint statuses where nothing is left to do on our side. */
const DONE: CaseStatus[] = ['written_to_sap', 'closed', 'duplicate']

export interface InvoiceCase {
  invoice: string
  customer: string | null
  customerName: string | null
  status: InvoiceCaseStatus
  /** Oldest first. */
  complaints: CaseSummary[]
  subject: string
  openedAt: string
  lastActivityAt: string
  /** A complaint came in after an earlier one on this invoice was finished. */
  reopened: boolean
  awaitingApproval: number
}

/** Open while any complaint needs us, Pending while we wait for the customer, Closed when everything is done. */
export function invoiceCaseStatus(statuses: CaseStatus[]): InvoiceCaseStatus {
  if (statuses.some((s) => s !== 'needs_customer_input' && !DONE.includes(s))) return 'open'
  if (statuses.includes('needs_customer_input')) return 'pending'
  return 'closed'
}

const ORDER: Record<InvoiceCaseStatus, number> = { open: 0, pending: 1, closed: 2 }

/** One case per invoice, the ones needing work first, then the latest activity. Complaints without an invoice yet are left out. */
export function groupByInvoice(rows: CaseSummary[]): InvoiceCase[] {
  const by = new Map<string, CaseSummary[]>()
  for (const r of rows) {
    if (!r.invoiceNumber) continue
    by.set(r.invoiceNumber, [...(by.get(r.invoiceNumber) ?? []), r])
  }
  return [...by.entries()]
    .map(([invoice, list]): InvoiceCase => {
      const complaints = [...list].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      const first = complaints[0]!
      const latest = complaints[complaints.length - 1]!
      const status = invoiceCaseStatus(complaints.map((c) => c.status))
      return {
        invoice,
        customer: latest.customer ?? first.customer,
        customerName: latest.customerName ?? first.customerName,
        status,
        complaints,
        subject: latest.subject,
        openedAt: first.receivedAt,
        lastActivityAt: complaints
          .map((c) => c.updatedAt)
          .sort()
          .at(-1)!,
        reopened:
          status !== 'closed' &&
          complaints.some((c, i) => i < complaints.length - 1 && DONE.includes(c.status)),
        awaitingApproval: complaints.filter((c) => c.status === 'awaiting_approval').length,
      }
    })
    .sort(
      (a, b) =>
        ORDER[a.status] - ORDER[b.status] || b.lastActivityAt.localeCompare(a.lastActivityAt),
    )
}

export interface InvoiceMessage extends ThreadMessage {
  caseId: string
  /** The first email of a later complaint on the same invoice. */
  startsComplaint: boolean
  /** That complaint came after every earlier one was finished: it reopened the case. */
  reopens: boolean
}

/** Every email of every complaint on the invoice, oldest first. */
export function invoiceConversation(cases: Case[]): InvoiceMessage[] {
  const ordered = [...cases].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  return ordered
    .flatMap((c, n) =>
      conversation(c).map((m, i) => {
        const startsComplaint = n > 0 && i === 0
        const reopens = startsComplaint && ordered.slice(0, n).every((x) => DONE.includes(x.status))
        return { ...m, caseId: c.id, startsComplaint, reopens }
      }),
    )
    .sort((a, b) => a.at.localeCompare(b.at))
}

/**
 * The status of the case each complaint belongs to, by complaint id: one status for every email on the invoice.
 * A complaint without an invoice yet waits for the customer to name one: Pending.
 */
export function caseStatusByComplaint(rows: CaseSummary[]): Map<string, InvoiceCaseStatus> {
  const out = new Map<string, InvoiceCaseStatus>()
  for (const ic of groupByInvoice(rows)) for (const c of ic.complaints) out.set(c.id, ic.status)
  for (const r of rows) if (!out.has(r.id)) out.set(r.id, 'pending')
  return out
}
