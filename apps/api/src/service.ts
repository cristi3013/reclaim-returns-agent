import {
  addCustomerReply,
  approverFor,
  buildFixtureCases,
  buildSapPayload,
  capQuantity,
  DEMO_INVOICES,
  caseOutcome,
  computeAnalytics,
  currentReply,
  customerHistory,
  decisionReplyDue,
  EXPECTED,
  FIXTURES,
  findThreadCase,
  inboundMessage,
  latestCustomerMessageId,
  primaryProposal,
  replyGrounded,
  replyPrompt,
  REPLY_STATUSES,
  templateReply,
  type ReplyKind,
  type ReplySuggestion,
  RULES,
  MANUAL_STATUSES,
  STATUS_LABELS,
  statusChangeBlocked,
  threadMessageIds,
  toSummary,
  type AgentStatus,
  type Analytics,
  type Case,
  type CaseStatus,
  type CaseSummary,
  type EvalResult,
  type ReturnStatus,
  type Role,
  type SapDocument,
  type Settings,
} from '@reclaim/shared'
import type { Gateway } from './gateway/types'
import { versionStampOf } from './gateway/real'
import type { Ai } from './ai/types'
import { Store } from './store'
import { EventHub, ev, uid } from './events'
import { runPipeline } from './pipeline'
import type { InboundEmail } from './intake/mailbox'
import type { Mailer } from './intake/mailer'
import { createHash } from 'node:crypto'

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
export interface ChangeStatusInput {
  actor: string
  role: Role
  to: CaseStatus
  comment: string
}
export interface ReleaseInput {
  actor: string
  role: Role
}
export interface GoodsReceiptInput {
  actor: string
  role: Role
}
export interface SendReplyInput {
  actor: string
  role: Role
  /** The reply as the person edited it. Default: the proposal's draft. */
  text?: string
  /** 'decision' (default): the one reply after a person decided. 'message': any other email in the thread. */
  kind?: ReplyKind
  /** For a message: the email in the thread it answers (a conversation message id). It goes to that email's sender. */
  replyTo?: string
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
  /** Backend log line. */
  log?: (msg: string) => void
  /** Mailbox listener status for the UI, when one is configured. */
  mailboxStatus?: () => { address: string; connected: boolean; lastMessageAt: string | null; lastError: string | null } | null
  /** Sends the customer reply (SendGrid or SMTP). Without one, the UI offers copy to clipboard. */
  mailer?: Mailer | null
  /** Optional write-through persistence (Supabase). Never blocks a request. */
  persistence?: {
    saveCase: (c: Case) => void
    saveSettings: (s: Settings, lastRunAt: string | null) => void
    saveEval: (r: EvalResult[]) => void
    insertCase?: (c: Case) => Promise<boolean>
    deleteCase?: (id: string) => Promise<void>
    refresh?: (store: Store, busy: (id: string) => boolean) => Promise<{ changed: string[]; removed: string[] }>
  }
}

/**
 * The application: everything the routes do, with no HTTP in it. Tested directly in test/acceptance.test.ts.
 * Mirrors apps/web/src/api/mock/MockApiClient.ts on purpose: the frontend mock is the behavioural spec.
 */
export class Service {
  private running = new Set<string>()
  private writing = new Set<string>()
  private sending = new Set<string>()
  constructor(private deps: ServiceDeps) {}

  private get store() {
    return this.deps.store
  }

  private touch(id: string) {
    const c = this.store.cases.get(id)
    if (c) {
      c.updatedAt = new Date().toISOString()
      this.deps.persistence?.saveCase(c)
    }
    this.deps.hub.emit({ type: 'case_changed', id })
  }

  /** True while this instance is investigating or writing the case: another instance's copy must not replace it. */
  isBusy(id: string) {
    return this.running.has(id) || this.writing.has(id)
  }

  /** Pulls changes made by other instances sharing the database and tells the UI. */
  async syncFromPersistence() {
    if (!this.deps.persistence?.refresh) return
    const { changed, removed } = await this.deps.persistence.refresh(this.store, (id) => this.isBusy(id))
    const dropped = await this.dropStrayCopies(changed)
    for (const id of [...changed, ...removed, ...dropped]) this.deps.hub.emit({ type: 'case_changed', id })
    if (changed.length || removed.length || dropped.length) this.deps.hub.emit({ type: 'status_changed' })
  }

