import { DEMO_INVOICES, type ExistingDoc, type InvoiceSnapshot } from '@reclaim/shared'
import type { Gateway, LogRequestArgs, LogResult, WriteContext, WriteResult } from './types'

/**
 * Calls the CAP gateway on BTP (Alex's service). The gateway is the only thing that talks to DS4.
 *
 * Contract of the service as of 5 Oct 2026 (/odata/v4/returns):
 *   GET  getInvoice(invoiceNumber)
 *   GET  checkExistingCredits(invoiceNumber)
 *   GET  findInvoices(soldToParty, material, fromDate, toDate)                            dates YYYY-MM-DD
 *   GET  getAgreedPrice(soldToParty, material, salesOrganization, distributionChannel)    PR00 valid today
 *   GET  getReturnStatus(returnDocumentNumber)                                            goods receipt (5.1.3)
 *   POST logRequest {invoiceNumber, proposedAction}                                       → record, status PENDING
 *   POST setApprovalStatus {ID, status}                                                   APPROVED | REJECTED
 *   POST createReturn {invoiceNumber, invoiceItem, material, quantity, unit, reason, soldToParty}
 *   POST createCreditMemoRequest {invoiceNumber, material, quantity, unit, reason, soldToParty}
 *   POST releaseCreditMemoRequest {creditMemoNumber, versionStamp}                        only after APPROVED
 *
 * Every function returns a JSON *string* inside `{ "value": "..." }`. `unwrap()` hides that.
 * Writes take the policy rule id (R1–R5), not the SAP order reason: the gateway maps the rule to the reason itself
 * (R1→102, R2→101, R3→104, R4→101, R5→103, confirmed by the gateway owner on 5 Oct 2026).
 *
 * Plant → company code is NOT a gateway call; it is our own reference table.
 */
