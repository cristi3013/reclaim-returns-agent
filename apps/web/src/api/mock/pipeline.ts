import {
  buildSapPayload,
  decide,
  narrate,
  type AiMode,
  type Case,
  type CaseStatus,
  type EventKind,
  type Facts,
  type Findings,
  type Proposal,
} from '@reclaim/shared'
import { FIXTURES } from './fixtures/cases'
import { AGREED_PRICE, INVOICES, PLANT_COMPANY } from './fixtures/invoices'
import { ev, uid } from './events'

export interface PipelineHost {
  delay(ms: number): Promise<void>
  touch(id: string): void
  cases: Map<string, Case>
  aiMode: AiMode
  setLastRun(iso: string): void
}

const TERMINAL_OR_IDLE: CaseStatus[] = [
  'received',
  'rejected',
  'closed',
  'duplicate',
  'needs_customer_input',
  'handed_over',
]

/** Rules-only extraction: no model, just patterns. Enough for the demo emails, honest about its limits. */
export function regexFacts(c: Case): Facts {
  const text = `${c.subject}\n${c.bodyText}`
  const inv = text.match(/\b(9000\d{4})\b/)?.[1] ?? null
  const qty = c.bodyText.match(/(\d+(?:[.,]\d+)?)\s*KG/i)
  const t = c.bodyText.toLowerCase()
  const wantsReplacement = /replace/i.test(c.bodyText) && /do not want a credit/i.test(c.bodyText)
  const type: Facts['complaintType'] = /^re:/i.test(c.subject)
    ? 'follow_up'
    : wantsReplacement
      ? 'ruined'
      : t.includes('leak')
        ? 'damaged'
        : t.includes('crushed') || t.includes('damaged')
          ? 'damaged'
          : t.includes('only') && t.includes('arrived')
            ? 'short_delivery'
            : t.includes('price')
              ? 'price'
              : t.includes('quality') || t.includes('discolour') || t.includes('contaminat')
                ? 'quality'
                : 'unknown'
  const price = c.bodyText.match(/agreed price is (\d+(?:[.,]\d+)?)/i)
  return {
    invoiceNumber: inv,
    material: /material 54/i.test(c.bodyText) ? '54' : null,
    claimedQuantity: qty ? Number(qty[1]!.replace(',', '.')) : null,
    unit: 'KG',
    complaintType: type,
    claimedUnitPrice: price ? Number(price[1]!.replace(',', '.')) : null,
    wantsReplacement,
    goodsReturnable: t.includes('leak') ? false : t.includes('collected') ? true : null,
    evidence: 'extracted by pattern rules (rules-only mode)',
    language: 'en',
  }
}

function summarise(name: string, f: Findings): Record<string, unknown> {
  switch (name) {
    case 'getInvoice':
      return f.invoice
        ? {
            number: f.invoice.number,
            quantity: f.invoice.items[0]!.quantity,
            netAmount: f.invoice.totalNetAmount,
            order: f.invoice.items[0]!.salesOrder,
            delivery: f.invoice.items[0]!.delivery,
            etag: f.invoice.etag,
          }
        : { found: false }
    case 'findInvoices':
      return { candidates: f.candidateInvoices.map((i) => i.number) }
    case 'checkExistingCredits':
      return { returns: f.existingReturns.map((d) => d.number), credits: f.existingCredits.map((d) => d.number) }
    case 'getAgreedPrice':
      return { conditionType: 'PR00', unitPrice: f.agreedUnitPrice }
    default:
      return { plantCompanyCode: f.plantCompanyCode }
  }
}

/**
 * Runs one case through: extract, investigate, decide, explain, propose.
 * Mirrors what the real backend does; the rules engine and templates are the shared ones.
 */
