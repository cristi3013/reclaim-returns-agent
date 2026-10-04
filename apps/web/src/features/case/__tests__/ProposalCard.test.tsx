import { it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Proposal } from '@reclaim/shared'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ProposalCard } from '../ProposalCard'

const p: Proposal = {
  id: 'p1',
  caseId: 'c',
  option: 'B',
  recommended: true,
  chosen: false,
  decision: {
    ruleId: 'R3',
    documentType: 'YCR',
    reasonCode: '104',
    material: '54',
    quantity: 2,
    unit: 'KG',
    amount: 540,
    currency: 'EUR',
    approverRole: 'credit_manager',
    intercompany: false,
    requiresCustomerConfirmation: false,
    notes: '',
  },
  sapPayload: { CreditMemoRequestType: 'YCR' },
  explanation: 'Rule R3 applies.',
  policyCitations: [{ ruleId: 'R3', text: 'R3 — Goods ruined' }],
  replyDraft: 'Dear customer',
  briefing: { whatHappened: 'a', whatWePropose: 'b', risk: 'c' },
  createdAt: '2026-10-05T08:00:00Z',
}

it('shows rule, decision table, recommended marker and choose button', () => {
  render(
    <TooltipProvider>
      <ProposalCard proposal={p} canChoose onChoose={() => {}} />
    </TooltipProvider>,
  )
  expect(screen.getByText('Recommended')).toBeInTheDocument()
  expect(screen.getByText('540.00 EUR')).toBeInTheDocument()
  expect(screen.getByText(/R3 — Goods ruined/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /choose option b/i })).toBeInTheDocument()
})
