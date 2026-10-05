import {
  approverFor,
  buildFixtureCases,
  buildSapPayload,
  capQuantity,
  DEMO_INVOICES,
  EXPECTED,
  FIXTURES,
  HISTORY_TOTALS,
  HISTORY_WEEKS,
  primaryProposal,
  toSummary,
  type AgentStatus,
  type AnalyticsSummary,
  type Case,
  type CaseSummary,
  type EvalResult,
  type Role,
  type SapDocument,
  type Settings,
} from '@reclaim/shared'
import type { Gateway } from './gateway/types'
import type { Ai } from './ai/types'
import { Store } from './store'
import { EventHub, ev, uid } from './events'
import { runPipeline } from './pipeline'

const ROLE_RANK: Record<Role, number> = { customer_service_lead: 0, credit_manager: 1, finance_director: 2, returns_desk: -1 }

export interface ApproveInput {
  actor: string
  role: Role
  editedQuantity?: number
  comment?: string
}
export interface RejectInput {
  actor: string
  role: Role
  comment: string
}
export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; message: string }

export interface ServiceDeps {
  store: Store
  gateway: (settings: Settings) => Gateway
  ai: (settings: Settings) => Ai
  hub: EventHub
  readAttachment: (url: string) => Promise<{ mimeType: string; base64: string } | null>
  /** Called on demo reset so stateful mocks forget what they created. */
  onReset?: () => void
}

/**
 * The application: everything the routes do, with no HTTP in it. Tested directly in test/acceptance.test.ts.
 * Mirrors apps/web/src/api/mock/MockApiClient.ts on purpose: the frontend mock is the behavioural spec.
 */
export class Service {
  private running = new Set<string>()
  private writing = new Set<string>()
  constructor(private deps: ServiceDeps) {}

  private get store() {
    return this.deps.store
  }

  private touch(id: string) {
    const c = this.store.cases.get(id)
    if (c) c.updatedAt = new Date().toISOString()
    this.deps.hub.emit({ type: 'case_changed', id })
  }

  listCases(): CaseSummary[] {
    return this.store.list().map(toSummary)
  }

  getCase(id: string): Case {
    return structuredClone(this.store.get(id))
  }

  seed() {
    for (const c of buildFixtureCases()) if (!this.store.cases.has(c.id)) this.store.cases.set(c.id, c)
    this.deps.hub.emit({ type: 'status_changed' })
  }

  /** Create cases from raw .eml text. Known demo emails map to their fixture; anything else is a fresh case. */
  ingest(files: { name: string; text: string }[]): CaseSummary[] {
    const out: CaseSummary[] = []
    for (const f of files) {
      const fx = FIXTURES.find((x) => x.emailFile === f.name)
      const now = new Date().toISOString()
      const id = fx && !this.store.cases.has(fx.id) ? fx.id : uid('case')
      const c: Case = fx
        ? { ...buildFixtureCases().find((x) => x.id === fx.id)!, id, createdAt: now, updatedAt: now }
        : {
            id,
            emailFile: f.name,
            receivedAt: parseDate(f.text) ?? now,
            from: header(f.text, 'From') ?? 'unknown sender',
            subject: decodeSubject(header(f.text, 'Subject') ?? f.name),
            bodyText: body(f.text),
            attachments: [],
            status: 'received',
            customer: '10021',
            customerName: 'Cust DE 1',
            invoiceNumber: null,
            complaintType: 'unknown',
            aiMode: this.store.settings.aiMode,
            facts: null,
            findings: null,
            proposals: [],
            approvals: [],
            sapDocuments: [],
            events: [],
            anomalies: [],
            createdAt: now,
            updatedAt: now,
          }
      this.store.cases.set(id, c)
      out.push(toSummary(c))
    }
    this.deps.hub.emit({ type: 'status_changed' })
    return out
  }

