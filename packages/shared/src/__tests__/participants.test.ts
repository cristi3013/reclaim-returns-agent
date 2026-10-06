import { describe, it, expect } from 'vitest'
import { fromCustomerSide, participants, senderName, type ThreadMessage } from '../thread'
import { statusAfterProposal } from '../rules'
import type { Decision, Facts } from '../schemas'

const msg = (
  from: string,
  direction: 'in' | 'out' = 'in',
  at = '2026-10-06T08:00:00Z',
): ThreadMessage => ({
  id: `${from}-${at}`,
  direction,
  from,
  at,
  subject: 'Wrong labels',
  text: '…',
  attachments: [],
  actor: direction === 'out' ? 'Lead' : null,
})

describe('who writes on a case', () => {
  it('tells the customer, the desk and anyone else apart, in the order they first wrote', () => {
    const customer = 'Quality <quality@cust.example>'
    const list = participants(
      [
        msg(customer),
        msg('returns@reclaim.example', 'out', '2026-10-06T09:00:00Z'),
        msg('Dock Team <dock@warehouse-north.example>', 'in', '2026-10-06T10:00:00Z'),
        msg('buyer@cust.example', 'in', '2026-10-06T11:00:00Z'),
        msg(customer, 'in', '2026-10-06T12:00:00Z'),
      ],
      customer,
    )
    expect(list.map((p) => [p.name, p.side, p.messages])).toEqual([
      ['Quality', 'customer', 2],
      ['Reclaim returns desk', 'us', 1],
      ['Dock Team', 'other', 1],
      ['buyer', 'customer', 1],
    ])
    expect(list[2]!.organisation).toBe('warehouse-north.example')
    expect(list[0]!.lastAt).toBe('2026-10-06T12:00:00Z')
  })

  it('reads names and sides from addresses', () => {
    expect(senderName('"Jane Doe" <jane@acme.example>')).toBe('Jane Doe')
    expect(senderName('jane@acme.example')).toBe('jane')
    expect(fromCustomerSide({ from: 'a@Cust.example' }, 'B <b@cust.example>')).toBe(true)
    expect(fromCustomerSide({ from: 'a@cust.example' }, 'dock@warehouse.example')).toBe(false)
  })
})

describe('status after the proposal', () => {
  const d = (ruleId: Decision['ruleId']) => ({ ruleId }) as Decision
  const f = (invoiceNumber: string | null) => ({ invoiceNumber }) as Facts

  it('waits for the customer when no invoice is named, and sends a named but unknown one to a person', () => {
    expect(statusAfterProposal(d('NONE'), f(null))).toBe('needs_customer_input')
    expect(statusAfterProposal(d('NONE'), f('90009999'))).toBe('awaiting_approval')
    expect(statusAfterProposal(d('R9'), f(null))).toBe('needs_customer_input')
    expect(statusAfterProposal(d('R7'), f('90000355'))).toBe('needs_customer_input')
    expect(statusAfterProposal(d('R8'), f('90000355'))).toBe('duplicate')
    expect(statusAfterProposal(d('R6'), f('90000355'))).toBe('handed_over')
    expect(statusAfterProposal(d('R3'), f('90000355'))).toBe('awaiting_approval')
  })
})
