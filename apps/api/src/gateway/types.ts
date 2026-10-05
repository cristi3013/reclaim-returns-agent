import type { ExistingDoc, InvoiceSnapshot } from '@reclaim/shared'

/**
 * Everything the backend needs from SAP, as the BTP gateway (Alex's CAP service) exposes it.
 * Two implementations: MockGateway (captured DS4 data, no network) and RealGateway (HTTP to BTP).
 * Nothing else in the backend may know how SAP is reached.
 */
export interface Gateway {
  /** Invoice header + items + ETag. null if not found. */
  getInvoice(invoiceNumber: string): Promise<InvoiceSnapshot | null>
  /** Returns and credit memo requests that already reference this invoice. */
  checkExistingCredits(invoiceNumber: string): Promise<{ existingReturns: ExistingDoc[]; existingCredits: ExistingDoc[] }>
  /** Invoices of a customer for a material in a date range. Used when the email names no invoice (R9). */
  findInvoices(args: { customer: string; material: string; dateFrom: string; dateTo: string }): Promise<InvoiceSnapshot[]>
  /** Agreed unit price: pricing condition PR00 for the material in the sales area. null if none. */
  getAgreedPrice(args: { material: string; salesOrg: string; channel: string }): Promise<number | null>
  /** Company code that owns a plant, for the intercompany check. */
  getPlantCompanyCode(plant: string): Promise<string | null>
  /** POST a customer return (YRE). Returns the new document number. */
  createReturn(payload: Record<string, unknown>): Promise<WriteResult>
  /** POST a credit memo request (YCR) with billing block 08. Returns the new document number. */
  createCreditMemoRequest(payload: Record<string, unknown>): Promise<WriteResult>
  /** PATCH: remove billing block 08. Must send the ETag as If-Match; 412 on conflict. */
  release(args: { type: 'YRE' | 'YCR'; number: string; etag: string }): Promise<WriteResult>
}

export type WriteResult =
  | { ok: true; number: string; response: Record<string, unknown> }
  | { ok: false; status: number; message: string }

export class GatewayError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
