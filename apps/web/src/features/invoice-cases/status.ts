import type { CaseStatus, InvoiceCaseStatus } from '@reclaim/shared'

/** The complaint status with the same name and colour, so a case chip looks like the Open/Pending/Closed chips. */
export const CHIP: Record<InvoiceCaseStatus, CaseStatus> = {
  open: 'received',
  pending: 'needs_customer_input',
  closed: 'closed',
}
