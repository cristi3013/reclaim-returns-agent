import { describe, it, expect } from 'vitest'
import { DecisionSchema, SettingsSchema } from '../schemas'
describe('schemas', () => {
  it('parses a decision', () => { expect(DecisionSchema.parse({ ruleId: 'R5', documentType: 'YCR', reasonCode: '103', material: '54', quantity: 2, unit: 'KG', amount: 540, currency: 'EUR', approverRole: 'credit_manager', intercompany: false, requiresCustomerConfirmation: false, notes: '' }).amount).toBe(540) })
  it('rejects unknown status', () => { expect(() => SettingsSchema.parse({ sapMode: 'live', aiMode: 'assisted', simulateConflict: false })).toThrow() })
})

import { preferItem } from '../schemas'
describe('preferItem', () => {
  const inv = { number: '1', date: '2026-09-29', customer: '10021', customerName: 'C', salesOrg: 'YSOD', distributionChannel: 'Y1', division: 'Y5', companyCode: 'YDE1', currency: 'EUR', totalNetAmount: 0, etag: '', items: [
    { item: '10', material: '99', description: '', quantity: 1, unit: 'KG', netAmount: 10, unitPrice: 10, plant: 'YGLG', salesOrder: '1', delivery: '2' },
    { item: '20', material: '54', description: '', quantity: 5, unit: 'KG', netAmount: 1350, unitPrice: 270, plant: 'YGLG', salesOrder: '1', delivery: '2' },
  ] }
  it('moves the matching line first and keeps the rest', () => { const r = preferItem(inv, '54'); expect(r.items.map((i) => i.item)).toEqual(['20', '10']); expect(inv.items[0]!.item).toBe('10') })
  it('leaves the invoice alone when nothing matches', () => { expect(preferItem(inv, '7').items[0]!.item).toBe('10'); expect(preferItem(inv, null)).toBe(inv) })
})