  async runCase(id: string) {
    if (this.running.has(id)) return
    this.running.add(id)
    try {
      await runPipeline(
        { store: this.store, gateway: this.deps.gateway(this.store.settings), ai: this.deps.ai(this.store.settings), touch: (i) => this.touch(i), readAttachment: this.deps.readAttachment },
        id,
      )
    } catch (e) {
      const c = this.store.cases.get(id)
      if (c && c.status === 'investigating') {
        c.status = 'received'
        ev(c, 'error', `Run failed: ${(e as Error).message}`, { status: (e as { status?: number }).status ?? 500 }, null, null)
        this.touch(id)
      }
      throw e
    } finally {
      this.running.delete(id)
    }
  }

  async runAll() {
    for (const c of this.store.list()) if (c.status === 'received') await this.runCase(c.id)
  }

  chooseProposal(proposalId: string) {
    const { c, p } = this.store.locateProposal(proposalId)
    if (c.status !== 'awaiting_approval') throw Object.assign(new Error('This case is not awaiting approval.'), { status: 409 })
    c.proposals.forEach((x) => (x.chosen = x.id === proposalId))
    ev(c, 'approval', `Option ${p.option} chosen (${p.decision.ruleId}) by a person`, { proposalId }, null, null)
    this.touch(c.id)
  }

  /** The only path that writes to SAP. Sends the approved payload unchanged. */
  async approve(proposalId: string, input: ApproveInput): Promise<Outcome<SapDocument | null>> {
    const { c, p } = this.store.locateProposal(proposalId)
    if (c.status !== 'awaiting_approval' || this.writing.has(c.id)) return { ok: false, status: 409, message: 'This case is not awaiting approval.' }
    this.writing.add(c.id)
    try {
      const inv = c.findings?.invoice ?? null
      const invoiced = inv?.items[0]?.quantity ?? p.decision.quantity
      const qty = input.editedQuantity != null ? capQuantity(input.editedQuantity, invoiced) : p.decision.quantity
      const unitPrice = p.decision.quantity ? p.decision.amount / p.decision.quantity : (inv?.items[0]?.unitPrice ?? 0)
      if (qty !== p.decision.quantity) {
        const amount = Math.round(qty * unitPrice * 100) / 100
        p.decision = { ...p.decision, quantity: qty, amount, approverRole: approverFor(amount, p.decision.ruleId) }
        p.sapPayload = inv && p.decision.documentType !== 'NONE' ? buildSapPayload(p.decision, inv, `COMPLAINT-${inv.number}`) : null
        ev(c, 'approval', `Quantity changed to ${qty} ${p.decision.unit ?? ''} by ${input.actor}; approver is now ${p.decision.approverRole}`, { quantity: qty, amount }, null, null)
        this.touch(c.id)
      }
      if (p.decision.approverRole && ROLE_RANK[input.role] < ROLE_RANK[p.decision.approverRole]) {
        return { ok: false, status: 403, message: `This credit needs the ${p.decision.approverRole.replace(/_/g, ' ')}. Your role cannot approve it.` }
      }
      if (this.store.settings.sapMode === 'real' && DEMO_INVOICES.includes(c.invoiceNumber ?? '')) {
        return { ok: false, status: 400, message: `Invoice ${c.invoiceNumber} is hackathon demo data and must never be written to the real DS4. Switch SAP mode to Mock.` }
      }

      c.proposals.forEach((x) => (x.chosen = x.id === proposalId))
      c.approvals.push({ id: uid('appr'), proposalId, actor: input.actor, role: input.role, decision: 'approved', editedQuantity: input.editedQuantity != null ? qty : null, comment: input.comment ?? '', decidedAt: new Date().toISOString() })
      c.status = 'approved'
      ev(c, 'approval', `Approved by ${input.actor} (${input.role})`, { quantity: qty, amount: p.decision.amount, comment: input.comment ?? '' }, null, null)
      this.touch(c.id)

      if (p.decision.documentType === 'NONE' || !p.sapPayload) {
        c.status = 'closed'
        ev(c, 'status', 'Reply sent to the customer; no SAP document', { replyDraft: p.replyDraft }, null, null)
        this.touch(c.id)
        return { ok: true, value: null }
      }

      const type = p.decision.documentType as 'YRE' | 'YCR'
      const step = type === 'YRE' ? '5.1.2' : '5.2.1'
      const gw = this.deps.gateway(this.store.settings)
      const t = Date.now()
      const r = type === 'YRE' ? await gw.createReturn(p.sapPayload) : await gw.createCreditMemoRequest(p.sapPayload)
      if (!r.ok) {
        c.status = 'sap_write_failed'
        ev(c, 'error', r.status === 412 ? 'SAP refused the write: 412 Precondition Failed' : `SAP refused the write: ${r.status}`, { status: r.status, message: r.message, ifMatch: inv?.etag }, step, Date.now() - t)
        this.touch(c.id)
        return { ok: false, status: r.status, message: r.message }
      }
      const doc: SapDocument = { id: uid('sap'), caseId: c.id, type, number: r.number, payload: p.sapPayload, response: r.response, createdAt: new Date().toISOString(), released: false }
      c.sapDocuments.push(doc)
      c.status = 'written_to_sap'
      ev(c, 'sap_write', `${type} ${r.number} created with billing block 08`, { payload: p.sapPayload, response: r.response, ifMatch: inv?.etag }, step, Date.now() - t)
      this.touch(c.id)
      return { ok: true, value: doc }
    } finally {
      this.writing.delete(c.id)
    }
  }