export async function runPipeline(h: PipelineHost, id: string): Promise<void> {
  const c = h.cases.get(id)
  if (!c) throw Object.assign(new Error('Case not found'), { status: 404 })
  if (c.status === 'investigating') return
  if (c.sapDocuments.length) {
    throw Object.assign(new Error('This case already has a SAP document. Re-running it could create a second one.'), { status: 409 })
  }

  const fx = FIXTURES.find((f) => f.id === id || f.emailFile === c.emailFile)
  c.status = 'investigating'
  c.aiMode = h.aiMode
  c.proposals = []
  const KEEP: EventKind[] = ['intake', 'approval', 'sap_write', 'sap_release', 'error']
  c.events = c.events.filter((e) => KEEP.includes(e.kind))
  c.facts = null
  c.findings = null
  c.anomalies = []
  if (!c.events.length) {
    ev(c, 'intake', 'Complaint received', { from: c.from, subject: c.subject, attachments: c.attachments.length }, '5.1.1')
  }
  h.touch(id)

  // 1 · extract
  await h.delay(700)
  const assisted = h.aiMode === 'assisted'
  const facts: Facts = fx
    ? assisted
      ? fx.facts
      : {
          ...regexFacts(c),
          complaintType: fx.facts.complaintType,
          claimedQuantity: fx.facts.claimedQuantity,
          invoiceNumber: fx.facts.invoiceNumber,
          wantsReplacement: fx.facts.wantsReplacement,
          goodsReturnable: fx.facts.goodsReturnable,
        }
    : regexFacts(c)
  c.facts = facts
  c.complaintType = facts.complaintType
  c.invoiceNumber = facts.invoiceNumber
  ev(
    c,
    assisted ? 'model' : 'rule',
    assisted
      ? `Facts extracted from the email${c.attachments.length ? ' and the photo' : ''}`
      : 'Facts extracted by pattern rules',
    { facts, source: assisted ? 'claude (structured output)' : fx ? 'pattern rules, demo facts for the fixture email' : 'pattern rules' },
    '5.1.1',
    assisted ? 1340 : 3,
  )
  h.touch(id)

  // 2 · investigate
  const findings: Findings = {
    invoice: null,
    candidateInvoices: [],
    existingReturns: [],
    existingCredits: [],
    agreedUnitPrice: null,
    plantCompanyCode: null,
    lookups: [],
  }
  const lookup = async (name: string, args: Record<string, unknown>, fn: () => void, ms = 450) => {
    await h.delay(ms)
    fn()
    findings.lookups.push({ name, args, durationMs: ms, ok: true })
    ev(c, 'lookup', name, { args, result: summarise(name, findings) }, '5.1.1', ms)
    h.touch(id)
  }

  if (facts.invoiceNumber) {
    const n = facts.invoiceNumber
    await lookup('getInvoice', { invoiceNumber: n }, () => {
      findings.invoice = INVOICES[n] ?? null
    })
  } else {
    await lookup(
      'findInvoices',
      { customer: c.customer, material: facts.material, dateFrom: '2026-09-21', dateTo: '2026-10-05' },
      () => {
        findings.candidateInvoices = (fx?.candidateInvoices ?? []).map((n) => INVOICES[n]!).filter(Boolean)
      },
      620,
    )
  }

  const invNo = findings.invoice?.number ?? findings.candidateInvoices[0]?.number
  if (invNo) {
    await lookup('checkExistingCredits', { invoiceNumber: invNo }, () => {
      const docs = [...h.cases.values()]
        .filter((o) => o.id !== c.id)
        .flatMap((o) =>
          o.sapDocuments.filter((d) => {
            const ref = (d.payload as { ReferenceSDDocument?: string }).ReferenceSDDocument
            const itemRef = (d.payload as { to_Item?: { ReferenceSDDocument?: string }[] }).to_Item?.[0]
              ?.ReferenceSDDocument
            return ref === invNo || itemRef === invNo
          }),
        )
      const toExisting = (type: 'YRE' | 'YCR') =>
        docs
          .filter((d) => d.type === type)
          .map((d) => ({
            type,
            number: d.number,
            reasonCode: String((d.payload as { SDDocumentReason?: string }).SDDocumentReason ?? ''),
            amount: 0,
            billingBlock: d.released ? '' : '08',
          }))
      findings.existingReturns = [...(fx?.existingCredits.filter((d) => d.type === 'YRE') ?? []), ...toExisting('YRE')]
      findings.existingCredits = [...(fx?.existingCredits.filter((d) => d.type === 'YCR') ?? []), ...toExisting('YCR')]
    })
    if (facts.complaintType === 'price') {
      await lookup(
        'getAgreedPrice',
        { material: AGREED_PRICE.material, salesOrg: AGREED_PRICE.salesOrg, channel: AGREED_PRICE.channel, conditionType: 'PR00' },
        () => {
          findings.agreedUnitPrice = AGREED_PRICE.unitPrice
        },
        380,
      )
    }
    const plant = (findings.invoice ?? findings.candidateInvoices[0])?.items[0]?.plant
    if (plant) {
      await lookup('plantCompanyCode', { plant }, () => {
        findings.plantCompanyCode = PLANT_COMPANY[plant] ?? null
      }, 120)
    }
  }
  c.findings = findings

  // anomalies from our own history
  const sameCustomer = [...h.cases.values()].filter(
    (o) => o.id !== c.id && o.customer === c.customer && o.status !== 'received',
  ).length
  if (sameCustomer >= 3) c.anomalies.push(`${sameCustomer + 1} complaints from this customer this month`)
  const inv = findings.invoice ?? findings.candidateInvoices[0] ?? null
  if (inv && (facts.claimedQuantity ?? 0) * inv.items[0]!.unitPrice > 3000) {
    c.anomalies.push('Claimed value above 3 000 EUR, unusually high for this material')
  }

  // 3 · rules
  const openCase =
    [...h.cases.values()].find(
      (o) =>
        o.id !== c.id &&
        o.invoiceNumber === invNo &&
        !TERMINAL_OR_IDLE.includes(o.status) &&
        o.proposals.length > 0,
    ) ?? null
  const res = decide(facts, findings, { openCaseOnInvoice: openCase?.id ?? null })
  await h.delay(300)
  const top = res.options[res.recommendedIndex]!
  ev(
    c,
    'rule',
    `Policy applied: ${res.options.map((o) => o.ruleId).join(' / ')}`,
    { options: res.options, recommendedIndex: res.recommendedIndex, engine: '@reclaim/shared decide()' },
    top.documentType === 'YCR' ? '5.2.1' : '5.1.1',
    4,
  )
  if (res.options.some((o) => o.intercompany)) {
    ev(
      c,
      'rule',
      'Intercompany credit flagged for finance',
      { companyCode: findings.invoice?.companyCode, plantCompanyCode: findings.plantCompanyCode },
      '5.2.2',
      1,
    )
  }
  if (top.ruleId === 'NONE') c.anomalies.push('Policy gap: no rule matched')
  h.touch(id)

  // 4 · explain and propose
  const existingDocNumber = (findings.existingReturns[0] ?? findings.existingCredits[0])?.number
  if (assisted) await h.delay(900)
  c.proposals = res.options.map((d, i): Proposal => {
    const n = narrate(d, facts, findings, { existingDocNumber, openCaseId: openCase?.id })
    return {
      id: uid('prop'),
      caseId: c.id,
      option: res.options.length > 1 ? (i === 0 ? 'A' : 'B') : 'single',
      recommended: i === res.recommendedIndex,
      chosen: res.options.length === 1,
      decision: d,
      sapPayload: inv && d.documentType !== 'NONE' ? buildSapPayload(d, inv, `COMPLAINT-${inv.number}`) : null,
      explanation: n.explanation,
      policyCitations: n.citations,
      replyDraft: n.replyDraft,
      briefing: n.briefing,
      createdAt: new Date().toISOString(),
    }
  })
  if (assisted) {
    ev(
      c,
      'model',
      'Explanation, customer reply and approver briefing drafted',
      { groundedOn: c.proposals[0]!.policyCitations.map((x) => x.ruleId), model: 'claude (grounded on policy chunks + SAP facts)' },
      '5.1.1',
      880,
    )
  }
  ev(
    c,
    'proposal',
    res.options.length > 1
      ? 'Two options proposed; a person chooses'
      : `Proposal: ${top.ruleId}, ${top.documentType === 'NONE' ? 'no document' : top.documentType}`,
    { proposalIds: c.proposals.map((p) => p.id) },
    '5.1.1',
    null,
  )
  c.status = 'proposed'
  h.touch(id)
  await h.delay(250)

  const next: CaseStatus =
    top.ruleId === 'R6'
      ? 'handed_over'
      : top.ruleId === 'R7' || top.ruleId === 'R9'
        ? 'needs_customer_input'
        : top.ruleId === 'R8'
          ? 'duplicate'
          : 'awaiting_approval'
  c.status = next
  ev(c, 'status', `Status: ${next.replace(/_/g, ' ')}`, { approverRole: top.approverRole }, null, null)
  h.setLastRun(new Date().toISOString())
  h.touch(id)
}
