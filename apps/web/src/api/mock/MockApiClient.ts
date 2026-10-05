import {
  addCustomerReply,
  approverFor,
  buildFixtureCases,
  buildSapPayload,
  computeAnalytics,
  EXPECTED,
  FIXTURES,
  findThreadCase,
  capQuantity,
  DEMO_INVOICES,
  primaryProposal,
  MANUAL_STATUSES,
  STATUS_LABELS,
  statusChangeBlocked,
  toSummary,
  type Role,
  type Case,
  type CaseSummary,
  type EvalResult,
  type Settings,
  type ReturnStatus,
} from '@reclaim/shared'
import {
  CONFLICT_MESSAGE,
  type ApiClient,
  type ApiEvent,
  type ApproveInput,
  type ApproveResult,
  type ChangeStatusInput,
  type RejectInput,
  type ReleaseInput,
  type ReleaseResult,
  type SendReplyResult,
} from '../client'
import { MockStore } from './store'
import { ev, uid } from './events'
import { runPipeline } from './pipeline'

const ROLE_RANK: Record<Role, number> = { customer_service_lead: 0, credit_manager: 1, finance_director: 2, returns_desk: -1 }

/**
 * The backend, in the browser. Same contract as the real one, realistic delays,
 * persisted in localStorage so a refresh during the demo keeps the state.
 */
export class MockApiClient implements ApiClient {
  private store = new MockStore()
  private listeners = new Set<(e: ApiEvent) => void>()
  private running = new Set<string>()
  private writing = new Set<string>()
  private fast: boolean

  constructor(opts: { fast?: boolean } = {}) {
    this.fast = !!opts.fast
    this.store.load()
  }

  private emit(e: ApiEvent) {
    this.listeners.forEach((l) => l(e))
  }

  private delay(ms: number) {
    return new Promise<void>((r) => setTimeout(r, this.fast ? 0 : ms))
  }

  private touch(id: string) {
    const c = this.store.cases.get(id)
    if (c) c.updatedAt = new Date().toISOString()
    this.store.save()
    this.emit({ type: 'case_changed', id })
  }

  private host() {
    return {
      delay: (ms: number) => this.delay(ms),
      touch: (id: string) => this.touch(id),
      cases: this.store.cases,
      aiMode: this.store.settings.aiMode,
      sapMode: this.store.settings.sapMode,
      setLastRun: (iso: string) => {
        this.store.lastRunAt = iso
      },
    }
  }

  private locate(proposalId: string) {
    for (const c of this.store.cases.values()) {
      const p = c.proposals.find((x) => x.id === proposalId)
      if (p) return { c, p }
    }
    throw Object.assign(new Error('Proposal not found'), { status: 404 })
  }

  async listCases(): Promise<CaseSummary[]> {
    return [...this.store.cases.values()]
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .map(toSummary)
  }

  async getCase(id: string): Promise<Case> {
    const c = this.store.cases.get(id)
    if (!c) throw Object.assign(new Error('Case not found'), { status: 404 })
    return structuredClone(c)
  }

  async seedCases() {
    for (const c of buildFixtureCases()) if (!this.store.cases.has(c.id)) this.store.cases.set(c.id, c)
    this.store.save()
    this.emit({ type: 'status_changed' })
  }