  /**
   * An instance running older code may have ingested the same email under a random id. Of two cases with the
   * same Message-ID, the one with the stable id (or, failing that, the older one) stays; the other is deleted.
   */
  private async dropStrayCopies(ids: string[]): Promise<string[]> {
    const dropped: string[] = []
    const messageIdOf = (c: Case) => c.events.find((e) => e.kind === 'intake')?.detail.messageId as string | undefined
    for (const id of ids) {
      const c = this.store.cases.get(id)
      const mid = c && messageIdOf(c)
      if (!c || !mid) continue
      const twins = this.store.list().filter((x) => x.id !== c.id && messageIdOf(x) === mid)
      for (const t of twins) {
        const keep = [c, t].find((x) => x.id === caseIdForMessage(mid)) ?? [c, t].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]!
        const stray = keep.id === c.id ? t : c
        if (this.isBusy(stray.id)) continue
        this.store.cases.delete(stray.id)
        await this.deps.persistence?.deleteCase?.(stray.id)
        dropped.push(stray.id)
      }
    }
    return dropped
  }

  listCases(): CaseSummary[] {
    return this.store.list().map(toSummary)
  }

  getCase(id: string): Case {
    return structuredClone(this.store.get(id))
  }

  seed() {
    for (const c of buildFixtureCases()) {
      if (this.store.cases.has(c.id)) continue
      this.store.cases.set(c.id, c)
      this.deps.persistence?.saveCase(c)
    }
    this.deps.hub.emit({ type: 'status_changed' })
  }

  /**
   * Creates a case from an email that arrived by mailbox or webhook, or, when the email answers an earlier one,
   * adds it to that case's conversation (see findThreadCase). Duplicate message ids are ignored.
   */
  async ingestInbound(mail: InboundEmail): Promise<CaseSummary | null> {
    if (mail.messageId) {
      const dup = this.store.list().find((c) => c.events.some((e) => e.kind === 'intake' && e.detail.messageId === mail.messageId))
      if (dup) return null
    }
    const fx = mail.sourceFile ? FIXTURES.find((x) => x.emailFile === mail.sourceFile) : undefined
    const thread = fx ? undefined : findThreadCase(this.store.list(), mail)
    if (thread) {
      const { reopened } = addCustomerReply(thread, mail, ev)
      this.touch(thread.id)
      if (reopened) this.deps.hub.emit({ type: 'status_changed' })
      return toSummary(thread)
    }
    const now = new Date().toISOString()
    // An email from the mailbox gets an id derived from its Message-ID, so every instance listening on the same
    // mailbox lands on the same case and the database decides who ingests it.
    const fromMailbox = !!mail.messageId && !mail.sourceFile
    const id = fx && !this.store.cases.has(fx.id) ? fx.id : fromMailbox ? caseIdForMessage(mail.messageId!) : uid('case')
    if (this.store.cases.has(id)) return null
    const base = fx ? buildFixtureCases().find((x) => x.id === fx.id)! : null
    const c: Case = base
      ? { ...base, id, createdAt: now, updatedAt: now }
      : {
          id,
          emailFile: mail.sourceFile,
          receivedAt: mail.receivedAt,
          from: mail.from,
          subject: mail.subject,
          bodyText: mail.text,
          attachments: mail.attachments,
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
    ev(c, 'intake', 'Complaint received', { from: c.from, subject: c.subject, attachments: c.attachments.length, messageId: mail.messageId, channel: mail.sourceFile ? 'file' : 'mailbox' }, '5.1.1')
    if (fromMailbox && this.deps.persistence?.insertCase) {
      if (!(await this.deps.persistence.insertCase(c))) return null
    } else {
      this.deps.persistence?.saveCase(c)
    }
    this.store.cases.set(id, c)
    this.deps.hub.emit({ type: 'status_changed' })
    this.deps.hub.emit({ type: 'case_changed', id })
    return toSummary(c)
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
        {
          store: this.store,
          gateway: this.deps.gateway(this.store.settings),
          ai: this.deps.ai(this.store.settings),
          touch: (i) => this.touch(i),
          readAttachment: this.deps.readAttachment,
          isWriting: (i) => this.writing.has(i),
        },
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
      // 1. Work out the decision that would be approved, without touching the proposal.
      const inv = c.findings?.invoice ?? null
      const invoiced = inv?.items[0]?.quantity ?? p.decision.quantity
      if (input.editedQuantity != null && !(input.editedQuantity > 0)) {
        return { ok: false, status: 400, message: 'The quantity must be above 0.' }
      }
      const qty = input.editedQuantity != null ? capQuantity(input.editedQuantity, invoiced) : p.decision.quantity
      const unitPrice = p.decision.quantity ? p.decision.amount / p.decision.quantity : (inv?.items[0]?.unitPrice ?? 0)
      const edited = qty !== p.decision.quantity
      const amount = edited ? Math.round(qty * unitPrice * 100) / 100 : p.decision.amount
      const approverRole = edited && p.decision.documentType !== 'NONE' ? approverFor(amount, p.decision.ruleId) : p.decision.approverRole
      const decision = edited ? { ...p.decision, quantity: qty, amount, approverRole } : p.decision

      // 2. Every check, before anything is saved.
      if (approverRole && ROLE_RANK[input.role] < ROLE_RANK[approverRole]) {
        return { ok: false, status: 403, message: `This credit needs the ${approverRole.replace(/_/g, ' ')}. Your role cannot approve it.` }
      }
      const gw = this.deps.gateway(this.store.settings)
      if (gw.live && DEMO_INVOICES.includes(c.invoiceNumber ?? '')) {
        return { ok: false, status: 400, message: `Invoice ${c.invoiceNumber} is hackathon demo data and is never written to DS4. Use one of the team's own invoices.` }
      }
      // Read again right before the write: the investigation may be hours old and someone else may have credited
      // the invoice since. A document that exists now sends the case back to the person with what was found.
      if (decision.documentType !== 'NONE' && c.invoiceNumber) {
        let found: Awaited<ReturnType<Gateway['checkExistingCredits']>>
        const t0 = Date.now()
        try {
          found = await gw.checkExistingCredits(c.invoiceNumber)
        } catch (e) {
          const err = e as Error & { status?: number }
          return { ok: false, status: err.status ?? 503, message: `Could not confirm that no credit exists yet for invoice ${c.invoiceNumber} (${err.message}). Nothing was written; try again.` }
        }
        const existing = [...found.existingReturns, ...found.existingCredits]
        if (c.findings) {
          c.findings.existingReturns = found.existingReturns
          c.findings.existingCredits = found.existingCredits
          c.findings.lookups.push({ name: 'checkExistingCredits', args: { invoiceNumber: c.invoiceNumber, when: 'before write' }, durationMs: Date.now() - t0, ok: true })
        }
        if (existing.length) {
          const list = existing.map((d) => `${d.type} ${d.number}`).join(', ')
          ev(c, 'error', `A document for invoice ${c.invoiceNumber} already exists in SAP (${list}); checked again right before writing. Nothing was written.`, { existing, checkedAt: new Date().toISOString() }, '5.1.1', Date.now() - t0)
          this.touch(c.id)
          return { ok: false, status: 409, message: `Invoice ${c.invoiceNumber} already has ${list} in SAP, created since this case was investigated. Nothing was written. Review the case; approving again would create a second credit (rule R8).` }
        }
      }

      // 3. Now save.
      if (edited) {
        p.decision = decision
        p.sapPayload = inv && decision.documentType !== 'NONE' ? buildSapPayload(decision, inv, `COMPLAINT-${inv.number}`) : null
        ev(c, 'approval', `Quantity changed to ${qty} ${decision.unit ?? ''} by ${input.actor}; approver is ${decision.approverRole}`, { quantity: qty, amount }, null, null)
      }
      c.proposals.forEach((x) => (x.chosen = x.id === proposalId))
      c.approvals.push({ id: uid('appr'), proposalId, actor: input.actor, role: input.role, decision: 'approved', editedQuantity: input.editedQuantity != null ? qty : null, comment: input.comment ?? '', decidedAt: new Date().toISOString() })
      c.status = 'approved'
      ev(c, 'approval', `Approved by ${input.actor} (${input.role})`, { quantity: qty, amount: p.decision.amount, comment: input.comment ?? '' }, null, null)
      this.touch(c.id)

      if (p.decision.documentType === 'NONE' || !p.sapPayload) {
        c.status = 'closed'
        ev(c, 'status', 'Approved; no SAP document. The reply to the customer is ready to send', { replyDraft: p.replyDraft }, null, null)
        this.touch(c.id)
        return { ok: true, value: null }
      }

      const type = p.decision.documentType as 'YRE' | 'YCR'
      const step = type === 'YRE' ? '5.1.2' : '5.2.1'
      // The gateway keeps its own approval record: log the request, mark it APPROVED, then write.
      // Its release refuses a credit memo whose request was not APPROVED there.
      const fail = (status: number, message: string, what: string) => {
        c.status = 'sap_write_failed'
        ev(c, 'error', `${what} failed (${status}); nothing was written to SAP`, { status, message }, step, null)
        this.touch(c.id)
        return { ok: false as const, status, message }
      }
      const evidenceUrl = c.attachments[0]?.url ?? null
      const log = await gw.logRequest({
        invoiceNumber: c.invoiceNumber ?? String(p.sapPayload.ReferenceSDDocument ?? ''),
        proposedAction: type === 'YRE' ? 'RETURN' : 'CREDIT',
        rule: p.decision.ruleId,
        reason: RULES[p.decision.ruleId].situation,
        claimedQuantity: c.facts?.claimedQuantity ?? null,
        claimedAmount: c.facts?.claimedQuantity != null && c.facts.claimedUnitPrice != null ? Math.round(c.facts.claimedQuantity * c.facts.claimedUnitPrice * 100) / 100 : null,
        creditValue: p.decision.amount,
        evidenceUrl,
      })
      if (!log.ok) return fail(log.status, log.message, 'Logging the request with the gateway')
      const set = await gw.setApprovalStatus({ id: log.id, status: 'APPROVED', approvedBy: input.actor, approverRole: input.role })
      if (!set.ok) return fail(set.status, set.message, 'Recording the approval with the gateway')
      ev(c, 'approval', `Approval recorded with the gateway (record ${log.id})`, { gatewayLogId: log.id, status: 'APPROVED', actor: input.actor, role: input.role }, step, null)

      const t = Date.now()
      const ctx = { rule: p.decision.ruleId, gatewayLogId: log.id, creditValue: p.decision.amount, evidenceUrl }
      const r = type === 'YRE' ? await gw.createReturn(p.sapPayload, ctx) : await gw.createCreditMemoRequest(p.sapPayload, ctx)
      if (!r.ok) {
        c.status = 'sap_write_failed'
        ev(c, 'error', r.status === 412 ? 'SAP refused the write: 412 Precondition Failed' : `SAP refused the write: ${r.status}`, { status: r.status, message: r.message, ifMatch: inv?.etag }, step, Date.now() - t)
        this.touch(c.id)
        return { ok: false, status: r.status, message: r.message }
      }
      const block = r.response.HeaderBillingBlockReason
      const blockConfirmed = block === undefined ? null : block === '08'
      const doc: SapDocument = { id: uid('sap'), caseId: c.id, type, number: r.number, payload: p.sapPayload, response: r.response, createdAt: new Date().toISOString(), released: false, etag: r.etag, gatewayLogId: log.id }
      c.sapDocuments.push(doc)
      c.status = 'written_to_sap'
      const customerReference = (r.response.PurchaseOrderByCustomer as string | undefined) ?? null
      ev(c, 'sap_write', `${type} ${r.number} created${blockConfirmed === false ? '' : ' with billing block 08'}${customerReference ? `, reference ${customerReference}` : ''}`, { payload: p.sapPayload, response: r.response, ifMatch: inv?.etag, blockConfirmed, customerReference, versionStamp: r.etag ?? null }, step, Date.now() - t)
      if (!r.etag) {
        ev(c, 'error', `${type} ${r.number} came back without a version stamp: it cannot be released from here until the gateway returns one. Check the document in SAP.`, { response: r.response }, step, null)
      }
      if (blockConfirmed === false) {
        ev(c, 'error', `${type} ${r.number} was created WITHOUT billing block 08. Do not release; check the document in SAP and inform the gateway owner.`, { HeaderBillingBlockReason: block }, step, null)
      }
      this.touch(c.id)
      return { ok: true, value: doc }
    } finally {
      this.writing.delete(c.id)
    }
  }

  /**
   * Emails the reply to the customer, in the thread of their complaint. Only for complaints that came in by email,
   * only after a person decided (approved or rejected), and only once. The text is the person's; the SAP reference
   * is added by code. A rejection needs the person's own text: the generated draft describes the refused credit.
   */
  async sendReply(caseId: string, input: SendReplyInput): Promise<Outcome<{ to: string; messageId: string }>> {
    const c = this.store.get(caseId)
    const mailer = this.deps.mailer
    if (!mailer) return { ok: false, status: 503, message: 'No outgoing email is configured (SENDGRID_API_KEY, or SMTP_*/IMAP_* credentials). Copy the reply instead.' }
    const intake = c.events.find((e) => e.kind === 'intake')
    if (intake?.detail.channel !== 'mailbox' || !c.from.includes('@')) {
      return { ok: false, status: 400, message: 'This complaint did not arrive by email, so there is no address to reply to. Copy the reply instead.' }
    }
    if (input.kind === 'message') return this.sendMessage(c, mailer, input)
    if (!(REPLY_STATUSES as readonly string[]).includes(c.status)) {
      return { ok: false, status: 409, message: 'A person has not decided this case yet. Approve it first, then send the reply.' }
    }
    if (currentReply(c.events)) {
      return { ok: false, status: 409, message: 'The reply to this complaint has already been sent.' }
    }
    if (this.sending.has(c.id)) return { ok: false, status: 409, message: 'The reply is being sent.' }
    const p = primaryProposal(c)
    const rejected = caseOutcome(c) === 'rejected'
    let text = (input.text ?? (rejected ? '' : p?.replyDraft) ?? '').trim()
    if (!text) return { ok: false, status: 400, message: rejected ? 'Write the reply that explains the rejection.' : 'The reply is empty.' }
    const doc = c.sapDocuments[c.sapDocuments.length - 1]
    if (doc && !text.includes(doc.number)) {
      text += `\n\nReference: ${doc.type === 'YRE' ? 'return order' : 'credit memo request'} ${doc.number}${c.invoiceNumber ? ` for invoice ${c.invoiceNumber}` : ''}.`
    }
    const subject = /^re:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`
    // Answer the customer's latest email, and carry the whole thread so their mail client keeps one conversation.
    const inReplyTo = latestCustomerMessageId(c)
    const references = threadMessageIds(c)
    this.sending.add(c.id)
    const t = Date.now()
    try {
      const r = await mailer.send({ to: c.from, subject, text, inReplyTo, references })
      ev(c, 'status', `Reply sent to ${c.from} by ${input.actor}`, { replySent: true, to: c.from, from: mailer.from, subject, text, messageId: r.messageId, inReplyTo, actor: input.actor, role: input.role }, null, Date.now() - t)
      this.touch(c.id)
      return { ok: true, value: { to: c.from, messageId: r.messageId } }
    } catch (e) {
      const message = (e as Error).message
      ev(c, 'error', `Sending the reply to ${c.from} failed; nothing was sent`, { message, actor: input.actor }, null, Date.now() - t)
      this.touch(c.id)
      return { ok: false, status: 502, message: `Sending the reply failed (${message}). Nothing was sent; copy the reply instead or try again.` }
    } finally {
      this.sending.delete(c.id)
    }
  }

  /**
   * A message to the customer in the thread, at any status and as often as needed: a question, an acknowledgement,
   * a follow-up. It is not the decision reply: no SAP reference is added, and the decision reply stays due.
   */
  private async sendMessage(c: Case, mailer: Mailer, input: SendReplyInput): Promise<Outcome<{ to: string; messageId: string }>> {
    const text = (input.text ?? '').trim()
    if (!text) return { ok: false, status: 400, message: 'The message is empty.' }
    // Only someone who wrote in this thread can be answered: the customer by default, or the sender of the chosen email.
    const target = input.replyTo ? inboundMessage(c, input.replyTo) : undefined
    if (input.replyTo && !target) return { ok: false, status: 400, message: 'That email is not in this case\'s thread.' }
    if (this.sending.has(c.id)) return { ok: false, status: 409, message: 'An email to this customer is being sent.' }
    const to = target?.from ?? c.from
    const about = target?.subject || c.subject
    const subject = /^re:/i.test(about) ? about : `Re: ${about}`
    const inReplyTo = target?.messageId ?? latestCustomerMessageId(c)
    const references = threadMessageIds(c)
    this.sending.add(c.id)
    const t = Date.now()
    try {
      const r = await mailer.send({ to, subject, text, inReplyTo, references })
      ev(c, 'status', `Message sent to ${to} by ${input.actor}`, { messageSent: true, to, from: mailer.from, subject, text, messageId: r.messageId, inReplyTo, replyTo: input.replyTo ?? null, actor: input.actor, role: input.role }, null, Date.now() - t)
      this.touch(c.id)
      return { ok: true, value: { to, messageId: r.messageId } }
    } catch (e) {
      const message = (e as Error).message
      ev(c, 'error', `Sending a message to ${to} failed; nothing was sent`, { message, actor: input.actor }, null, Date.now() - t)
      this.touch(c.id)
      return { ok: false, status: 502, message: `Sending the message failed (${message}). Nothing was sent; try again.` }
    } finally {
      this.sending.delete(c.id)
    }
  }

  /**
   * The suggested next email to the customer, from every email with them about the invoice. The facts come from
   * code; the model only words them, and wording with a number that is in none of the emails or facts is not used.
   */
  async suggestReply(caseId: string): Promise<ReplySuggestion> {
    const c = this.store.get(caseId)
    const kind: ReplyKind = decisionReplyDue(c) ? 'decision' : 'message'
    const history = customerHistory(c, [...this.store.cases.values()])
    const template = templateReply(c, history, kind)
    const ai = this.deps.ai(this.store.settings)
    if (!ai.suggestReply) return { text: template, kind, by: 'template', emails: history.length, note: null }
    try {
      const r = await ai.suggestReply(replyPrompt(c, history, kind))
      if (!r.text) return { text: template, kind, by: 'template', emails: history.length, note: r.fallback ?? null }
      if (!replyGrounded(r.text, c, history)) {
        return { text: template, kind, by: 'template', emails: history.length, note: 'The model wrote a number that is in none of the emails or facts; the standard wording is shown instead.' }
      }
      return { text: r.text, kind, by: 'model', emails: history.length, note: null }
    } catch (e) {
      return { text: template, kind, by: 'template', emails: history.length, note: `The model is not available (${(e as Error).message.slice(0, 100)}).` }
    }
  }

  /** Reopen a decided case, or close one that waits on nobody. Never touches SAP; the old decision stays in the trail. */
  changeStatus(caseId: string, input: ChangeStatusInput): Outcome<null> {
    const c = this.store.get(caseId)
    if (this.writing.has(c.id) || this.running.has(c.id)) return { ok: false, status: 409, message: 'The case is busy. Try again in a moment.' }
    const blocked = statusChangeBlocked(c, input.to, input.role)
    if (blocked) return { ok: false, ...blocked }
    if (!input.comment.trim()) return { ok: false, status: 400, message: 'Say why the status changes.' }
    const from = c.status
    c.status = input.to
    const label = MANUAL_STATUSES.find((m) => m.to === input.to)?.label ?? STATUS_LABELS[input.to]
    ev(c, 'status', `Set to ${label} by ${input.actor}: ${input.comment.trim()}`, { from, to: input.to, reopened: input.to !== 'closed', actor: input.actor, role: input.role, comment: input.comment.trim() }, null, null)
    this.touch(c.id)
    return { ok: true, value: null }
  }

  /** Rejecting a claim is a money decision too: same role as approving it, and a reason the customer and the audit trail can read. */
  reject(proposalId: string, input: RejectInput) {
    const { c, p } = this.store.locateProposal(proposalId)
    if (c.status !== 'awaiting_approval' || this.writing.has(c.id)) throw Object.assign(new Error('This case is not awaiting approval.'), { status: 409 })
    const required = p.decision.approverRole ?? 'customer_service_lead'
    if (ROLE_RANK[input.role] < ROLE_RANK[required]) throw Object.assign(new Error(`Rejecting this claim needs the ${required.replace(/_/g, ' ')}. Your role cannot decide it.`), { status: 403 })
    if (input.comment.trim().length < 3) throw Object.assign(new Error('A reason is required to reject: it goes to the customer and into the audit trail.'), { status: 400 })
    c.approvals.push({ id: uid('appr'), proposalId, actor: input.actor, role: input.role, decision: 'rejected', editedQuantity: null, comment: input.comment, decidedAt: new Date().toISOString() })
    c.status = 'closed'
    ev(c, 'approval', `Rejected by ${input.actor}: ${input.comment}`, {}, null, null)
    this.touch(c.id)
  }

  /**
   * Goods receipt of a return (step 5.1.3), asked from SAP when the gateway can answer. Without that function the
   * answer is "unknown" and the person confirms the receipt by hand.
   */
  async returnStatus(documentId: string): Promise<ReturnStatus> {
    const { d } = this.store.locateDocument(documentId)
    if (d.type !== 'YRE') return { documentId, type: d.type, status: 'not applicable', received: true, source: 'none', checkedAt: new Date().toISOString() }
    const gw = this.deps.gateway(this.store.settings)
    if (!gw.getReturnStatus) return { documentId, type: d.type, status: 'UNKNOWN', received: false, source: 'none', checkedAt: new Date().toISOString() }
    try {
      const s = await gw.getReturnStatus(d.number)
      return { documentId, type: d.type, status: s.status, received: s.received, source: 'sap', checkedAt: new Date().toISOString() }
    } catch (e) {
      return { documentId, type: d.type, status: `unavailable: ${(e as Error).message}`, received: false, source: 'none', checkedAt: new Date().toISOString() }
    }
  }

  /**
   * Step 5.1.3 by hand: the Returns desk confirms that the warehouse received the goods, under its own name.
   * Only the Returns desk may do it, so the person who confirms the goods is never the person who releases the money.
   */
  confirmGoodsReceipt(documentId: string, input: GoodsReceiptInput): Outcome<SapDocument> {
    const { c, d } = this.store.locateDocument(documentId)
    if (d.type !== 'YRE') return { ok: false, status: 400, message: `${d.type} ${d.number} is a credit memo request; there are no goods to receive.` }
    if (d.released) return { ok: false, status: 409, message: `${d.type} ${d.number} is already released.` }
    if (d.goodsReceivedAt) return { ok: false, status: 409, message: `The goods receipt for ${d.number} was already confirmed by ${d.goodsReceivedBy}.` }
    if (input.role !== 'returns_desk') return { ok: false, status: 403, message: 'Only the Returns desk confirms the goods receipt (step 5.1.3). The approver releases the credit afterwards.' }
    d.goodsReceivedAt = new Date().toISOString()
    d.goodsReceivedBy = input.actor
    ev(c, 'goods_receipt', `Goods receipt confirmed for ${d.type} ${d.number} by ${input.actor} (Returns desk)`, { number: d.number, actor: input.actor, role: input.role }, '5.1.3', null)
    this.touch(c.id)
    return { ok: true, value: d }
  }

  /** Removing billing block 08 is the credit decision itself: same role as the approval, once, and for a return only after the goods arrived. */
  async release(documentId: string, input: ReleaseInput): Promise<Outcome<SapDocument>> {
    const { c, d } = this.store.locateDocument(documentId)
    const step = d.type === 'YRE' ? '5.1.3' : '5.2.1'
    if (d.released) return { ok: false, status: 409, message: `${d.type} ${d.number} is already released.` }
    const required = primaryProposal(c)?.decision.approverRole ?? 'credit_manager'
    if (ROLE_RANK[input.role] < ROLE_RANK[required]) {
      return { ok: false, status: 403, message: `Releasing this credit needs the ${required.replace(/_/g, ' ')}.` }
    }
    const blockEvent = c.events.find((e) => e.kind === 'sap_write' && e.detail.blockConfirmed === false)
    if (blockEvent) return { ok: false, status: 409, message: `${d.type} ${d.number} was created without billing block 08; check it in SAP before anything else.` }
    // Step 5.1.3: SAP's word on the goods receipt first; the Returns desk's confirmation stands in where SAP has none.
    let goodsReceipt: 'not required' | 'confirmed by SAP' | 'confirmed by the Returns desk' = 'not required'
    let warehouse: ReturnStatus | null = null
    if (d.type === 'YRE') {
      warehouse = await this.returnStatus(documentId)
      if (warehouse.received && warehouse.source === 'sap') goodsReceipt = 'confirmed by SAP'
      else if (d.goodsReceivedAt) goodsReceipt = 'confirmed by the Returns desk'
      else {
        const why = warehouse.source === 'sap' ? `SAP reports the warehouse receipt status "${warehouse.status}": the goods have not been received.` : 'The goods receipt is not known to this system.'
        return { ok: false, status: 409, message: `A return is credited only after the warehouse has received the goods (step 5.1.3). ${why} The Returns desk confirms the receipt; then the credit can be released.` }
      }
    }
    if (this.deps.gateway(this.store.settings).live && DEMO_INVOICES.includes(c.invoiceNumber ?? '')) {
      return { ok: false, status: 400, message: `Invoice ${c.invoiceNumber} is hackathon demo data and is never written to DS4.` }
    }
    const t = Date.now()
    // Documents written before the stamp's live name was known carry it only inside the raw response.
    const etag = d.etag ?? versionStampOf(d.response) ?? ''
    if (!d.etag && etag) d.etag = etag
    const r = await this.deps.gateway(this.store.settings).release({ type: d.type, number: d.number, etag })
    if (!r.ok) {
      ev(c, 'error', r.status === 412 ? 'SAP refused the release: 412 Precondition Failed' : `SAP refused the release: ${r.status}`, { status: r.status, message: r.message, actor: input.actor }, step, Date.now() - t)
      this.touch(c.id)
      return { ok: false, status: r.status, message: r.message }
    }
    d.released = true
    ev(c, 'sap_release', `Billing block removed on ${d.type} ${d.number} by ${input.actor} (${input.role})${goodsReceipt === 'not required' ? '' : `; goods receipt ${goodsReceipt}`}`, { HeaderBillingBlockReason: '', goodsReceipt, warehouseStatus: warehouse?.status ?? null, goodsReceivedBy: d.goodsReceivedBy ?? null, goodsReceivedAt: d.goodsReceivedAt ?? null }, step, Date.now() - t)
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
    this.deps.persistence?.saveEval(results)
    this.deps.hub.emit({ type: 'status_changed' })
    return results
  }

  analytics(): Analytics {
    return computeAnalytics(this.store.list(), this.store.evalResults)
  }

  status(): AgentStatus {
    const cases = this.store.list()
    return {
      name: 'Reclaim · Returns & Credit Note',
      agentId: 'o2c-agent-8',
      cases: cases.length,
      pending: cases.filter((c) => c.status === 'awaiting_approval').length,
      lastRunAt: this.store.lastRunAt,
      sapSystem: this.deps.gateway(this.store.settings).live ? 'DS4' : 'mock gateway',
      aiMode: this.store.settings.aiMode,
      mailbox: this.deps.mailboxStatus?.() ?? null,
      ai: this.deps.ai(this.store.settings).name,
    }
  }

  getSettings(): Settings {
    return { ...this.store.settings }
  }

  updateSettings(patch: Partial<Settings>): Outcome<Settings> {
    this.store.settings = { ...this.store.settings, ...patch }
    this.deps.persistence?.saveSettings(this.store.settings, this.store.lastRunAt)
    this.deps.hub.emit({ type: 'status_changed' })
    return { ok: true, value: { ...this.store.settings } }
  }

  /** Removes the demo cases only; real complaints survive (see Store.reset). */
  async reset(by = 'unknown') {
    const removed = this.store.reset()
    this.deps.onReset?.()
    for (const id of removed) await this.deps.persistence?.deleteCase?.(id)
    this.deps.log?.(`Demo reset by ${by}: removed ${removed.length} demo case(s); ${this.store.cases.size} real case(s) kept`)
    for (const id of removed) this.deps.hub.emit({ type: 'case_changed', id })
    this.deps.hub.emit({ type: 'status_changed' })
  }
}

/** Stable case id for an email: the same Message-ID gives the same id on every instance. */
export function caseIdForMessage(messageId: string): string {
  return `case-m${createHash('sha1').update(messageId.trim()).digest('hex').slice(0, 10)}`
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
