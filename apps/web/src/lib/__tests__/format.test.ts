import { describe, it, expect } from 'vitest'
import { formatMoney, formatQty, formatDate, formatRelative } from '../format'

describe('format', () => {
  it('money', () => {
    expect(formatMoney(540, 'EUR')).toBe('540.00 EUR')
    expect(formatMoney(4050, 'EUR')).toBe('4 050.00 EUR')
    expect(formatMoney(1234567.5, 'EUR')).toBe('1 234 567.50 EUR')
  })
  it('qty', () => {
    expect(formatQty(2, 'KG')).toBe('2 KG')
    expect(formatQty(2.5, 'KG')).toBe('2.5 KG')
  })
  it('date', () => {
    expect(formatDate('2026-10-05T07:30:00Z')).toBe('05 Oct 2026')
  })
  it('relative', () => {
    const now = Date.parse('2026-10-05T08:00:00Z')
    expect(formatRelative('2026-10-05T07:59:30Z', now)).toBe('30s ago')
    expect(formatRelative('2026-10-05T07:30:00Z', now)).toBe('30 min ago')
    expect(formatRelative('2026-10-04T08:00:00Z', now)).toBe('1 d ago')
  })
})