  async ingest(files: File[]): Promise<CaseSummary[]> {
    const out: CaseSummary[] = []
    for (const f of files) {
      const text = await readText(f)
      const fx = FIXTURES.find((x) => x.emailFile === f.name)
      const now = new Date().toISOString()
      const [head = '', ...rest] = text.split(/\r?\n\r?\n/)
      const header = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'mi').exec(head)?.[1]?.trim() ?? null
      const mail = {
        from: header('From') ?? 'unknown sender',
        subject: header('Subject') ?? f.name,
        text: rest.join('\n\n').trim(),
        receivedAt: now,
        attachments: [],
        messageId: header('Message-ID'),
        inReplyTo: header('In-Reply-To'),
        references: header('References')?.split(/\s+/) ?? [],
        sourceFile: f.name,
      }
      // An answer to an earlier email joins that case's conversation instead of opening a new one.
      const thread = fx ? undefined : findThreadCase([...this.store.cases.values()], mail)
      if (thread) {
        addCustomerReply(thread, mail, ev)
        thread.updatedAt = now
        this.emit({ type: 'case_changed', id: thread.id })
        out.push(toSummary(thread))
        continue
      }
      const id = fx && !this.store.cases.has(fx.id) ? fx.id : uid('case')
      const c: Case = fx
        ? { ...buildFixtureCases().find((x) => x.id === fx.id)!, id, createdAt: now, updatedAt: now }
        : {
            id,
            emailFile: f.name,
            receivedAt: now,
            from: mail.from,
            subject: mail.subject,
            bodyText: mail.text,
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
      if (!fx) ev(c, 'intake', 'Complaint received', { from: c.from, subject: c.subject, attachments: 0, messageId: mail.messageId, channel: 'file' }, '5.1.1')
      this.store.cases.set(id, c)
      out.push(toSummary(c))
    }
    this.store.save()
    this.emit({ type: 'status_changed' })
    return out
  }

  async runCase(id: string) {
    if (this.running.has(id)) return
    this.running.add(id)
    try {
      await runPipeline(this.host(), id)
    } finally {
      this.running.delete(id)
    }
  }

