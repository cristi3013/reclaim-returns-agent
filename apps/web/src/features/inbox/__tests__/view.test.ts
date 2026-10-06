import { describe, it, expect } from 'vitest'
import type { CaseSummary } from '@reclaim/shared'
import { isFresh, matchesQuery, matchesStatus, sortRows, toggleSort } from '../view'

const row = (id: string, o: Partial<CaseSummary>): CaseSummary =>
  ({
    id,
    receivedAt: '2026-10-05T08:00:00Z',
    updatedAt: '2026-10-05T08:00:00Z',
    from: 'a@b.com',
    subject: id,
    customer: null,
    customerName: null,
    invoiceNumber: null,
    status: 'received',
    amount: null,
    ...o,
  }) as CaseSummary

const old = row('old', { receivedAt: '2026-10-05T08:00:00Z', updatedAt: '2026-10-05T12:00:00Z' })
const fresh = row('new', { receivedAt: '2026-10-05T10:00:00Z', amount: 50 })
const big = row('big', {
  receivedAt: '2026-10-05T09:00:00Z',
  amount: 900,
  status: 'awaiting_approval',
})
const ids = (rs: CaseSummary[]) => rs.map((r) => r.id)

describe('inbox order', () => {
  it('latest activity first by default: an old case updated now beats a newer untouched one', () => {
    expect(ids(sortRows([fresh, big, old], { key: 'activity', dir: 'desc' }))).toEqual([
      'old',
      'new',
      'big',
    ])
  })
  it('by received, either way, and by amount with no amount last', () => {
    expect(ids(sortRows([old, fresh, big], { key: 'received', dir: 'desc' }))).toEqual([
      'new',
      'big',
      'old',
    ])
    expect(ids(sortRows([fresh, old, big], { key: 'received', dir: 'asc' }))).toEqual([
      'old',
      'big',
      'new',
    ])
    expect(ids(sortRows([old, fresh, big], { key: 'amount', dir: 'desc' }))).toEqual([
      'big',
      'new',
      'old',
    ])
  })
  it('a header click flips the same column, a new column starts descending', () => {
    expect(toggleSort({ key: 'received', dir: 'desc' }, 'received')).toEqual({
      key: 'received',
      dir: 'asc',
    })
    expect(toggleSort({ key: 'received', dir: 'asc' }, 'amount')).toEqual({
      key: 'amount',
      dir: 'desc',
    })
  })
})

describe('inbox filters', () => {
  it('status, needs action, and search over invoice and customer', () => {
    expect(matchesStatus(big, 'action', 'open')).toBe(true)
    expect(matchesStatus(old, 'action', 'open')).toBe(false)
    expect(matchesStatus(old, 'open', 'open')).toBe(true)
    expect(matchesStatus(old, 'closed', 'open')).toBe(false)
    expect(matchesStatus(old, '', 'open')).toBe(true)
    const r = row('x', { invoiceNumber: '90000354', customerName: 'Cust DE 1' })
    expect(matchesQuery(r, ' 90000354 ')).toBe(true)
    expect(matchesQuery(r, 'cust de')).toBe(true)
    expect(matchesQuery(r, 'nope')).toBe(false)
  })
  it('fresh for two minutes after the last change', () => {
    const t = Date.parse('2026-10-05T12:00:00Z')
    expect(isFresh(old, t + 60_000)).toBe(true)
    expect(isFresh(old, t + 3 * 60_000)).toBe(false)
  })
})
