/** The organizers' expected-results.json, as fields the evaluation compares, plus our case 08. */
export interface Expected {
  rule: string
  document: string
  reason: string
  quantity: number
  amount: number
  approver: string
  status: string
  optionA?: { rule: string; document: string; reason: string }
}

export const EXPECTED: Record<string, Expected> = {
  'case-01': {
    rule: 'R3',
    document: 'YCR',
    reason: '104',
    quantity: 2,
    amount: 540,
    approver: 'credit_manager',
    status: 'awaiting_approval',
    optionA: { rule: 'R1', document: 'YRE', reason: '102' },
  },
  'case-02': { rule: 'R4', document: 'NONE', reason: '', quantity: 0, amount: 0, approver: 'credit_manager', status: 'awaiting_approval' },
  'case-03': { rule: 'R5', document: 'YCR', reason: '103', quantity: 2, amount: 540, approver: 'credit_manager', status: 'awaiting_approval' },
  'case-04': { rule: 'R7', document: 'NONE', reason: '', quantity: 0, amount: 0, approver: '', status: 'needs_customer_input' },
  'case-05': { rule: 'R9', document: 'NONE', reason: '', quantity: 15, amount: 4050, approver: '', status: 'needs_customer_input' },
  'case-06': { rule: 'R8', document: 'NONE', reason: '', quantity: 0, amount: 0, approver: '', status: 'duplicate' },
  'case-07': { rule: 'R6', document: 'NONE', reason: '', quantity: 5, amount: 1350, approver: '', status: 'handed_over' },
  'case-08': { rule: 'R1', document: 'YRE', reason: '102', quantity: 3, amount: 810, approver: 'credit_manager', status: 'awaiting_approval' },
}
