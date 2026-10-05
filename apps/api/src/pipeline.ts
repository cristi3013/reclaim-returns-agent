import { buildSapPayload, decide, keptOnRerun, preferItem, rankCandidates, type CaseStatus, type Findings, type Proposal } from '@reclaim/shared'
import type { Gateway } from './gateway/types'
import type { Ai } from './ai/types'
import type { Store } from './store'
import { ev, uid } from './events'

const TERMINAL_OR_IDLE: CaseStatus[] = ['received', 'closed', 'duplicate', 'needs_customer_input', 'handed_over']
/** A case may be (re)run only from these. Never from approved/written/closed, and never while being written. */
const RUNNABLE: CaseStatus[] = ['received', 'awaiting_approval', 'needs_customer_input', 'handed_over', 'duplicate', 'sap_write_failed']

export interface PipelineDeps {
  store: Store
  gateway: Gateway
  ai: Ai
  /** Called after every visible step so the SSE hub can notify the UI. */
  touch: (id: string) => void
  /** Reads an attachment for the model. Returns null when the file is not available. */
  readAttachment: (url: string) => Promise<{ mimeType: string; base64: string } | null>
  /** True while service.approve is writing this case to SAP. */
  isWriting: (id: string) => boolean
}

/**
 * One case through: extract → investigate → decide → explain → propose.
 * Nothing here writes to SAP. The write happens in service.approve, after a person decided.
 */
