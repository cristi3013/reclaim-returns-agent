import { DEMO_INVOICES, type ExistingDoc, type InvoiceSnapshot } from '@reclaim/shared'
import type { Gateway, GatewayAction, LogResult, WriteResult } from './types'

/**
 * Calls the CAP gateway on BTP (Alex's service). The gateway is the only thing that talks to DS4.
 *
 * Contract of the service as of 5 Oct 2026 (/odata/v4/returns):
 *   GET  getInvoice(invoiceNumber)
 *   GET  checkExistingCredits(invoiceNumber)
 *   GET  findInvoices(soldToParty, material, fromDate, toDate)                            dates YYYY-MM-DD
 *   GET  getAgreedPrice(soldToParty, material, salesOrganization, distributionChannel)    PR00 valid today
 *   GET  getReturnStatus(returnDocumentNumber)                                            not used yet (5.1.3)
 *   POST logRequest {invoiceNumber, proposedAction}                                       → record, status PENDING
 *   POST setApprovalStatus {ID, status}                                                   APPROVED | REJECTED
 *   POST createReturn {invoiceNumber, invoiceItem, material, quantity, unit, reason, soldToParty}
 *   POST createCreditMemoRequest {invoiceNumber, material, quantity, unit, reason, soldToParty}
 *   POST releaseCreditMemoRequest {creditMemoNumber, versionStamp}                        only after APPROVED
 *
 * Every function returns a JSON *string* inside `{ "value": "..." }`. `unwrap()` hides that.
 * The gateway takes reason names (DEFECTIVE, PRICE_COMPLAINT…) instead of SAP order reason codes; see GATEWAY_REASONS.
 *
 * Plant → company code is NOT a gateway call; it is our own reference table.
 */
export class RealGateway implements Gateway {
  constructor(
    private base: string,
    private plantCompany: Record<string, string> = { YGLG: 'YDE1', YRO1: 'YRO1' },
  ) {}

