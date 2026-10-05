import { describe, it, expect } from 'vitest'
import { groupByInvoice, invoiceCaseStatus, invoiceConversation } from '../invoice-cases'
import type { CaseStatus } from '../enums'
import type { Case, CaseSummary } from '../schemas'

const row = (id: string, invoice: string | null, status: CaseStatus, at: string): CaseSummary => ({
  id,
  receivedAt: at,
  from: 'quality@cust.example',
  subject: `Complaint ${id}`,
  customer: '10021',
  customerName: 'Cust DE 1',
  invoiceNumber: invoice,
  complaintType: 'damaged',
  status,
  outcome: null,
  ruleId: null,
  documentType: null,
  amount: null,
  currency: 'EUR',
  approverRole: null,
  intercompany: false,
  updatedAt: at,
})

describe('invoice cases', () => {
  it('Open while any complaint needs us, Pending while we wait for the customer, else Closed', () => {
    expect(invoiceCaseStatus(['written_to_sap', 'awaiting_approval'])).toBe('open')
    expect(invoiceCaseStatus(['closed', 'needs_customer_input'])).toBe('pending')
    expect(invoiceCaseStatus(['written_to_sap', 'closed', 'duplicate'])).toBe('closed')
  })

  it('one case per invoice; a new complaint on a finished invoice reopens it', () => {
    const cases = groupByInvoice([
      row('a', '90000353', 'written_to_sap', '2026-10-01T10:00:00Z'),
      row('b', '90000354', 'closed', '2026-10-02T10:00:00Z'),
      row('c', '90000353', 'received', '2026-10-05T10:00:00Z'),
      row('d', null, 'received', '2026-10-05T11:00:00Z'),
    ])
    expect(
      cases.map((c) => [c.invoice, c.status, c.reopened, c.complaints.map((x) => x.id)]),
    ).toEqual([
      ['90000353', 'open', true, ['a', 'c']],
      ['90000354', 'closed', false, ['b']],
    ])
    expect(cases[0]!.openedAt).toBe('2026-10-01T10:00:00Z')
    expect(cases[0]!.subject).toBe('Complaint c')
  })

  it('the conversation runs across complaints and marks where a finished case was reopened', () => {
    const mk = (id: string, status: CaseStatus, at: string, text: string) =>
      ({
        ...row(id, '90000353', status, at),
        bodyText: text,
        attachments: [],
        events: [],
      }) as unknown as Case
    const done = mk('a', 'written_to_sap', '2026-10-01T10:00:00Z', 'Two drums leaked.')
    const later = mk('b', 'received', '2026-10-05T10:00:00Z', 'Another drum leaked.')
    expect(
      invoiceConversation([later, done]).map((m) => [
        m.caseId,
        m.text,
        m.startsComplaint,
        m.reopens,
      ]),
    ).toEqual([
      ['a', 'Two drums leaked.', false, false],
      ['b', 'Another drum leaked.', true, true],
    ])
    const open = { ...done, status: 'awaiting_approval' } as Case
    expect(invoiceConversation([open, later])[1]).toMatchObject({
      startsComplaint: true,
      reopens: false,
    })
  })
})