export class RealGateway implements Gateway {
  readonly live = true
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
    await this.throwIfUnavailable(res, name)
    if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status })
    return this.unwrap<T>(await res.json())
  }

  /**
   * A 404 from the Cloud Foundry router (header x-cf-routererror: unknown_route) means the gateway app is down or
   * being redeployed. That is "gateway unavailable" (503), never "record not found".
   */
  private async throwIfUnavailable(res: Response, name: string) {
    const routerError = res.headers.get('x-cf-routererror')
    if (res.status === 404 && routerError) {
      throw Object.assign(new Error(`${name}: the gateway is not reachable right now (Cloud Foundry: ${routerError}). It may be redeploying; try again in a minute.`), { status: 503 })
    }
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
    await this.throwIfUnavailable(res, name)
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

  /**
   * Control Tower reads (listUnbilledDeliveries, listBlockedOrders, …): GET only, the answer is the organisers' tool
   * shape `{ underlyingRequests, capturedOn, response }`. Numbers go unquoted (Edm.Int32), strings quoted.
   */
  async readTool<T>(name: string, params: Record<string, string | number>): Promise<{ underlyingRequests?: string[]; capturedOn?: string; response: T }> {
    const args = Object.entries(params)
      .map(([k, v]) => `${k}=${typeof v === 'number' ? String(v) : `'${encodeURIComponent(String(v).replace(/'/g, "''"))}'`}`)
      .join(',')
    let res: Response
    try {
      res = await fetch(`${this.base}/${name}(${args})`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(READ_TIMEOUT_MS * 4) })
    } catch (e) {
      throw Object.assign(new Error(`${name}: gateway not reachable (${(e as Error).message})`), { status: 504 })
    }
    await this.throwIfUnavailable(res, name)
    if (!res.ok) throw Object.assign(new Error(`${name}: ${(await res.text()).slice(0, 200)}`), { status: res.status })
    const v = this.unwrap<{ underlyingRequests?: string[]; capturedOn?: string; response: T }>(await res.json())
    if (!v || typeof v !== 'object' || !('response' in v)) throw Object.assign(new Error(`${name}: unexpected answer shape`), { status: 502 })
    return v
  }

  async getInvoice(invoiceNumber: string) {
    // A billing document number is at most 10 digits (VBELN): anything else cannot be in SAP.
    if (!/^\d{1,10}$/.test(invoiceNumber.trim())) return null
    try {
      const raw = await this.fn<RawInvoice>('getInvoice', { invoiceNumber: invoiceNumber.trim() })
      return raw && raw.BillingDocument ? this.toSnapshot(raw) : null
    } catch (e) {
      // 404, or 400 "Malformed URI literal" for a number SAP cannot parse: the invoice does not exist.
      // A Cloud Foundry 404 is already 503 here, and 5xx/timeouts still abort the run.
      const status = (e as { status?: number }).status
      if (status === 404 || status === 400) return null
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

  /**
   * Live shape (5 Oct 2026): `{ soldToParty, material, fromDate, toDate, invoices: [<raw OData v2 billing document with to_Item and __metadata>] }`.
   * For customer 10021 that is every hackathon invoice (100+, about 1 MB), so the caller ranks them (rankCandidates) and keeps a few.
   * Older or bare-list shapes are still accepted; hits without lines are re-read with getInvoice.
   */
  async findInvoices(args: { customer: string; material: string; dateFrom: string; dateTo: string }) {
    const raw = await this.fn<{ invoices?: RawInvoice[]; results?: RawInvoice[] } | RawInvoice[] | null>('findInvoices', {
      soldToParty: args.customer,
      material: args.material,
      fromDate: args.dateFrom,
      toDate: args.dateTo,
    })
    const list: RawInvoice[] = Array.isArray(raw) ? raw : (raw?.invoices ?? raw?.results ?? [])
    const full = list.filter((r) => r.BillingDocument && r.to_Item?.results?.length)
    const bare = list.filter((r) => r.BillingDocument && !r.to_Item?.results?.length).slice(0, 5)
    const reread = await Promise.all(bare.map((r) => this.getInvoice(r.BillingDocument)))
    return [...full.map((r) => this.toSnapshot(r)), ...reread.filter((i): i is InvoiceSnapshot => !!i)]
  }

  /**
   * PR00 rate per unit. Live shape (5 Oct 2026): `{ soldToParty, material, salesOrganization, distributionChannel, today, agreedPrices: [...] }`.
   * `agreedPrices` was empty for every customer we tried, so the gateway probably reads a customer-specific condition
   * table while the hackathon price (270 EUR/KG) sits on the material level. Until that is fixed on the gateway, a price
   * complaint goes to a person. SAP gives the rate per condition quantity (e.g. per 100 KG), so divide by it.
   */
  async getAgreedPrice(args: { customer: string; material: string; salesOrg: string; channel: string }) {
    const raw = await this.fn<RawPrice | RawPrice[] | { results?: RawPrice[]; agreedPrices?: RawPrice[] } | null>('getAgreedPrice', {
      soldToParty: args.customer,
      material: args.material,
      salesOrganization: args.salesOrg,
      distributionChannel: args.channel,
    })
    const r = Array.isArray(raw)
      ? raw[0]
      : raw && 'agreedPrices' in raw
        ? raw.agreedPrices?.[0]
        : raw && 'results' in raw
          ? raw.results?.[0]
          : (raw as RawPrice | null)
    const v = r?.unitPrice ?? r?.price ?? r?.ConditionRateValue ?? r?.ConditionRateAmount ?? r?.amount ?? r?.rate
    if (v == null || v === '') return null
    const per = Number(r?.ConditionQuantity ?? 1) || 1
    const price = Number(v) / per
    return Number.isFinite(price) ? Math.round(price * 100) / 100 : null
  }

  async getPlantCompanyCode(plant: string) {
    return this.plantCompany[plant] ?? null
  }

  async getReturnStatus(returnNumber: string) {
    const r = await this.fn<{ warehouseReceiptStatus?: string; received?: boolean } | null>('getReturnStatus', { returnDocumentNumber: returnNumber })
    return { status: r?.warehouseReceiptStatus ?? 'UNKNOWN', received: !!r?.received }
  }

  private writeResult(type: 'YRE' | 'YCR', r: unknown): WriteResult {
    const o = (r ?? {}) as Record<string, unknown>
    const number = String(o[type === 'YRE' ? 'CustomerReturn' : 'CreditMemoRequest'] ?? o.number ?? o.documentNumber ?? '')
    if (!number) return { ok: false, status: 502, message: `Gateway returned no document number: ${JSON.stringify(o).slice(0, 300)}` }
    return { ok: true, number, response: o, etag: versionStampOf(o) }
  }

  /**
   * The gateway derives the SAP order reason from the rule, so the rule must be one that creates this document type
   * and its reason must match ours. Anything else is refused here, before any call: a wrong reason never reaches SAP.
   */
  private ruleGuard(type: 'YRE' | 'YCR', ctx: WriteContext, reasonCode: unknown): WriteResult | null {
    const expected = GATEWAY_RULES[ctx.rule]
    if (!expected || expected.type !== type || expected.reason !== String(reasonCode ?? '')) {
      return { ok: false, status: 400, message: `Rule ${ctx.rule} with order reason ${String(reasonCode)} does not create a ${type} on the gateway. Nothing was written.` }
    }
    if (!ctx.gatewayLogId) return { ok: false, status: 400, message: 'The gateway needs the approval record (auditLogID) before it writes. Nothing was written.' }
    return null
  }

  private logResult(r: unknown): LogResult {
    const o = (r ?? {}) as Record<string, unknown>
    const id = String(o.ID ?? o.id ?? '')
    if (!id) return { ok: false, status: 502, message: `Gateway returned no approval record ID: ${JSON.stringify(o).slice(0, 300)}` }
    return { ok: true, id, response: o }
  }

  async logRequest(args: LogRequestArgs): Promise<LogResult> {
    try {
      return this.logResult(await this.action('logRequest', { ...args, evidenceUrl: args.evidenceUrl ?? null }))
    } catch (e) {
      const err = e as Error & { status?: number }
      return { ok: false, status: err.status ?? 502, message: err.message }
    }
  }

  async setApprovalStatus(args: { id: string; status: 'APPROVED' | 'REJECTED'; approvedBy: string; approverRole: string }): Promise<LogResult> {
    try {
      // The gateway spells roles with hyphens (credit-manager) and checks them against the credit value.
      return this.logResult(await this.action('setApprovalStatus', { ID: args.id, status: args.status, approvedBy: args.approvedBy, approverRole: args.approverRole.replace(/_/g, '-') }))
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

  async createReturn(payload: Record<string, unknown>, ctx: WriteContext) {
    const item = (payload.to_Item as Record<string, string>[] | undefined)?.[0] ?? {}
    const blocked = this.demoGuard(item.ReferenceSDDocument) ?? this.ruleGuard('YRE', ctx, payload.SDDocumentReason)
    if (blocked) return blocked
    try {
      const r = await this.action('createReturn', {
        auditLogID: ctx.gatewayLogId,
        invoiceNumber: item.ReferenceSDDocument,
        invoiceItem: item.ReferenceSDDocumentItem,
        material: item.Material,
        quantity: item.RequestedQuantity,
        unit: item.RequestedQuantityUnit,
        rule: ctx.rule,
        soldToParty: payload.SoldToParty,
        creditValue: ctx.creditValue,
      })
      return this.writeResult('YRE', r)
    } catch (e) {
      return this.catchWrite(e)
    }
  }

  async createCreditMemoRequest(payload: Record<string, unknown>, ctx: WriteContext) {
    const item = (payload.to_Item as Record<string, string>[] | undefined)?.[0] ?? {}
    const blocked = this.demoGuard(payload.ReferenceSDDocument) ?? this.ruleGuard('YCR', ctx, payload.SDDocumentReason)
    if (blocked) return blocked
    try {
      const r = await this.action('createCreditMemoRequest', {
        auditLogID: ctx.gatewayLogId,
        invoiceNumber: payload.ReferenceSDDocument,
        invoiceItem: item.ReferenceSDDocumentItem,
        material: item.Material,
        quantity: item.RequestedQuantity,
        unit: item.RequestedQuantityUnit,
        rule: ctx.rule,
        soldToParty: payload.SoldToParty,
        creditValue: ctx.creditValue,
        evidenceUrl: ctx.evidenceUrl ?? null,
      })
      return this.writeResult('YCR', r)
    } catch (e) {
      return this.catchWrite(e)
    }
  }

  async release(args: { type: 'YRE' | 'YCR'; number: string; etag: string }): Promise<WriteResult> {
    if (!args.etag) {
      return { ok: false, status: 409, message: `SAP returned no version stamp when ${args.number} was created, so it cannot be released safely. Check the document in SAP.` }
    }
    try {
      const r =
        args.type === 'YCR'
          ? await this.action('releaseCreditMemoRequest', { creditMemoNumber: args.number, versionStamp: args.etag })
          : await this.action('releaseCustomerReturn', { returnDocumentNumber: args.number, versionStamp: args.etag })
      return { ok: true, number: args.number, response: (r ?? {}) as Record<string, unknown> }
    } catch (e) {
      return this.catchWrite(e)
    }
  }
}

const READ_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 30_000

/** The gateway's own rule table (from its owner, 5 Oct 2026): which document and SAP order reason each rule creates. */
const GATEWAY_RULES: Record<string, { type: 'YRE' | 'YCR'; reason: string }> = {
  R1: { type: 'YRE', reason: '102' },
  R2: { type: 'YRE', reason: '101' },
  R3: { type: 'YCR', reason: '104' },
  R4: { type: 'YCR', reason: '101' },
  R5: { type: 'YCR', reason: '103' },
}

/** The version stamp SAP returned on create. Live name (5 Oct 2026): `sapDocumentVersion`; older shapes kept. */
export function versionStampOf(o: Record<string, unknown>): string | undefined {
  const meta = o.__metadata as { etag?: string } | undefined
  const v = (o.sapDocumentVersion ?? o.versionStamp ?? o.etag ?? meta?.etag) as string | undefined
  return v ? String(v) : undefined
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

interface RawPrice {
  unitPrice?: string | number
  price?: string | number
  amount?: string | number
  rate?: string | number
  ConditionRateValue?: string | number
  ConditionRateAmount?: string | number
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
