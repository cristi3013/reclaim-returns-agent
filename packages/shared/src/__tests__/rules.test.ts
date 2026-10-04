import { describe, it, expect } from 'vitest'
import { decide } from '../rules'
import type { Facts, Findings, InvoiceSnapshot } from '../schemas'
const inv = (number: string, quantity: number, plant = 'YGLG'): InvoiceSnapshot => ({ number, date: '2026-09-29', customer: '10021', customerName: 'Cust DE 1', salesOrg: 'YSOD', distributionChannel: 'Y1', division: 'Y5', companyCode: 'YDE1', currency: 'EUR', totalNetAmount: quantity * 270, etag: 'W/"1"', items: [{ item: '10', material: '54', description: 'Soda material (HAWA)', quantity, unit: 'KG', netAmount: quantity * 270, unitPrice: 270, plant, salesOrder: '1610', delivery: '80608800' }] })
const facts = (p: Partial<Facts>): Facts => ({ invoiceNumber: '90000353', material: '54', claimedQuantity: 2, unit: 'KG', complaintType: 'damaged', claimedUnitPrice: null, wantsReplacement: false, goodsReturnable: null, evidence: '', language: 'en', ...p })
const findings = (p: Partial<Findings>): Findings => ({ invoice: inv('90000353', 5), candidateInvoices: [], existingReturns: [], existingCredits: [], agreedUnitPrice: 270, plantCompanyCode: 'YDE1', lookups: [], ...p })
const ctx = { openCaseOnInvoice: null }
describe('decide', () => {
  it('damaged + leaked: two options, R3 recommended, 540 EUR, credit manager', () => {
    const r = decide(facts({ goodsReturnable: false }), findings({}), ctx)
    expect(r.options.map((o) => o.ruleId)).toEqual(['R1', 'R3']); expect(r.recommendedIndex).toBe(1)
    expect(r.options[1]).toMatchObject({ documentType: 'YCR', reasonCode: '104', quantity: 2, amount: 540, approverRole: 'credit_manager' })
    expect(r.options[0]).toMatchObject({ documentType: 'YRE', reasonCode: '102', approverRole: 'credit_manager' })
  })
  it('price equal to agreed: R4, no document, credit manager confirms', () => {
    const r = decide(facts({ invoiceNumber: '90000354', complaintType: 'price', claimedQuantity: 12, claimedUnitPrice: 260 }), findings({ invoice: inv('90000354', 12) }), ctx)
    expect(r.options[0]).toMatchObject({ ruleId: 'R4', documentType: 'NONE', amount: 0, approverRole: 'credit_manager' })
  })
  it('price above agreed: R4 credits the difference', () => {
    const f = findings({ invoice: inv('90000354', 12), agreedUnitPrice: 260 })
    expect(decide(facts({ invoiceNumber: '90000354', complaintType: 'price', claimedQuantity: 12, claimedUnitPrice: 260 }), f, ctx).options[0]).toMatchObject({ ruleId: 'R4', documentType: 'YCR', reasonCode: '101', amount: 120 })
  })
  it('short delivery: R5 YCR 103', () => { expect(decide(facts({ invoiceNumber: '90000355', complaintType: 'short_delivery' }), findings({ invoice: inv('90000355', 20) }), ctx).options[0]).toMatchObject({ ruleId: 'R5', documentType: 'YCR', reasonCode: '103', quantity: 2, amount: 540, approverRole: 'credit_manager' }) })
  it('over quantity: R7, nothing', () => { expect(decide(facts({ invoiceNumber: '90000356', complaintType: 'quality', claimedQuantity: 10 }), findings({ invoice: inv('90000356', 8) }), ctx).options[0]).toMatchObject({ ruleId: 'R7', documentType: 'NONE', quantity: 0, amount: 0, approverRole: null }) })
  it('no invoice: R9 proposes candidate, needs confirmation', () => { const r = decide(facts({ invoiceNumber: null, complaintType: 'quality', claimedQuantity: 15 }), findings({ invoice: null, candidateInvoices: [inv('90000357', 15)] }), ctx).options[0]; expect(r).toMatchObject({ ruleId: 'R9', documentType: 'NONE', quantity: 15, amount: 4050, requiresCustomerConfirmation: true }) })
  it('duplicate via SAP document or open case: R8', () => {
    expect(decide(facts({}), findings({ existingCredits: [{ type: 'YCR', number: '60000171', reasonCode: '104', amount: 540, billingBlock: '08' }] }), ctx).options[0]!.ruleId).toBe('R8')
    expect(decide(facts({}), findings({}), { openCaseOnInvoice: 'case-01' }).options[0]!.ruleId).toBe('R8')
  })
  it('replacement: R6', () => { expect(decide(facts({ invoiceNumber: '90000358', complaintType: 'ruined', claimedQuantity: 5, wantsReplacement: true }), findings({ invoice: inv('90000358', 5) }), ctx).options[0]).toMatchObject({ ruleId: 'R6', documentType: 'NONE', quantity: 5, amount: 1350 }) })
  it('intercompany flag when plant company differs', () => { const r = decide(facts({ invoiceNumber: '90000359', claimedQuantity: 3, goodsReturnable: true }), findings({ invoice: inv('90000359', 10, 'YRO1'), plantCompanyCode: 'YRO1' }), ctx); expect(r.options[r.recommendedIndex]).toMatchObject({ ruleId: 'R1', intercompany: true, amount: 810, approverRole: 'credit_manager' }) })
  it('quantity capped and amount from invoice price', () => { expect(decide(facts({ complaintType: 'quality', claimedQuantity: 5 }), findings({}), ctx).options[0]).toMatchObject({ ruleId: 'R2', quantity: 5, amount: 1350 }) })
})
