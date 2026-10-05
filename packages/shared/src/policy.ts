import type { ApproverRole, DocumentType, L4Step, ReasonCode, RuleId } from './enums'

export interface RuleDef {
  id: RuleId
  situation: string
  decision: string
  documentType: DocumentType
  reasonCode: ReasonCode | null
  policyText: string
}

/** The returns policy from mock-data/reference/returns-policy.md, rules R1 to R9. */
export const RULES: Record<RuleId, RuleDef> = {
  R1: {
    id: 'R1',
    situation: 'Goods damaged in transit, customer can return them',
    decision: 'Return the damaged quantity; credit after the goods are received',
    documentType: 'YRE',
    reasonCode: '102',
    policyText:
      'R1 — Goods damaged in transit, customer can return them: return the damaged quantity; credit after the goods are received. Customer return (YRE), order reason 102.',
  },
  R2: {
    id: 'R2',
    situation: 'Poor quality / defective, customer can return them',
    decision: 'Return; credit after receipt',
    documentType: 'YRE',
    reasonCode: '101',
    policyText:
      'R2 — Poor quality or defective, customer can return them: return; credit after receipt. Customer return (YRE), order reason 101.',
  },
  R3: {
    id: 'R3',
    situation: 'Goods ruined, cannot be returned (leaked, contaminated, destroyed)',
    decision: 'Credit only, with photo evidence',
    documentType: 'YCR',
    reasonCode: '104',
    policyText:
      'R3 — Goods ruined, cannot be returned (leaked, contaminated, destroyed): credit only, with photo evidence. Credit memo request (YCR), order reason 104.',
  },
  R4: {
    id: 'R4',
    situation: 'Price higher than agreed',
    decision: 'Credit the difference only, after checking the agreed price (PR00)',
    documentType: 'YCR',
    reasonCode: '101',
    policyText:
      'R4 — Price higher than agreed: credit the difference only, after checking the agreed price (PR00). If the invoiced price equals the agreed price there is no credit; the agent drafts a reply that shows the agreed price.',
  },
  R5: {
    id: 'R5',
    situation: 'Short delivery (less arrived than invoiced)',
    decision: 'Credit the missing quantity; ask the warehouse to check proof of delivery',
    documentType: 'YCR',
    reasonCode: '103',
    policyText:
      'R5 — Short delivery (less arrived than invoiced): credit the missing quantity; ask the warehouse to check proof of delivery. Credit memo request (YCR), order reason 103.',
  },
  R6: {
    id: 'R6',
    situation: 'Customer asks for a replacement',
    decision: 'Do not create a credit; hand over to customer service for a free re-delivery',
    documentType: 'NONE',
    reasonCode: null,
    policyText:
      'R6 — Customer asks for a replacement: do not create a credit; hand over to customer service for a free re-delivery.',
  },
  R7: {
    id: 'R7',
    situation: 'Claimed quantity or amount exceeds the invoice',
    decision: 'Refuse; ask the customer to correct',
    documentType: 'NONE',
    reasonCode: null,
    policyText: 'R7 — Claimed quantity or amount exceeds the invoice: refuse; ask the customer to correct.',
  },
  R8: {
    id: 'R8',
    situation: 'Same complaint already handled',
    decision: 'Do not create a second document; answer with the existing number',
    documentType: 'NONE',
    reasonCode: null,
    policyText:
      'R8 — Same complaint already handled (a return or credit exists for the invoice): do not create a second document; answer with the existing number.',
  },
  R9: {
    id: 'R9',
    situation: 'Invoice not named',
    decision:
      'Search the customer’s invoices for material and date; propose the match; ask the customer to confirm',
    documentType: 'NONE',
    reasonCode: null,
    policyText:
      'R9 — Invoice not named: search the customer’s invoices for material and date; propose the match; ask the customer to confirm. No document until confirmed.',
  },
  NONE: {
    id: 'NONE',
    situation: 'No rule applies',
    decision: 'Ask a person to decide and consider extending the policy',
    documentType: 'NONE',
    reasonCode: null,
    policyText: 'No rule in the returns policy matches this complaint.',
  },
}

export const REASON_CODES: Record<ReasonCode, string> = {
  '101': 'Poor quality',
  '102': 'Damaged in transit',
  '103': 'Quantity discrepancy',
  '104': 'Material ruined',
  '105': 'Free-of-charge sample',
}

export const APPROVAL_THRESHOLDS: { upTo: number; role: ApproverRole }[] = [
  { upTo: 500, role: 'customer_service_lead' },
  { upTo: 5000, role: 'credit_manager' },
  { upTo: Infinity, role: 'finance_director' },
]

/** Credits where no goods come back: credit manager at least, whatever the value. */
export const NO_GOODS_BACK_RULES: RuleId[] = ['R3', 'R4', 'R5']

const ROLE_RANK: Record<ApproverRole, number> = {
  customer_service_lead: 0,
  credit_manager: 1,
  finance_director: 2,
}

export function approverFor(amount: number, ruleId: RuleId): ApproverRole {
  const byValue = APPROVAL_THRESHOLDS.find((t) => amount <= t.upTo)!.role
  if (NO_GOODS_BACK_RULES.includes(ruleId) && ROLE_RANK[byValue] < ROLE_RANK.credit_manager) {
    return 'credit_manager'
  }
  return byValue
}

/** A quantity can never exceed what was invoiced, and never be negative. */
export function capQuantity(claimed: number, invoiced: number): number {
  return Math.max(0, Math.min(claimed, invoiced))
}

export const L4_STEPS: Record<L4Step, { name: string; decides: string }> = {
  '5.1.1': { name: 'Check whether a return is needed', decides: 'Agent proposes; person approves' },
  '5.1.2': { name: 'Create the return order (YRE)', decides: 'Returns desk' },
  '5.1.3': { name: 'Release the return and confirm goods received', decides: 'Warehouse' },
  '5.2.1': { name: 'Create the credit memo request (YCR)', decides: 'Credit approver' },
  '5.2.2': { name: 'Flag the intercompany credit', decides: 'Billing / finance' },
}

export const BILLING_BLOCK = '08'

/** Mock invoices from the hackathon folder. Never to be posted to a real SAP system. */
/**
 * Team 8's own DS4 invoices (HACK-T08, customer 10021, material 54, 270 EUR/KG, billed 29 Sep 2026). These are the only
 * invoices a real write may target. Quantities in KG: 373:5, 374:12, 375:20, 376:8, 377:15, 378:30, 379:10, 380:25,
 * 381:6, 382:18, 383:5, 384:12, 385:20, 386:8, 387:15.
 */
export const TEAM_INVOICES = Array.from({ length: 15 }, (_, i) => String(90000373 + i))

export const DEMO_INVOICES = [
  '90000353',
  '90000354',
  '90000355',
  '90000356',
  '90000357',
  '90000358',
  '90000359',
]
