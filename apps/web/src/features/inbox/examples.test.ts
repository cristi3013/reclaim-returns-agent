import { describe, expect, it } from 'vitest'
import { DEMO_INVOICES } from '@reclaim/shared'
import { COMPLAINT_EXAMPLES, examplesTargetTeamInvoices } from './examples'

describe('ready-made complaints', () => {
  it('target the team invoices only, never the shared demo ones', () => {
    expect(COMPLAINT_EXAMPLES.length).toBeGreaterThan(0)
    expect(examplesTargetTeamInvoices()).toBe(true)
    expect(COMPLAINT_EXAMPLES.some((e) => DEMO_INVOICES.includes(e.invoice))).toBe(false)
  })
})
