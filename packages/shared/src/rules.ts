import type { Decision, Facts, Findings, InvoiceSnapshot } from './schemas'
import { approverFor, capQuantity, RULES } from './policy'
import type { RuleId } from './enums'

export interface DecideContext {
  /** Id of another case in our own system that is already handling this invoice, if any. */
  openCaseOnInvoice: string | null
}

export interface DecideResult {
  options: Decision[]
  recommendedIndex: number
}

function base(
  ruleId: RuleId,
  inv: InvoiceSnapshot | null,
  qty: number,
  amount: number,
  extra: Partial<Decision> = {},
): Decision {
  const rule = RULES[ruleId]
  const item = inv?.items[0]
  const approver = rule.documentType === 'NONE' ? null : approverFor(amount, ruleId)
  return {
    ruleId,
    documentType: rule.documentType,
    reasonCode: rule.reasonCode,
    material: item?.material ?? null,
    quantity: qty,
    unit: item?.unit ?? null,
    amount,
    currency: inv?.currency ?? 'EUR',
    approverRole: approver,
    intercompany: false,
    requiresCustomerConfirmation: false,
    notes: '',
    ...extra,
  }
}

const one = (d: Decision): DecideResult => ({ options: [d], recommendedIndex: 0 })

/**
 * The returns policy as code. Pure: facts + findings in, one or two decisions out.
 * The model never calls this; it only explains the result.
 */
export function decide(facts: Facts, findings: Findings, ctx: DecideContext): DecideResult {
  const inv = findings.invoice

  // R9: no invoice named. Propose the candidate, nothing is created until the customer confirms.
  if (!facts.invoiceNumber) {
    const cand = findings.candidateInvoices[0]
    if (!cand) {
      return one(
        base('NONE', null, 0, 0, {
          approverRole: 'customer_service_lead',
        notes: 'No invoice named and no candidate invoice found for this customer and material.',
        }),
      )
    }
    const ci = cand.items[0]!
    const qty = capQuantity(facts.claimedQuantity ?? ci.quantity, ci.quantity)
    return one(
      base('R9', cand, qty, Math.round(qty * ci.unitPrice * 100) / 100, {
        requiresCustomerConfirmation: true,
        notes: `Likely match: invoice ${cand.number} (${ci.quantity} ${ci.unit} of ${ci.material}, ${cand.date}). Ask the customer to confirm before creating anything.`,
      }),
    )
  }

  if (!inv) {
    return one(
      base('NONE', null, 0, 0, {
        approverRole: 'customer_service_lead',
        notes: `Invoice ${facts.invoiceNumber} was not found in SAP.`,
      }),
    )
  }

  const item = inv.items[0]!
  const intercompany = !!findings.plantCompanyCode && findings.plantCompanyCode !== inv.companyCode

  // R8: already handled, in SAP or in our own queue.
  const existing = findings.existingReturns[0] ?? findings.existingCredits[0]
  if (existing || ctx.openCaseOnInvoice) {
    return one(
      base('R8', inv, 0, 0, {
        intercompany,
        notes: existing
          ? `A ${existing.type} ${existing.number} already exists for invoice ${inv.number}.`
          : `Complaint for invoice ${inv.number} is already in progress (${ctx.openCaseOnInvoice}); no document created yet.`,
      }),
    )
  }

  const claimed = facts.claimedQuantity ?? item.quantity

  // R7: more than invoiced. Checked before anything else that could create work.
  if (claimed > item.quantity) {
    return one(
      base('R7', inv, 0, 0, {
        intercompany,
        notes: `Claimed ${claimed} ${item.unit} but invoice ${inv.number} is for ${item.quantity} ${item.unit}.`,
      }),
    )
  }

  // R6: replacement wanted, not money.
  if (facts.wantsReplacement) {
    const q = capQuantity(claimed, item.quantity)
    return one(
      base('R6', inv, q, Math.round(q * item.unitPrice * 100) / 100, {
        intercompany,
        notes: 'Customer asks for a replacement delivery. Handed over to customer service; no credit.',
      }),
    )
  }

  const qty = capQuantity(claimed, item.quantity)

  // R4: price complaint, judged against the agreed PR00 price.
  if (facts.complaintType === 'price') {
    const agreed = findings.agreedUnitPrice ?? item.unitPrice
    if (agreed >= item.unitPrice) {
      return one(
        base('R4', inv, 0, 0, {
          documentType: 'NONE',
          reasonCode: null,
          intercompany,
          approverRole: 'credit_manager',
          notes: `Agreed price (PR00) is ${agreed.toFixed(2)} ${inv.currency}/${item.unit}, invoiced ${item.unitPrice.toFixed(2)}. The claim of ${facts.claimedUnitPrice ?? '?'} is not supported by SAP data. No credit unless a person confirms a special agreement.`,
        }),
      )
    }
    const diff = Math.round((item.unitPrice - agreed) * qty * 100) / 100
    return one(
      base('R4', inv, qty, diff, {
        intercompany,
        notes: `Invoiced ${item.unitPrice.toFixed(2)} vs agreed ${agreed.toFixed(2)} per ${item.unit}: credit the difference.`,
      }),
    )
  }

  const amount = Math.round(qty * item.unitPrice * 100) / 100

  if (facts.complaintType === 'short_delivery') {
    return one(base('R5', inv, qty, amount, { intercompany, notes: 'Ask the warehouse to check proof of delivery.' }))
  }

  // R1 or R3: damaged goods. Whether they can come back is a judgement call: offer both, recommend one.
  if (facts.complaintType === 'damaged') {
    const a = base('R1', inv, qty, amount, { intercompany })
    const b = base('R3', inv, qty, amount, { intercompany, notes: 'Credit only; photo evidence required.' })
    return { options: [a, b], recommendedIndex: facts.goodsReturnable === false ? 1 : 0 }
  }

  if (facts.complaintType === 'ruined') {
    return one(base('R3', inv, qty, amount, { intercompany, notes: 'Credit only; photo evidence required.' }))
  }

  if (facts.complaintType === 'quality') {
    return one(base('R2', inv, qty, amount, { intercompany }))
  }

  // Policy gap: say so instead of forcing a match.
  return one(
    base('NONE', inv, 0, 0, {
      intercompany,
      approverRole: 'customer_service_lead',
      notes: 'No rule in the policy matches this complaint. A person must decide; consider extending the policy.',
    }),
  )
}
