import { describe, it, expect } from 'vitest'
import { DecisionSchema, SettingsSchema } from '../schemas'
describe('schemas', () => {
  it('parses a decision', () => { expect(DecisionSchema.parse({ ruleId: 'R5', documentType: 'YCR', reasonCode: '103', material: '54', quantity: 2, unit: 'KG', amount: 540, currency: 'EUR', approverRole: 'credit_manager', intercompany: false, requiresCustomerConfirmation: false, notes: '' }).amount).toBe(540) })
  it('rejects unknown status', () => { expect(() => SettingsSchema.parse({ sapMode: 'live', aiMode: 'assisted', simulateConflict: false })).toThrow() })
})
