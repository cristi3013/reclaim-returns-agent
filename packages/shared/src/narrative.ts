import type { Briefing, Decision, Facts, Findings } from './schemas'
import { RULES, REASON_CODES } from './policy'
import { ROLE_LABELS, type RuleId } from './enums'

export interface Narrative {
  explanation: string
  replyDraft: string
  briefing: Briefing
  citations: { ruleId: RuleId; text: string }[]
}

export interface NarrateContext {
  existingDocNumber?: string
  openCaseId?: string
}

const money = (n: number, c: string) => `${n.toFixed(2)} ${c}`

/**
 * Template narrative used in rules-only mode and as the deterministic fallback.
 * In AI-assisted mode the model produces the same three outputs, grounded in the same facts.
 * Numbers in the UI always come from the decision object, never from this text.
 */
export function narrate(d: Decision, facts: Facts, f: Findings, ctx: NarrateContext = {}): Narrative {
  const inv = f.invoice ?? f.candidateInvoices[0] ?? null
  const item = inv?.items[0]
  const rule = RULES[d.ruleId]
  const docName =
    d.documentType === 'YRE'
      ? 'customer return (YRE)'
      : d.documentType === 'YCR'
        ? 'credit memo request (YCR)'
        : 'no SAP document'
  const citations = [{ ruleId: d.ruleId, text: rule.policyText }]
  const approver = d.approverRole ? ROLE_LABELS[d.approverRole] : 'a person'
  const ic = d.intercompany
    ? ` The invoice was issued by company ${inv?.companyCode} but the goods shipped from a ${f.plantCompanyCode} plant: an intercompany credit must be flagged for finance (step 5.2.2).`
    : ''
  const head = inv
    ? `Invoice ${inv.number} (${inv.date}) for customer ${inv.customerName} (${inv.customer}): ${item!.quantity} ${item!.unit} of material ${item!.material} at ${money(item!.unitPrice, inv.currency)} per ${item!.unit}, from order ${item!.salesOrder} and delivery ${item!.delivery}.`
    : 'No invoice number was named in the complaint.'
  const greeting = 'Dear customer,'
  const signoff = '\n\nKind regards,\nReturns desk'
  const reason = d.reasonCode ? `${d.reasonCode} (${REASON_CODES[d.reasonCode]})` : ''

  let explanation = ''
  let reply = ''
  let b: Briefing

  switch (d.ruleId) {
    case 'R1':
      explanation = `${head} The customer reports ${d.quantity} ${d.unit} damaged in transit and the goods can be collected. Rule R1 applies: take the damaged quantity back and credit after receipt. Proposed: ${docName}, reason ${reason}, ${d.quantity} ${d.unit}, value ${money(d.amount, d.currency)}, billing block 08 until ${approver} approves.${ic}`
      reply = `${greeting}\n\nThank you for reporting the damage on invoice ${inv?.number}. We are arranging the collection of the ${d.quantity} ${d.unit} affected and will credit ${money(d.amount, d.currency)} once the goods are received in our warehouse.${signoff}`
      b = {
        whatHappened: `${d.quantity} ${d.unit} of material ${d.material} damaged in transit on invoice ${inv?.number}.`,
        whatWePropose: `Return (YRE, reason ${d.reasonCode}) for ${d.quantity} ${d.unit}; credit ${money(d.amount, d.currency)} after receipt.`,
        risk: d.intercompany ? 'Intercompany credit must also be booked by finance.' : 'Low: credit only after goods are received.',
      }
      break
    case 'R2':
      explanation = `${head} The customer reports poor quality and can return the goods. Rule R2 applies: ${docName}, reason ${reason}, ${d.quantity} ${d.unit}, ${money(d.amount, d.currency)}, billing block 08 until ${approver} approves.${ic}`
      reply = `${greeting}\n\nThank you for your message about invoice ${inv?.number}. We will collect the ${d.quantity} ${d.unit} and credit ${money(d.amount, d.currency)} after receipt and inspection.${signoff}`
      b = {
        whatHappened: `Quality complaint on ${d.quantity} ${d.unit} of material ${d.material}, invoice ${inv?.number}.`,
        whatWePropose: `Return (YRE, reason 101); credit ${money(d.amount, d.currency)} after receipt.`,
        risk: 'Low: goods come back before any credit.',
      }
      break
    case 'R3':
      explanation = `${head} The goods are ruined (${facts.evidence || 'leaked'}) and cannot come back. Rule R3 applies: credit only, with photo evidence. Proposed: ${docName}, reason ${reason}, ${d.quantity} ${d.unit}, ${money(d.amount, d.currency)}, billing block 08 until ${approver} approves.${ic}`
      reply = `${greeting}\n\nThank you for the photo and the details on invoice ${inv?.number}. We are preparing a credit of ${money(d.amount, d.currency)} for the ${d.quantity} ${d.unit} lost. You will receive the credit note after approval.${signoff}`
      b = {
        whatHappened: `${d.quantity} ${d.unit} of material ${d.material} lost on invoice ${inv?.number}; photo attached.`,
        whatWePropose: `Credit memo request (YCR, reason 104) for ${money(d.amount, d.currency)}; no goods back.`,
        risk: 'Credit without goods returning: credit manager at least.',
      }
      break
    case 'R4': {
      const agreed = f.agreedUnitPrice ?? item?.unitPrice ?? 0
      if (d.documentType === 'NONE') {
        explanation = `${head} The customer claims an agreed price of ${facts.claimedUnitPrice ?? '?'} ${d.currency} per ${item?.unit}. The agreed price on file (PR00, ${inv?.salesOrg}/${inv?.distributionChannel}, material ${item?.material}) is ${money(agreed, d.currency)} per ${item?.unit}, the same as invoiced. Rule R4: the claim is not supported by SAP data. No credit unless a person confirms a special agreement outside SAP.`
        reply = `${greeting}\n\nThank you for your message about invoice ${inv?.number}. Our records show an agreed price of ${money(agreed, d.currency)} per ${item?.unit} for material ${item?.material}, which is the price invoiced. If you hold a written agreement for a different price, please send it and we will review it.${signoff}`
        b = {
          whatHappened: `Price complaint on invoice ${inv?.number}: customer claims ${facts.claimedUnitPrice ?? '?'} ${d.currency} per ${item?.unit}.`,
          whatWePropose: 'No credit: invoiced price equals the agreed PR00 price. Send the reply with the evidence.',
          risk: 'A special agreement may exist outside SAP; confirm before replying.',
        }
      } else {
        explanation = `${head} ${d.notes} Rule R4: credit the difference, ${money(d.amount, d.currency)}, via ${docName}, billing block 08 until ${approver} approves.`
        reply = `${greeting}\n\nYou are right: invoice ${inv?.number} used a higher price than agreed. A credit of ${money(d.amount, d.currency)} is being prepared.${signoff}`
        b = {
          whatHappened: `Invoice ${inv?.number} priced above the agreed PR00 price.`,
          whatWePropose: `Credit the difference, ${money(d.amount, d.currency)}.`,
          risk: 'Credit without goods back: credit manager at least.',
        }
      }
      break
    }
    case 'R5':
      explanation = `${head} Only ${(item?.quantity ?? 0) - d.quantity} ${d.unit} arrived. Rule R5: credit the missing ${d.quantity} ${d.unit} (${money(d.amount, d.currency)}) via ${docName}, reason ${reason}, and ask the warehouse to check proof of delivery. Billing block 08 until ${approver} approves.${ic}`
      reply = `${greeting}\n\nThank you for reporting the short delivery on invoice ${inv?.number}. We are checking the proof of delivery and preparing a credit of ${money(d.amount, d.currency)} for the ${d.quantity} ${d.unit} missing.${signoff}`
      b = {
        whatHappened: `Short delivery on invoice ${inv?.number}: ${d.quantity} ${d.unit} missing.`,
        whatWePropose: `Credit memo request (YCR, reason 103) for ${money(d.amount, d.currency)}.`,
        risk: 'Credit without goods back; proof of delivery not yet checked.',
      }
      break
    case 'R6':
      explanation = `${head} The customer explicitly asks for a replacement, not a credit. Rule R6: no credit; hand over to customer service for a free re-delivery of ${d.quantity} ${d.unit} and collection of the bad goods.${ic}`
      reply = `${greeting}\n\nThank you for your message about invoice ${inv?.number}. Customer service will contact you to arrange a replacement delivery of ${d.quantity} ${d.unit} and the collection of the affected goods.${signoff}`
      b = {
        whatHappened: `Replacement requested for ${d.quantity} ${d.unit} on invoice ${inv?.number}.`,
        whatWePropose: 'Hand over to customer service for a free re-delivery. No SAP document.',
        risk: 'None for credit; delivery cost sits with customer service.',
      }
      break
    case 'R7':
      explanation = `${head} ${d.notes} Rule R7: refuse and ask the customer to correct the quantity. No document.`
      reply = `${greeting}\n\nThank you for your message. Invoice ${inv?.number} covers ${item?.quantity} ${item?.unit} of material ${item?.material}, so we cannot process a return of ${facts.claimedQuantity} ${item?.unit}. Please check the invoice number or the quantity and resend your request.${signoff}`
      b = {
        whatHappened: `Customer wants to return ${facts.claimedQuantity} ${item?.unit}; invoice ${inv?.number} is for ${item?.quantity} ${item?.unit}.`,
        whatWePropose: 'Refuse; ask the customer to correct.',
        risk: 'None.',
      }
      break
    case 'R8':
      explanation = `${head} ${d.notes} Rule R8: do not create a second document; answer with the existing reference.`
      reply = `${greeting}\n\nThank you for following up on invoice ${inv?.number}. Your complaint is already being processed${ctx.existingDocNumber ? ` under document ${ctx.existingDocNumber}` : ''} and you will be informed as soon as the credit is released.${signoff}`
      b = {
        whatHappened: `Follow-up on invoice ${inv?.number}.`,
        whatWePropose: ctx.existingDocNumber
          ? `Reply with existing document ${ctx.existingDocNumber}; create nothing.`
          : `Reply that the complaint is in progress (${ctx.openCaseId ?? 'open case'}); create nothing.`,
        risk: 'Duplicate credit prevented.',
      }
      break
    case 'R9':
      explanation = `The complaint names no invoice. Searching the customer's invoices for material ${d.material} in the last weeks found ${f.candidateInvoices.length} candidate(s). ${d.notes} Rule R9: propose the match and ask the customer to confirm; no document until confirmed. If confirmed, a customer return (YRE, reason 101) for ${d.quantity} ${d.unit} (${money(d.amount, d.currency)}) follows.`
      reply = `${greeting}\n\nThank you for your message about the material received last week. We believe it relates to invoice ${inv?.number} of ${inv?.date} (${item?.quantity} ${item?.unit} of material ${item?.material}). Please confirm, and we will arrange the collection and the credit.${signoff}`
      b = {
        whatHappened: `Quality complaint on ${d.quantity} ${d.unit} without an invoice number.`,
        whatWePropose: `Ask the customer to confirm invoice ${inv?.number}; then return (YRE, 101).`,
        risk: 'Wrong invoice if the customer does not confirm.',
      }
      break
    default:
      explanation = `${head} ${d.notes}`
      reply = `${greeting}\n\nThank you for your message. We are reviewing it and will come back to you shortly.${signoff}`
      b = {
        whatHappened: 'Complaint does not match any policy rule.',
        whatWePropose: 'A person decides; consider extending the policy.',
        risk: 'Policy gap.',
      }
  }
  return { explanation, replyDraft: reply, briefing: b, citations }
}
