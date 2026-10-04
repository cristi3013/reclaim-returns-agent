import { describe, it, expect } from 'vitest'
import { approverFor, capQuantity, RULES, APPROVAL_THRESHOLDS } from '../policy'

describe('approverFor', () => {
  it('routes by value', () => {
    expect(approverFor(300, 'R1')).toBe('customer_service_lead')
    expect(approverFor(540, 'R1')).toBe('credit_manager')
    expect(approverFor(6000, 'R1')).toBe('finance_director')
  })
  it('credit without goods goes to credit manager at least', () => {
    expect(approverFor(120, 'R4')).toBe('credit_manager')
    expect(approverFor(120, 'R5')).toBe('credit_manager')
    expect(approverFor(120, 'R3')).toBe('credit_manager')
    expect(approverFor(6000, 'R3')).toBe('finance_director')
  })
})
describe('capQuantity', () => {
  it('never exceeds invoiced', () => {
    expect(capQuantity(10, 8)).toBe(8)
    expect(capQuantity(2, 5)).toBe(2)
    expect(capQuantity(-1, 5)).toBe(0)
  })
})
describe('RULES', () => {
  it('has nine rules with document and reason', () => {
    expect(Object.keys(RULES)).toHaveLength(10)
    expect(RULES.R1.documentType).toBe('YRE'); expect(RULES.R1.reasonCode).toBe('102')
    expect(RULES.R5.documentType).toBe('YCR'); expect(RULES.R5.reasonCode).toBe('103')
    expect(RULES.R7.documentType).toBe('NONE')
  })
  it('thresholds are ordered', () => {
    expect(APPROVAL_THRESHOLDS.map((t) => t.upTo)).toEqual([500, 5000, Infinity])
  })
})