  async runAll() {
    const ordered = [...this.store.cases.values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    for (const c of ordered) if (c.status === 'received') await this.runCase(c.id)
  }

  async chooseProposal(proposalId: string) {
    const { c, p } = this.locate(proposalId)
    if (c.status !== 'awaiting_approval') throw Object.assign(new Error('This case is not awaiting approval.'), { status: 409 })
    c.proposals.forEach((x) => (x.chosen = x.id === proposalId))
    ev(c, 'approval', `Option ${p.option} chosen (${p.decision.ruleId}) by a person`, { proposalId }, null, null)
    this.touch(c.id)
  }

  async approve(proposalId: string, input: ApproveInput): Promise<ApproveResult> {
    const { c, p } = this.locate(proposalId)
    if (c.status !== 'awaiting_approval' || this.writing.has(c.id)) {
      return { ok: false, status: 409, message: 'This case is not awaiting approval.' }
    }
    this.writing.add(c.id)
    try {
      // 1. Work out what would be approved, without touching the proposal.
      const inv = c.findings?.invoice ?? null
      const invoiced = inv?.items[0]?.quantity ?? p.decision.quantity
      if (input.editedQuantity != null && !(input.editedQuantity > 0)) return { ok: false, status: 400, message: 'The quantity must be above 0.' }
      const qty = input.editedQuantity != null ? capQuantity(input.editedQuantity, invoiced) : p.decision.quantity
      // For a difference credit (R4) the unit price is the difference, not the invoice price.
      const unitPrice = p.decision.quantity ? p.decision.amount / p.decision.quantity : (inv?.items[0]?.unitPrice ?? 0)
      const edited = qty !== p.decision.quantity
      const amount = edited ? Math.round(qty * unitPrice * 100) / 100 : p.decision.amount
      const approverRole = edited && p.decision.documentType !== 'NONE' ? approverFor(amount, p.decision.ruleId) : p.decision.approverRole
      // 2. Every check before anything is saved.
      if (approverRole && ROLE_RANK[input.role] < ROLE_RANK[approverRole]) {
        return { ok: false, status: 403, message: `This credit needs the ${approverRole.replace(/_/g, ' ')}. Your role cannot approve it.` }
      }
      if (p.sapMode && p.sapMode !== this.store.settings.sapMode) {
        return { ok: false, status: 409, message: `This proposal was built with SAP mode "${p.sapMode}" but the system is now in "${this.store.settings.sapMode}". Re-run the case.` }
      }
      if (this.store.settings.sapMode === 'real' && DEMO_INVOICES.includes(c.invoiceNumber ?? '')) {
        return { ok: false, status: 400, message: `Invoice ${c.invoiceNumber} is hackathon demo data and must never be written to the real DS4. Switch SAP mode to Mock.` }
      }
      // 3. Save.
      if (edited) {
        p.decision = { ...p.decision, quantity: qty, amount, approverRole }
        p.sapPayload = inv && p.decision.documentType !== 'NONE' ? buildSapPayload(p.decision, inv, `COMPLAINT-${inv.number}`) : null
        ev(c, 'approval', `Quantity changed to ${qty} ${p.decision.unit ?? ''} by ${input.actor}; approver is ${approverRole}`, { quantity: qty, amount }, null, null)
      }
      c.proposals.forEach((x) => (x.chosen = x.id === proposalId))
      c.approvals.push({
        id: uid('appr'),
        proposalId,
        actor: input.actor,
        role: input.role,
        decision: 'approved',
        editedQuantity: input.editedQuantity != null ? qty : null,
        comment: input.comment ?? '',
        decidedAt: new Date().toISOString(),
      })
      c.status = 'approved'
      ev(
        c,
        'approval',
        `Approved by ${input.actor} (${input.role})`,
        { quantity: qty, amount: p.decision.amount, comment: input.comment ?? '' },
        null,
        null,
      )
      this.touch(c.id)

      if (p.decision.documentType === 'NONE' || !p.sapPayload) {
        await this.delay(300)
        c.status = 'closed'
        ev(c, 'status', 'Approved; no SAP document. The reply to the customer is ready to send', { replyDraft: p.replyDraft }, null, null)
        this.touch(c.id)
        return { ok: true, document: null }
      }

      await this.delay(600)
      const step = p.decision.documentType === 'YRE' ? '5.1.2' : '5.2.1'
      if (this.store.settings.simulateConflict) {
        c.status = 'sap_write_failed'
        ev(
          c,
          'error',
          'SAP refused the write: 412 Precondition Failed',
          { status: 412, message: CONFLICT_MESSAGE, ifMatch: inv?.etag },
          step,
          610,
        )
        this.touch(c.id)
        return { ok: false, status: 412, message: CONFLICT_MESSAGE }
      }
      const number = String(this.store.nextDoc++)
      const type = p.decision.documentType as 'YRE' | 'YCR'
      const doc = {
        id: uid('sap'),
        caseId: c.id,
        type,
        number,
        payload: p.sapPayload,
        response: {
          status: 201,
          [type === 'YRE' ? 'CustomerReturn' : 'CreditMemoRequest']: number,
          HeaderBillingBlockReason: '08',
        },
        createdAt: new Date().toISOString(),
        released: false,
      }
      c.sapDocuments.push(doc)
      c.status = 'written_to_sap'
      ev(
        c,
        'sap_write',
        `${type} ${number} created with billing block 08`,
        { payload: p.sapPayload, response: doc.response, ifMatch: inv?.etag },
        step,
        610,
      )
      this.touch(c.id)
      return { ok: true, document: doc }
    } finally {
      this.writing.delete(c.id)
    }
  }

  async sendReply(): Promise<SendReplyResult> {
    return { ok: false, status: 503, message: 'The in-browser mock sends no email. Copy the reply, or run the backend with mailbox credentials.' }
  }

  async reject(proposalId: string, input: RejectInput) {
    const { c, p } = this.locate(proposalId)
    if (c.status !== 'awaiting_approval' || this.writing.has(c.id)) throw Object.assign(new Error('This case is not awaiting approval.'), { status: 409 })
    const required = p.decision.approverRole ?? 'customer_service_lead'
    if (ROLE_RANK[input.role] < ROLE_RANK[required]) throw Object.assign(new Error(`Rejecting this claim needs the ${required.replace(/_/g, ' ')}. Your role cannot decide it.`), { status: 403 })
    if (input.comment.trim().length < 3) throw Object.assign(new Error('A reason is required to reject: it goes to the customer and into the audit trail.'), { status: 400 })
    c.approvals.push({
      id: uid('appr'),
      proposalId,
      actor: input.actor,
      role: input.role,
      decision: 'rejected',
      editedQuantity: null,
      comment: input.comment,
      decidedAt: new Date().toISOString(),
    })
    c.status = 'closed'
    ev(c, 'approval', `Rejected by ${input.actor}: ${input.comment}`, {}, null, null)
    this.touch(c.id)
  }

  async changeStatus(caseId: string, input: ChangeStatusInput) {
    const c = this.store.cases.get(caseId)
    if (!c) throw Object.assign(new Error('Case not found'), { status: 404 })
    if (this.writing.has(c.id)) throw Object.assign(new Error('The case is busy. Try again in a moment.'), { status: 409 })
    const blocked = statusChangeBlocked(c, input.to, input.role)
    if (blocked) throw Object.assign(new Error(blocked.message), { status: blocked.status })
    if (!input.comment.trim()) throw Object.assign(new Error('Say why the status changes.'), { status: 400 })
    const from = c.status
    c.status = input.to
    const label = MANUAL_STATUSES.find((m) => m.to === input.to)?.label ?? STATUS_LABELS[input.to]
    ev(c, 'status', `Set to ${label} by ${input.actor}: ${input.comment.trim()}`, { from, to: input.to, reopened: input.to !== 'closed', actor: input.actor, role: input.role, comment: input.comment.trim() }, null, null)
    this.touch(c.id)
  }

  async release(id: string, input: ReleaseInput): Promise<ReleaseResult> {
    for (const c of this.store.cases.values()) {
      const d = c.sapDocuments.find((x) => x.id === id)
      if (!d) continue
      const step = d.type === 'YRE' ? '5.1.3' : '5.2.1'
      if (d.released) return { ok: false, status: 409, message: `${d.type} ${d.number} is already released.` }
      const required = primaryProposal(c)?.decision.approverRole ?? 'credit_manager'
      if (ROLE_RANK[input.role] < ROLE_RANK[required]) return { ok: false, status: 403, message: `Releasing this credit needs the ${required.replace(/_/g, ' ')}.` }
      if (d.type === 'YRE' && !d.goodsReceivedAt) {
        return { ok: false, status: 409, message: 'A return is credited only after the warehouse has received the goods (step 5.1.3). The Returns desk confirms the receipt; then the credit can be released.' }
      }
      await this.delay(500)
      if (this.store.settings.sapMode === 'real' && DEMO_INVOICES.includes(c.invoiceNumber ?? '')) {
        return { ok: false, status: 400, message: `Invoice ${c.invoiceNumber} is hackathon demo data and must never be written to the real DS4.` }
      }
      if (this.store.settings.simulateConflict) {
        ev(c, 'error', 'SAP refused the release: 412 Precondition Failed', { status: 412, message: CONFLICT_MESSAGE }, step, 500)
        this.touch(c.id)
        return { ok: false, status: 412, message: CONFLICT_MESSAGE }
      }
      d.released = true
      const goodsReceipt = d.type === 'YRE' ? 'confirmed by the Returns desk' : 'not required'
      ev(c, 'sap_release', `Billing block removed on ${d.type} ${d.number} by ${input.actor} (${input.role})${d.type === 'YRE' ? '; goods receipt confirmed by the Returns desk' : ''}`, { HeaderBillingBlockReason: '', goodsReceipt, warehouseStatus: null, goodsReceivedBy: d.goodsReceivedBy ?? null, goodsReceivedAt: d.goodsReceivedAt ?? null }, step, 500)
      this.touch(c.id)
      return { ok: true, document: d }
    }
    throw Object.assign(new Error('Document not found'), { status: 404 })
  }

  /** Step 5.1.3 by hand: only the Returns desk, once, for an unreleased return. */
  async confirmGoodsReceipt(id: string, input: ReleaseInput): Promise<ReleaseResult> {
    for (const c of this.store.cases.values()) {
      const d = c.sapDocuments.find((x) => x.id === id)
      if (!d) continue
      if (d.type !== 'YRE') return { ok: false, status: 400, message: `${d.type} ${d.number} is a credit memo request; there are no goods to receive.` }
      if (d.released) return { ok: false, status: 409, message: `${d.type} ${d.number} is already released.` }
      if (d.goodsReceivedAt) return { ok: false, status: 409, message: `The goods receipt for ${d.number} was already confirmed by ${d.goodsReceivedBy}.` }
      if (input.role !== 'returns_desk') return { ok: false, status: 403, message: 'Only the Returns desk confirms the goods receipt (step 5.1.3). The approver releases the credit afterwards.' }
      d.goodsReceivedAt = new Date().toISOString()
      d.goodsReceivedBy = input.actor
      ev(c, 'goods_receipt', `Goods receipt confirmed for ${d.type} ${d.number} by ${input.actor} (Returns desk)`, { number: d.number, actor: input.actor, role: input.role }, '5.1.3', null)
      this.touch(c.id)
      return { ok: true, document: d }
    }
    throw Object.assign(new Error('Document not found'), { status: 404 })
  }

  /** The in-browser mock has no warehouse: the receipt is always unknown and is confirmed by the Returns desk. */
  async getReturnStatus(id: string): Promise<ReturnStatus> {
    for (const c of this.store.cases.values()) {
      const d = c.sapDocuments.find((x) => x.id === id)
      if (!d) continue
      return { documentId: id, type: d.type, status: d.type === 'YRE' ? 'UNKNOWN' : 'not applicable', received: d.type !== 'YRE', source: 'none', checkedAt: new Date().toISOString() }
    }
    throw Object.assign(new Error('Document not found'), { status: 404 })
  }

  async getAnalytics() {
    return computeAnalytics([...this.store.cases.values()], this.store.evalResults)
  }

  async runEval(): Promise<EvalResult[]> {
    const results: EvalResult[] = []
    for (const [id, e] of Object.entries(EXPECTED)) {
      const c = this.store.cases.get(id)
      if (!c) continue
      if (!c.proposals.length) await this.runCase(id)
      const k = this.store.cases.get(id)!
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
          pass:
            !!a &&
            a.decision.ruleId === e.optionA.rule &&
            a.decision.documentType === e.optionA.document &&
            a.decision.reasonCode === e.optionA.reason,
        })
      }
      results.push({ caseId: id, emailFile: k.emailFile ?? id, fields, pass: fields.every((f) => f.pass) })
    }
    this.store.evalResults = results
    this.store.save()
    this.emit({ type: 'status_changed' })
    return results
  }

  async getLatestEval() {
    return this.store.evalResults
  }

  async getStatus() {
    const cases = [...this.store.cases.values()]
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

  async getSettings(): Promise<Settings> {
    return { ...this.store.settings }
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    if (patch.sapMode === 'real') {
      throw Object.assign(
        new Error('This is the in-browser mock: it has no SAP connection. Run the backend (apps/api) with GATEWAY_URL and start the frontend with VITE_API_MODE=http to use DS4.'),
        { status: 400 },
      )
    }
    this.store.settings = { ...this.store.settings, ...patch }
    this.store.save()
    this.emit({ type: 'status_changed' })
    return { ...this.store.settings }
  }

  async reset() {
    this.store.clear()
    this.emit({ type: 'status_changed' })
  }

  subscribe(l: (e: ApiEvent) => void) {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }

  /** Test hook: direct access to the store. */
  _store() {
    return this.store
  }
}

/** FileReader rather than Blob.text(): the same in browsers and in jsdom, where Blob.text() is missing. */
function readText(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(r.error)
    r.readAsText(f)
  })
}
