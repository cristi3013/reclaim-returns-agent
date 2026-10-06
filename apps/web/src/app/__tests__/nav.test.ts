import { it, expect } from 'vitest'
import { isActive } from '../layout/nav'

it("a complaint's page is under Cases, not the Inbox; an email stays in the Inbox", () => {
  expect(isActive('/invoices', '/cases/case-1')).toBe(true)
  expect(isActive('/inbox', '/cases/case-1')).toBe(false)
  expect(isActive('/invoices', '/invoices/90000355')).toBe(true)
  expect(isActive('/inbox', '/inbox/case-1')).toBe(true)
  expect(isActive('/invoices', '/inbox/case-1')).toBe(false)
})