  reject(proposalId: string, input: RejectInput) {
    const { c } = this.store.locateProposal(proposalId)
    if (c.status !== 'awaiting_approval' || this.writing.has(c.id)) throw Object.assign(new Error('This case is not awaiting approval.'), { status: 409 })
    c.approvals.push({ id: uid('appr'), proposalId, actor: input.actor, role: input.role, decision: 'rejected', editedQuantity: null, comment: input.comment, decidedAt: new Date().toISOString() })
    c.status = 'rejected'
    ev(c, 'approval', `Rejected by ${input.actor}: ${input.comment}`, {}, null, null)
    this.touch(c.id)
  }

  async release(documentId: string): Promise<Outcome<SapDocument>> {
    const { c, d } = this.store.locateDocument(documentId)
    const step = d.type === 'YRE' ? '5.1.3' : '5.2.1'
    if (this.store.settings.sapMode === 'real' && DEMO_INVOICES.includes(c.invoiceNumber ?? '')) {
      return { ok: false, status: 400, message: `Invoice ${c.invoiceNumber} is hackathon demo data and must never be written to the real DS4.` }
    }
    const t = Date.now()
    const r = await this.deps.gateway(this.store.settings).release({ type: d.type, number: d.number, etag: c.findings?.invoice?.etag ?? '' })
    if (!r.ok) {
      ev(c, 'error', r.status === 412 ? 'SAP refused the release: 412 Precondition Failed' : `SAP refused the release: ${r.status}`, { status: r.status, message: r.message }, step, Date.now() - t)
      this.touch(c.id)
      return { ok: false, status: r.status, message: r.message }
    }
    d.released = true
    ev(c, 'sap_release', `Billing block removed on ${d.type} ${d.number}`, { HeaderBillingBlockReason: '' }, step, Date.now() - t)
    this.touch(c.id)
    return { ok: true, value: d }
  }

  async runEval(): Promise<EvalResult[]> {
    const results: EvalResult[] = []
    for (const [id, e] of Object.entries(EXPECTED)) {
      const c = this.store.cases.get(id)
      if (!c) continue
      if (!c.proposals.length) await this.runCase(id)
      const k = this.store.get(id)
      const p = primaryProposal(k)
      if (!p) {
        results.push({ caseId: id, emailFile: k.emailFile ?? id, fields: [{ name: 'rule', expected: e.rule, actual: 'still running', pass: false }], pass: false })
        continue
      }
      const rows: [string, string, string][] = [
        ['rule', e.rule, p.decision.ruleId],
        ['document', e.document, p.decision.documentType],
        ['reason', e.reason, p.decision.reasonCode ?? ''],
        ['quantity', String(e.quantity), String(p.decision.quantity)],
        ['amount', e.amount.toFixed(2), p.decision.amount.toFixed(2)],
        ['approver', e.approver, p.decision.approverRole ?? ''],
      ]
      const fields = rows.map(([name, expected, actual]) => ({ name, expected, actual, pass: expected === actual }))
      if (e.optionA) {
        const a = k.proposals.find((x) => x.option === 'A')
        fields.push({
          name: 'option A',
          expected: `${e.optionA.rule}/${e.optionA.document}/${e.optionA.reason}`,
          actual: a ? `${a.decision.ruleId}/${a.decision.documentType}/${a.decision.reasonCode}` : 'missing',
          pass: !!a && a.decision.ruleId === e.optionA.rule && a.decision.documentType === e.optionA.document && a.decision.reasonCode === e.optionA.reason,
        })
      }
      results.push({ caseId: id, emailFile: k.emailFile ?? id, fields, pass: fields.every((f) => f.pass) })
    }
    this.store.evalResults = results
    this.deps.hub.emit({ type: 'status_changed' })
    return results
  }

