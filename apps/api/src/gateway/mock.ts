import { AGREED_PRICE, FIXTURES, INVOICES, PLANT_COMPANY, type ExistingDoc } from '@reclaim/shared'
import type { Gateway, WriteResult } from './types'

/**
 * Replays the DS4 answers captured on 1 Oct 2026 and simulates writes.
 * `simulateConflict` makes every write fail with 412, the way SAP does when the ETag no longer matches.
 */
export class MockGateway implements Gateway {
  private nextDoc = 60000171
  /** Documents this gateway "created", keyed by invoice, so duplicate detection sees them. */
  private created = new Map<string, ExistingDoc[]>()
  constructor(private opts: { simulateConflict: () => boolean; delayMs?: number } = { simulateConflict: () => false }) {}

  /** Forget simulated documents (demo reset). */
  reset() {
    this.created.clear()
    this.nextDoc = 60000171
  }

  private delay(ms: number) {
    return new Promise<void>((r) => setTimeout(r, this.opts.delayMs ?? ms))
  }

  async getInvoice(invoiceNumber: string) {
    await this.delay(450)
    return INVOICES[invoiceNumber] ?? null
  }

  async checkExistingCredits(invoiceNumber: string) {
    await this.delay(450)
    const fx = FIXTURES.find((f) => f.facts.invoiceNumber === invoiceNumber)
    const seeded = fx?.existingCredits ?? []
    const mine = this.created.get(invoiceNumber) ?? []
    const all = [...seeded, ...mine]
    return { existingReturns: all.filter((d) => d.type === 'YRE'), existingCredits: all.filter((d) => d.type === 'YCR') }
  }

  async findInvoices(args: { customer: string; material: string; dateFrom: string; dateTo: string }) {
    await this.delay(620)
    // The captured data has one invoice without a complaint email naming it: 90000357 (15 KG, 29 Sep 2026).
    return Object.values(INVOICES).filter(
      (i) => i.customer === args.customer && i.items[0]?.material === args.material && i.date >= args.dateFrom && i.date <= args.dateTo && i.number === '90000357',
    )
  }

  async getAgreedPrice(args: { material: string; salesOrg: string; channel: string }) {
    await this.delay(380)
    return args.material === AGREED_PRICE.material && args.salesOrg === AGREED_PRICE.salesOrg ? AGREED_PRICE.unitPrice : null
  }

  async getPlantCompanyCode(plant: string) {
    await this.delay(120)
    return PLANT_COMPANY[plant] ?? null
  }

  private write(type: 'YRE' | 'YCR', payload: Record<string, unknown>): WriteResult {
    if (this.opts.simulateConflict()) {
      return { ok: false, status: 412, message: 'The record changed in SAP since it was read. Nothing was written. Reload the case and approve again.' }
    }
    const number = String(this.nextDoc++)
    const invoice = String(payload.ReferenceSDDocument ?? (payload.to_Item as { ReferenceSDDocument?: string }[] | undefined)?.[0]?.ReferenceSDDocument ?? '')
    const list = this.created.get(invoice) ?? []
    list.push({ type, number, reasonCode: String(payload.SDDocumentReason ?? ''), amount: 0, billingBlock: '08' })
    this.created.set(invoice, list)
    return { ok: true, number, response: { status: 201, [type === 'YRE' ? 'CustomerReturn' : 'CreditMemoRequest']: number, HeaderBillingBlockReason: '08' } }
  }

  async createReturn(payload: Record<string, unknown>) {
    await this.delay(600)
    return this.write('YRE', payload)
  }

  async createCreditMemoRequest(payload: Record<string, unknown>) {
    await this.delay(600)
    return this.write('YCR', payload)
  }

  async release(args: { type: 'YRE' | 'YCR'; number: string; etag: string }): Promise<WriteResult> {
    await this.delay(500)
    if (this.opts.simulateConflict()) {
      return { ok: false, status: 412, message: 'The record changed in SAP since it was read. Nothing was changed.' }
    }
    return { ok: true, number: args.number, response: { status: 204, HeaderBillingBlockReason: '' } }
  }
}