  private async fn<T>(name: string, params: Record<string, string>): Promise<T> {
    // OData v4 string literal: a single quote is escaped by doubling it.
    const args = Object.entries(params)
      .map(([k, v]) => `${k}='${encodeURIComponent(v.replace(/'/g, "''"))}'`)
      .join(',')
    let res: Response
    try {
      res = await fetch(`${this.base}/${name}(${args})`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
    } catch (e) {
      throw Object.assign(new Error(`${name}: gateway not reachable (${(e as Error).message})`), { status: 504 })
    }
    if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status })
    return this.unwrap<T>(await res.json())
  }

  private async action<T>(name: string, body: Record<string, unknown>): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.base}/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      })
    } catch (e) {
      // A write that timed out may still have happened in SAP: say so, never retry it blindly.
      throw Object.assign(new Error(`${name}: no answer from the gateway (${(e as Error).message}). The outcome in SAP is unknown; check SAP before trying again.`), { status: 504 })
    }
    if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status })
    return this.unwrap<T>(await res.json())
  }

  /** CAP returns `{ value: "<json string>" }`; sometimes the string is already an object. */
  private unwrap<T>(data: unknown): T {
    const v = (data as { value?: unknown }).value ?? data
    if (typeof v === 'string') {
      try {
        return JSON.parse(v) as T
      } catch {
        return v as T
      }
    }
    return v as T
  }

  /** Maps the raw OData v2 billing document (as captured in mock-data/sap-responses) to our snapshot. */
  private toSnapshot(raw: RawInvoice): InvoiceSnapshot {
    const items = (raw.to_Item?.results ?? []).map((it) => {
      const qty = Number(it.BillingQuantity)
      const net = Number(it.NetAmount)
      return {
        item: it.BillingDocumentItem,
        material: it.Material,
        description: it.BillingDocumentItemText ?? '',
        quantity: qty,
        unit: it.BillingQuantityUnit,
        netAmount: net,
        unitPrice: qty ? Math.round((net / qty) * 100) / 100 : 0,
        plant: it.Plant ?? '',
        salesOrder: it.SalesDocument,
        delivery: it.ReferenceSDDocument,
      }
    })
    return {
      number: raw.BillingDocument,
      date: odataDate(raw.BillingDocumentDate),
      customer: raw.SoldToParty,
      customerName: raw.SoldToPartyName ?? `Customer ${raw.SoldToParty}`,
      salesOrg: raw.SalesOrganization,
      distributionChannel: raw.DistributionChannel,
      division: raw.Division,
      companyCode: raw.CompanyCode,
      currency: raw.TransactionCurrency,
      totalNetAmount: Number(raw.TotalNetAmount),
      etag: raw.__metadata?.etag ?? '',
      items,
    }
  }

  async getInvoice(invoiceNumber: string) {
    try {
      const raw = await this.fn<RawInvoice>('getInvoice', { invoiceNumber })
      return raw && raw.BillingDocument ? this.toSnapshot(raw) : null
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null
      throw e
    }
  }

  async checkExistingCredits(invoiceNumber: string) {
    const r = await this.fn<{ existingReturns?: RawExisting[]; existingCredits?: RawExisting[] }>('checkExistingCredits', { invoiceNumber })
    const map = (type: 'YRE' | 'YCR', list: RawExisting[] | undefined): ExistingDoc[] =>
      (list ?? []).map((d) => ({
        type,
        number: d.CustomerReturn ?? d.CreditMemoRequest ?? d.number ?? '',
        reasonCode: d.SDDocumentReason ?? '',
        amount: Number(d.TotalNetAmount ?? 0),
        billingBlock: d.HeaderBillingBlockReason ?? '',
      }))
    return { existingReturns: map('YRE', r.existingReturns), existingCredits: map('YCR', r.existingCredits) }
  }

  /** The search result shape is not fixed, so each hit is re-read with getInvoice: full lines and version stamp. */
  async findInvoices(args: { customer: string; material: string; dateFrom: string; dateTo: string }) {
    const raw = await this.fn<RawFound[] | { results?: RawFound[] } | null>('findInvoices', {
      soldToParty: args.customer,
      material: args.material,
      fromDate: args.dateFrom,
      toDate: args.dateTo,
    })
    const list = Array.isArray(raw) ? raw : (raw?.results ?? [])
    const numbers = [...new Set(list.map((r) => String(r.BillingDocument ?? r.invoiceNumber ?? r.number ?? '')).filter(Boolean))].slice(0, 5)
    const invoices = await Promise.all(numbers.map((n) => this.getInvoice(n)))
    return invoices.filter((i): i is InvoiceSnapshot => !!i && i.items.length > 0)
  }

  /** PR00 rate per unit. SAP gives the rate per condition quantity (e.g. per 100 KG), so divide by it. */
  async getAgreedPrice(args: { customer: string; material: string; salesOrg: string; channel: string }) {
    const raw = await this.fn<RawPrice | RawPrice[] | { results?: RawPrice[] } | null>('getAgreedPrice', {
      soldToParty: args.customer,
      material: args.material,
      salesOrganization: args.salesOrg,
      distributionChannel: args.channel,
    })
    const r = Array.isArray(raw) ? raw[0] : raw && 'results' in raw ? raw.results?.[0] : (raw as RawPrice | null)
    const v = r?.unitPrice ?? r?.price ?? r?.ConditionRateValue
    if (v == null || v === '') return null
    const per = Number(r?.ConditionQuantity ?? 1) || 1
    const price = Number(v) / per
    return Number.isFinite(price) ? Math.round(price * 100) / 100 : null
  }

  async getPlantCompanyCode(plant: string) {
    return this.plantCompany[plant] ?? null
  }

  private writeResult(type: 'YRE' | 'YCR', r: unknown): WriteResult {
    const o = (r ?? {}) as Record<string, unknown>
    const number = String(o[type === 'YRE' ? 'CustomerReturn' : 'CreditMemoRequest'] ?? o.number ?? o.documentNumber ?? '')
    if (!number) return { ok: false, status: 502, message: `Gateway returned no document number: ${JSON.stringify(o).slice(0, 300)}` }
    const meta = o.__metadata as { etag?: string } | undefined
    const etag = meta?.etag ?? (o.versionStamp as string | undefined) ?? (o.etag as string | undefined)
    return { ok: true, number, response: o, etag }
  }

  /** The gateway takes a reason name, not the SAP code. 101 means R2 quality on a YRE but R4 price on a YCR, so key by type. */
  private reason(type: 'YRE' | 'YCR', code: unknown): string | null {
    return GATEWAY_REASONS[`${type}:${String(code ?? '')}`] ?? null
  }

  private unmappedReason(type: 'YRE' | 'YCR', code: unknown): WriteResult {
    return { ok: false, status: 400, message: `Order reason ${String(code)} on a ${type} has no agreed gateway reason name yet. Nothing was written. Add it to GATEWAY_REASONS in gateway/real.ts once the gateway owner confirms it.` }
  }

  private logResult(r: unknown): LogResult {
    const o = (r ?? {}) as Record<string, unknown>
    const id = String(o.ID ?? o.id ?? '')
    if (!id) return { ok: false, status: 502, message: `Gateway returned no approval record ID: ${JSON.stringify(o).slice(0, 300)}` }
    return { ok: true, id, response: o }
  }

  async logRequest(args: { invoiceNumber: string; proposedAction: GatewayAction }): Promise<LogResult> {
    try {
      return this.logResult(await this.action('logRequest', args))
    } catch (e) {
      const err = e as Error & { status?: number }
      return { ok: false, status: err.status ?? 502, message: err.message }
    }
  }

  async setApprovalStatus(args: { id: string; status: 'APPROVED' | 'REJECTED' }): Promise<LogResult> {
    try {
      return this.logResult(await this.action('setApprovalStatus', { ID: args.id, status: args.status }))
    } catch (e) {
      const err = e as Error & { status?: number }
      return { ok: false, status: err.status ?? 502, message: err.message }
    }
  }

  private catchWrite(e: unknown): WriteResult {
    const err = e as Error & { status?: number }
    return { ok: false, status: err.status ?? 502, message: err.message }
  }

  /** Second line of defence: the service checks this too. Demo invoices never reach DS4. */
  private demoGuard(invoice: unknown): WriteResult | null {
    return DEMO_INVOICES.includes(String(invoice ?? ''))
      ? { ok: false, status: 400, message: `Invoice ${String(invoice)} is hackathon demo data and must never be written to the real DS4.` }
      : null
  }

  async createReturn(payload: Record<string, unknown>) {
    const item = (payload.to_Item as Record<string, string>[] | undefined)?.[0] ?? {}
    const blocked = this.demoGuard(item.ReferenceSDDocument)
    if (blocked) return blocked
    const reason = this.reason('YRE', payload.SDDocumentReason)
    if (!reason) return this.unmappedReason('YRE', payload.SDDocumentReason)
    try {
      const r = await this.action('createReturn', {
        invoiceNumber: item.ReferenceSDDocument,
        invoiceItem: item.ReferenceSDDocumentItem,
        material: item.Material,
        quantity: item.RequestedQuantity,
        unit: item.RequestedQuantityUnit,
        reason,
        soldToParty: payload.SoldToParty,
      })
      return this.writeResult('YRE', r)
    } catch (e) {
      return this.catchWrite(e)
    }
  }

  async createCreditMemoRequest(payload: Record<string, unknown>) {
    const item = (payload.to_Item as Record<string, string>[] | undefined)?.[0] ?? {}
    const blocked = this.demoGuard(payload.ReferenceSDDocument)
    if (blocked) return blocked
    const reason = this.reason('YCR', payload.SDDocumentReason)
    if (!reason) return this.unmappedReason('YCR', payload.SDDocumentReason)
    try {
      const r = await this.action('createCreditMemoRequest', {
        invoiceNumber: payload.ReferenceSDDocument,
        material: item.Material,
        quantity: item.RequestedQuantity,
        unit: item.RequestedQuantityUnit,
        reason,
        soldToParty: payload.SoldToParty,
      })
      return this.writeResult('YCR', r)
    } catch (e) {
      return this.catchWrite(e)
    }
  }

  async release(args: { type: 'YRE' | 'YCR'; number: string; etag: string }): Promise<WriteResult> {
    if (args.type !== 'YCR') {
      return { ok: false, status: 501, message: `The gateway releases credit memo requests only. Release return ${args.number} in SAP after the goods receipt.` }
    }
    if (!args.etag) {
      return { ok: false, status: 409, message: `SAP returned no version stamp when ${args.number} was created, so it cannot be released safely. Check the document in SAP.` }
    }
    try {
      const r = await this.action('releaseCreditMemoRequest', { creditMemoNumber: args.number, versionStamp: args.etag })
      return { ok: true, number: args.number, response: (r ?? {}) as Record<string, unknown> }
    } catch (e) {
      return this.catchWrite(e)
    }
  }
}

