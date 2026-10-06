import type { ExistingDoc, InvoiceSnapshot } from '@reclaim/shared'

/**
 * Everything the backend needs from SAP, as the BTP gateway (Alex's CAP service) exposes it.
 * Two implementations: MockGateway (captured DS4 data, no network) and RealGateway (HTTP to BTP).
 * Nothing else in the backend may know how SAP is reached.
 */
export interface Gateway {
  /** True for the gateway in front of the real SAP system: the hackathon demo invoices are never written through it. */
  readonly live: boolean
  /** Invoice header + items + ETag. null if not found. */
  getInvoice(invoiceNumber: string): Promise<InvoiceSnapshot | null>
  /** Returns and credit memo requests that already reference this invoice. */
  checkExistingCredits(invoiceNumber: string): Promise<{ existingReturns: ExistingDoc[]; existingCredits: ExistingDoc[] }>
  /** Invoices of a customer for a material in a date range. Used when the email names no invoice (R9). */
  findInvoices(args: { customer: string; material: string; dateFrom: string; dateTo: string }): Promise<InvoiceSnapshot[]>
  /** Agreed unit price: pricing condition PR00 for customer, material and sales area, valid today. null if none. */
  getAgreedPrice(args: { customer: string; material: string; salesOrg: string; channel: string }): Promise<number | null>
  /** Company code that owns a plant, for the intercompany check. */
  getPlantCompanyCode(plant: string): Promise<string | null>
  /** Warehouse receipt status of a return (step 5.1.3). Live shape: { warehouseReceiptStatus, received }. */
  getReturnStatus?(returnNumber: string): Promise<{ status: string; received: boolean }>
  /** POST a customer return (YRE). Returns the new document number. */
  createReturn(payload: Record<string, unknown>, ctx: WriteContext): Promise<WriteResult>
  /** POST a credit memo request (YCR) with billing block 08. Returns the new document number. */
  createCreditMemoRequest(payload: Record<string, unknown>, ctx: WriteContext): Promise<WriteResult>
  /**
   * Remove billing block 08. `etag` is the version stamp of the document itself (from the create response),
   * sent back as the version stamp: a change since then is refused with 412. The gateway releases a credit
   * memo request only after setApprovalStatus(APPROVED); a return is released after the goods receipt.
   */
  release(args: { type: 'YRE' | 'YCR'; number: string; etag: string }): Promise<WriteResult>
  /** Open an approval record on the gateway (status PENDING). Required before a write. */
  logRequest(args: LogRequestArgs): Promise<LogResult>
  /** Record the person's decision on that approval record. */
  setApprovalStatus(args: { id: string; status: 'APPROVED' | 'REJECTED'; approvedBy: string; approverRole: string }): Promise<LogResult>
}

export type GatewayAction = 'RETURN' | 'CREDIT' | 'REPLACEMENT' | 'REJECT' | 'PENDING'

/**
 * What a write carries besides the SAP payload. The gateway maps the policy rule to the SAP order reason itself
 * (R1→102, R2→101, R3→104, R4→101, R5→103) and stores the rest on its approval record.
 */
export interface WriteContext {
  rule: string
  gatewayLogId: string
  creditValue: number
  evidenceUrl?: string | null
}

export interface LogRequestArgs {
  invoiceNumber: string
  proposedAction: GatewayAction
  rule: string
  reason: string
  claimedQuantity?: number | null
  claimedAmount?: number | null
  creditValue?: number | null
  evidenceUrl?: string | null
}

export type WriteResult =
  | { ok: true; number: string; response: Record<string, unknown>; etag?: string }
  | { ok: false; status: number; message: string }

export type LogResult =
  | { ok: true; id: string; response: Record<string, unknown> }
  | { ok: false; status: number; message: string }

export class GatewayError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
