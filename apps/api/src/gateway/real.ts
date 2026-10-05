import { DEMO_INVOICES, type ExistingDoc, type InvoiceSnapshot } from '@reclaim/shared'
import type { Gateway, WriteResult } from './types'

/**
 * Calls the CAP gateway on BTP (Alex's service). The gateway is the only thing that talks to DS4.
 *
 * Known shape of the service as of 5 Oct 2026 (CDS):
 *   function getInvoice(invoiceNumber: String) returns String;
 *   function checkExistingCredits(invoiceNumber: String) returns String;
 *   action createReturn(invoiceNumber, invoiceItem, material, quantity, unit, reason, soldToParty) returns String;
 *   action createCreditMemoRequest(invoiceNumber, material, quantity, unit, reason, soldToParty) returns String;
 *
 * Every function returns a JSON *string* inside `{ "value": "..." }`. `unwrap()` hides that.
 * Still missing on the gateway (the methods below call the names we agreed; adjust when he ships them):
 *   releaseCreditMemoRequest(number, type): the gateway must GET the document, take its ETag and PATCH with If-Match;
 *   getAgreedPrice(material, salesOrg, channel), findInvoices(customer, material, dateFrom, dateTo)
 *
 * Plant → company code is NOT a gateway call; it is our own reference table.
 */
export class RealGateway implements Gateway {
  constructor(
    private base: string,
    private plantCompany: Record<string, string> = { YGLG: 'YDE1', YRO1: 'YRO1' },
  ) {}

  private async fn<T>(name: string, params: Record<string, string>): Promise<T> {
    const args = Object.entries(params)
      .map(([k, v]) => `${k}='${encodeURIComponent(v)}'`)
      .join(',')
    const res = await fetch(`${this.base}/${name}(${args})`, { headers: { accept: 'application/json' } })
    if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status })
    return this.unwrap<T>(await res.json())
  }

  private async action<T>(name: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.base}/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
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

  async findInvoices(args: { customer: string; material: string; dateFrom: string; dateTo: string }) {
    const raw = await this.fn<RawInvoice[] | { results?: RawInvoice[] }>('findInvoices', args)
    const list = Array.isArray(raw) ? raw : (raw.results ?? [])
    return list.map((r) => this.toSnapshot(r))
  }

  async getAgreedPrice(args: { material: string; salesOrg: string; channel: string }) {
    const r = await this.fn<{ unitPrice?: string | number; ConditionRateValue?: string | number } | null>('getAgreedPrice', args)
    const v = r?.unitPrice ?? r?.ConditionRateValue
    return v == null ? null : Number(v)
  }

  async getPlantCompanyCode(plant: string) {
    return this.plantCompany[plant] ?? null
  }

  private writeResult(type: 'YRE' | 'YCR', r: unknown): WriteResult {
    const o = (r ?? {}) as Record<string, unknown>
    const number = String(o[type === 'YRE' ? 'CustomerReturn' : 'CreditMemoRequest'] ?? o.number ?? o.documentNumber ?? '')
    if (!number) return { ok: false, status: 502, message: `Gateway returned no document number: ${JSON.stringify(o).slice(0, 300)}` }
    return { ok: true, number, response: o }
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
    try {
      const r = await this.action('createReturn', {
        invoiceNumber: item.ReferenceSDDocument,
        invoiceItem: item.ReferenceSDDocumentItem,
        material: item.Material,
        quantity: item.RequestedQuantity,
        unit: item.RequestedQuantityUnit,
        reason: payload.SDDocumentReason,
        soldToParty: payload.SoldToParty,
        customerReference: payload.PurchaseOrderByCustomer,
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
    try {
      const r = await this.action('createCreditMemoRequest', {
        invoiceNumber: payload.ReferenceSDDocument,
        material: item.Material,
        quantity: item.RequestedQuantity,
        unit: item.RequestedQuantityUnit,
        reason: payload.SDDocumentReason,
        soldToParty: payload.SoldToParty,
        customerReference: payload.PurchaseOrderByCustomer,
      })
      return this.writeResult('YCR', r)
    } catch (e) {
      return this.catchWrite(e)
    }
  }

  async release(args: { type: 'YRE' | 'YCR'; number: string }): Promise<WriteResult> {
    try {
      const r = await this.action('releaseCreditMemoRequest', { number: args.number, type: args.type })
      return { ok: true, number: args.number, response: (r ?? {}) as Record<string, unknown> }
    } catch (e) {
      return this.catchWrite(e)
    }
  }
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

interface RawExisting {
  CustomerReturn?: string
  CreditMemoRequest?: string
  number?: string
  SDDocumentReason?: string
  TotalNetAmount?: string
  HeaderBillingBlockReason?: string
}