const READ_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 30_000

/**
 * SAP order reason code, keyed by document type → reason name the gateway expects.
 * Only the two names the gateway owner has shown are filled in. Any other reason is refused, so a wrong one never
 * reaches SAP. Still to confirm: YRE:102 (R1 damaged), YCR:103 (R5 short delivery), YCR:104 (R3 ruined).
 */
const GATEWAY_REASONS: Record<string, string> = {
  'YRE:101': 'DEFECTIVE',
  'YCR:101': 'PRICE_COMPLAINT',
}

/** "/Date(1790640000000)/" → "2026-09-29" */
function odataDate(v: string | null | undefined): string {
  const m = /\/Date\((\d+)/.exec(v ?? '')
  if (!m) return v ?? ''
  return new Date(Number(m[1])).toISOString().slice(0, 10)
}

interface RawInvoice {
  __metadata?: { etag?: string }
  BillingDocument: string
  BillingDocumentDate?: string
  SoldToParty: string
  SoldToPartyName?: string
  SalesOrganization: string
  DistributionChannel: string
  Division: string
  CompanyCode: string
  TransactionCurrency: string
  TotalNetAmount: string
  to_Item?: {
    results?: {
      BillingDocumentItem: string
      Material: string
      BillingDocumentItemText?: string
      BillingQuantity: string
      BillingQuantityUnit: string
      NetAmount: string
      Plant?: string
      SalesDocument: string
      ReferenceSDDocument: string
    }[]
  }
}

interface RawFound {
  BillingDocument?: string
  invoiceNumber?: string
  number?: string
}

interface RawPrice {
  unitPrice?: string | number
  price?: string | number
  ConditionRateValue?: string | number
  ConditionQuantity?: string | number
}

interface RawExisting {
  CustomerReturn?: string
  CreditMemoRequest?: string
  number?: string
  SDDocumentReason?: string
  TotalNetAmount?: string
  HeaderBillingBlockReason?: string
}