  analytics(): AnalyticsSummary {
    const cases = this.store.list()
    const byStatus: Record<string, number> = {}
    const byType: Record<string, number> = {}
    for (const c of cases) {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1
      byType[c.complaintType] = (byType[c.complaintType] ?? 0) + 1
    }
    const amountOf = (c: Case) => primaryProposal(c)?.decision.amount ?? 0
    const approvedLive = cases.filter((c) => ['written_to_sap', 'approved', 'closed'].includes(c.status)).reduce((s, c) => s + amountOf(c), 0)
    const rejectedLive = cases.filter((c) => c.status === 'rejected').reduce((s, c) => s + amountOf(c), 0)
    const count = (w: (typeof HISTORY_WEEKS)[number]) => w.damaged + w.ruined + w.quality + w.price + w.short_delivery + w.other
    return {
      casesThisMonth: cases.length + HISTORY_WEEKS.slice(-4).reduce((s, w) => s + count(w), 0),
      pendingApprovals: byStatus['awaiting_approval'] ?? 0,
      approvedValue: approvedLive + HISTORY_WEEKS.reduce((s, w) => s + w.approvedValue, 0),
      rejectedValue: rejectedLive + HISTORY_WEEKS.reduce((s, w) => s + w.rejectedValue, 0),
      medianHoursToApproval: HISTORY_TOTALS.medianHoursToApproval,
      acceptedUnchangedRatio: HISTORY_TOTALS.acceptedUnchanged,
      duplicatesPrevented: HISTORY_TOTALS.duplicatesPrevented + (byStatus['duplicate'] ?? 0),
      intercompanyFlagged: HISTORY_TOTALS.intercompanyFlagged + cases.filter((c) => c.proposals.some((p) => p.decision.intercompany)).length,
      byStatus,
      byType,
      weeks: HISTORY_WEEKS,
      currency: 'EUR',
    }
  }

  status(): AgentStatus {
    const cases = this.store.list()
    return {
      name: 'Reclaim · Returns & Credit Note',
      agentId: 'o2c-agent-8',
      cases: cases.length,
      pending: cases.filter((c) => c.status === 'awaiting_approval').length,
      lastRunAt: this.store.lastRunAt,
      sapMode: this.store.settings.sapMode,
      aiMode: this.store.settings.aiMode,
    }
  }

  getSettings(): Settings {
    return { ...this.store.settings }
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.store.settings = { ...this.store.settings, ...patch }
    this.deps.hub.emit({ type: 'status_changed' })
    return { ...this.store.settings }
  }

  reset() {
    this.store.reset()
    this.deps.onReset?.()
    this.deps.hub.emit({ type: 'status_changed' })
  }
}

function header(text: string, name: string): string | undefined {
  return new RegExp(`^${name}:\\s*(.+)$`, 'mi').exec(text)?.[1]?.trim()
}
function body(text: string): string {
  const parts = text.split(/\r?\n\r?\n/)
  return parts.slice(1).join('\n\n').replace(/=\r?\n/g, '').replace(/=E2=80=93/g, '–').trim()
}
function decodeSubject(s: string): string {
  return s.replace(/=\?utf-8\?b\?([^?]+)\?=/gi, (_, b64: string) => Buffer.from(b64, 'base64').toString('utf8'))
}
function parseDate(text: string): string | undefined {
  const d = header(text, 'Date')
  const t = d ? Date.parse(d) : NaN
  return Number.isNaN(t) ? undefined : new Date(t).toISOString()
}