export async function runPipeline(deps: PipelineDeps, id: string): Promise<void> {
  const { store, gateway, ai, touch } = deps
  const c = store.get(id)
  if (c.status === 'investigating') return
  if (c.sapDocuments.length) {
    throw Object.assign(new Error('This case already has a SAP document. Re-running it could create a second one.'), { status: 409 })
  }
  if (!RUNNABLE.includes(c.status) || deps.isWriting(id)) {
    throw Object.assign(new Error(`A case in status "${c.status.replace(/_/g, ' ')}" cannot be re-run.`), { status: 409 })
  }
  const assisted = store.settings.aiMode === 'assisted'

  c.status = 'investigating'
  c.aiMode = store.settings.aiMode
  c.proposals = []
  c.events = c.events.filter(keptOnRerun)
  c.facts = null
  c.findings = null
  c.anomalies = []
  if (!c.events.length) ev(c, 'intake', 'Complaint received', { from: c.from, subject: c.subject, attachments: c.attachments.length }, '5.1.1')
  touch(id)

  // 1 · extract
  const t0 = Date.now()
  const attachments = (await Promise.all(c.attachments.map((a) => deps.readAttachment(a.url)))).filter((x): x is { mimeType: string; base64: string } => !!x)
  const extracted = await ai.extractFacts(c, attachments)
  const facts = extracted.facts
  c.facts = facts
  c.complaintType = facts.complaintType
  c.invoiceNumber = facts.invoiceNumber
  ev(
    c,
    assisted ? 'model' : 'rule',
    assisted ? `Facts extracted from the email${attachments.length ? ' and the photo' : ''}` : 'Facts extracted by pattern rules',
    { facts, source: ai.name, usage: extracted.usage },
    '5.1.1',
    Date.now() - t0,
  )
  touch(id)

  // 2 · investigate
  const findings: Findings = { invoice: null, candidateInvoices: [], existingReturns: [], existingCredits: [], agreedUnitPrice: null, plantCompanyCode: null, lookups: [] }
  /** `optional` lookups record the failure and let the rules decide with what is known; the others abort the run. */
  const lookup = async (name: string, args: Record<string, unknown>, fn: () => Promise<Record<string, unknown>>, optional = false) => {
    const t = Date.now()
    try {
      const result = await fn()
      const d = Date.now() - t
      findings.lookups.push({ name, args, durationMs: d, ok: true })
      ev(c, 'lookup', name, { args, result }, '5.1.1', d)
    } catch (e) {
      const d = Date.now() - t
      findings.lookups.push({ name, args, durationMs: d, ok: false })
      ev(c, 'error', `${name} failed: ${(e as Error).message}`, { args, status: (e as { status?: number }).status ?? 500, optional }, '5.1.1', d)
      if (!optional) throw e
    }
    touch(id)
  }

  if (facts.invoiceNumber) {
    const n = facts.invoiceNumber
    await lookup('getInvoice', { invoiceNumber: n }, async () => {
      const raw = await gateway.getInvoice(n)
      findings.invoice = raw ? preferItem(raw, facts.material) : null
      const i = findings.invoice
      if (i) {
        // The invoice is the source of truth for who the customer is.
        c.customer = i.customer
        c.customerName = i.customerName
      }
      return i ? { number: i.number, quantity: i.items[0]?.quantity, netAmount: i.totalNetAmount, order: i.items[0]?.salesOrder, delivery: i.items[0]?.delivery, etag: i.etag } : { found: false }
    })
  } else if (facts.material && c.customer) {
    const args = { customer: c.customer, material: facts.material, dateFrom: daysAgo(c.receivedAt, 21), dateTo: c.receivedAt.slice(0, 10) }
    await lookup('findInvoices', args, async () => {
      const found = (await gateway.findInvoices(args)).map((i) => preferItem(i, facts.material))
      findings.candidateInvoices = rankCandidates(found, facts, c.receivedAt)
      return { found: found.length, candidates: findings.candidateInvoices.map((i) => `${i.number} (${i.items[0]?.quantity} ${i.items[0]?.unit}, ${i.date})`) }
    }, true)
  } else {
    ev(c, 'lookup', 'findInvoices skipped: no invoice number and no material to search with', {}, '5.1.1', 0)
  }

  const inv = findings.invoice ?? findings.candidateInvoices[0] ?? null
  if (inv) {
    await lookup('checkExistingCredits', { invoiceNumber: inv.number }, async () => {
      const r = await gateway.checkExistingCredits(inv.number)
      findings.existingReturns = r.existingReturns
      findings.existingCredits = r.existingCredits
      return { returns: r.existingReturns.map((d) => d.number), credits: r.existingCredits.map((d) => d.number) }
    })
    if (facts.complaintType === 'price') {
      const args = { customer: inv.customer, material: inv.items[0]?.material ?? '', salesOrg: inv.salesOrg, channel: inv.distributionChannel }
      await lookup('getAgreedPrice', { ...args, conditionType: 'PR00' }, async () => {
        findings.agreedUnitPrice = await gateway.getAgreedPrice(args)
        return { conditionType: 'PR00', unitPrice: findings.agreedUnitPrice }
      }, true)
    }
    const plant = inv.items[0]?.plant
    if (plant) {
      await lookup('plantCompanyCode', { plant }, async () => {
        findings.plantCompanyCode = await gateway.getPlantCompanyCode(plant)
        return { plantCompanyCode: findings.plantCompanyCode }
      }, true)
    }
  }
  c.findings = findings

  // anomalies from our own history
  const sameCustomer = store.list().filter((o) => o.id !== c.id && o.customer === c.customer && o.status !== 'received').length
  if (sameCustomer >= 3) c.anomalies.push(`${sameCustomer + 1} complaints from this customer this month`)
  if (inv && (facts.claimedQuantity ?? 0) * (inv.items[0]?.unitPrice ?? 0) > 3000) c.anomalies.push('Claimed value above 3 000 EUR, unusually high for this material')

  // 3 · decide (code, never the model)
  const openCase = store.list().find((o) => o.id !== c.id && o.invoiceNumber === inv?.number && !TERMINAL_OR_IDLE.includes(o.status) && o.proposals.length > 0) ?? null
  const res = decide(facts, findings, { openCaseOnInvoice: openCase?.id ?? null })
  const top = res.options[res.recommendedIndex]!
  ev(c, 'rule', `Policy applied: ${res.options.map((o) => o.ruleId).join(' / ')}`, { options: res.options, recommendedIndex: res.recommendedIndex, engine: '@reclaim/shared decide()' }, top.documentType === 'YCR' ? '5.2.1' : '5.1.1', 1)
  if (res.options.some((o) => o.intercompany)) {
    ev(c, 'rule', 'Intercompany credit flagged for finance', { companyCode: inv?.companyCode, plantCompanyCode: findings.plantCompanyCode }, '5.2.2', 1)
  }
  if (top.ruleId === 'NONE') c.anomalies.push('Policy gap: no rule matched')
  touch(id)

  // 4 · explain and propose
  const existingDocNumber = (findings.existingReturns[0] ?? findings.existingCredits[0])?.number
  const t1 = Date.now()
  c.proposals = []
  const narrateUsage: NonNullable<Awaited<ReturnType<Ai['narrate']>>['usage']>[] = []
  for (let i = 0; i < res.options.length; i++) {
    const d = res.options[i]!
    const narrated = await ai.narrate(d, facts, findings, { existingDocNumber, openCaseId: openCase?.id })
    const n = narrated.narrative
    if (narrated.usage) narrateUsage.push(narrated.usage)
    const p: Proposal = {
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
      sapMode: store.settings.sapMode,
    }
    c.proposals.push(p)
  }
  if (assisted) ev(c, 'model', 'Explanation, customer reply and approver briefing drafted', { groundedOn: c.proposals[0]?.policyCitations.map((x) => x.ruleId), source: ai.name, usage: narrateUsage }, '5.1.1', Date.now() - t1)
  ev(c, 'proposal', res.options.length > 1 ? 'Two options proposed; a person chooses' : `Proposal: ${top.ruleId}, ${top.documentType === 'NONE' ? 'no document' : top.documentType}`, { proposalIds: c.proposals.map((p) => p.id) }, '5.1.1', null)
  c.status = 'proposed'
  touch(id)

  const next: CaseStatus =
    top.ruleId === 'R6' ? 'handed_over' : top.ruleId === 'R7' || top.ruleId === 'R9' ? 'needs_customer_input' : top.ruleId === 'R8' ? 'duplicate' : 'awaiting_approval'
  c.status = next
  ev(c, 'status', `Status: ${next.replace(/_/g, ' ')}`, { approverRole: top.approverRole }, null, null)
  store.lastRunAt = new Date().toISOString()
  touch(id)
}

function daysAgo(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() - days * 86400000).toISOString().slice(0, 10)
}
