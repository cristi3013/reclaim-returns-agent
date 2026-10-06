import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ThreadMessage } from '@reclaim/shared'
import { Conversation } from '../Conversation'

const m = (
  id: string,
  from: string,
  text: string,
  direction: 'in' | 'out' = 'in',
): ThreadMessage => ({
  id,
  direction,
  from,
  at: `2026-10-06T0${id}:00:00Z`,
  subject: 'Wrong labels',
  text,
  attachments: [],
  actor: direction === 'out' ? 'Lead' : null,
})

const MESSAGES = [
  m('1', 'Quality <quality@cust.example>', 'The labels are wrong.'),
  m('2', 'returns@reclaim.example', 'Which invoice was it?', 'out'),
  m('3', 'Dock Team <dock@warehouse-north.example>', 'We relabelled the rest.'),
  m('4', 'Quality <quality@cust.example>', 'Invoice 90000355.'),
]

describe('Conversation', () => {
  it('shows everyone who wrote, with their side, and one person at a time on request', () => {
    render(<Conversation messages={MESSAGES} customerFrom={MESSAGES[0]!.from} label="Emails" />)
    const people = within(screen.getByRole('group', { name: 'People in this conversation' }))
    const chips = people.getAllByRole('button')
    expect(chips.map((b) => b.textContent)).toEqual([
      'QUQualityCustomer · 2',
      'RRReclaim returns deskReclaim · 1',
      'DTDock Teamwarehouse-north.example · 1',
    ])
    const emails = () =>
      within(screen.getByRole('list', { name: 'Emails' })).getAllByRole('listitem')
    expect(emails()).toHaveLength(4)
    expect(emails()[2]).toHaveTextContent('warehouse-north.example')

    fireEvent.click(chips[2]!)
    expect(chips[2]).toHaveAttribute('aria-pressed', 'true')
    expect(emails()).toHaveLength(1)
    expect(emails()[0]).toHaveTextContent('We relabelled the rest.')
    fireEvent.click(screen.getByRole('button', { name: 'Show everyone' }))
    expect(emails()).toHaveLength(4)
  })
})
