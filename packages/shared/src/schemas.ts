import { z } from 'zod'
import {
  AI_MODES,
  APPROVER_ROLES,
  CASE_STATUSES,
  COMPLAINT_TYPES,
  DOCUMENT_TYPES,
  EVENT_KINDS,
  L4_STEP_IDS,
  REASON_CODE_IDS,
  ROLES,
  RULE_IDS,
} from './enums'

/** What the extraction step reads out of the complaint email and its attachments. */
export const FactsSchema = z.object({
  invoiceNumber: z.string().nullable(),
  material: z.string().nullable(),
  claimedQuantity: z.number().nullable(),
  unit: z.string().nullable(),
  complaintType: z.enum(COMPLAINT_TYPES),
  claimedUnitPrice: z.number().nullable(),
  wantsReplacement: z.boolean(),
  goodsReturnable: z.boolean().nullable(),
  evidence: z.string(),
  language: z.string(),
})

export const InvoiceItemSchema = z.object({
  item: z.string(),
  material: z.string(),
  description: z.string(),
  quantity: z.number(),
  unit: z.string(),
  netAmount: z.number(),
  unitPrice: z.number(),
  plant: z.string(),
  salesOrder: z.string(),
  delivery: z.string(),
})

export const InvoiceSnapshotSchema = z.object({
  number: z.string(),
  date: z.string(),
  customer: z.string(),
  customerName: z.string(),
  salesOrg: z.string(),
  distributionChannel: z.string(),
  division: z.string(),
  companyCode: z.string(),
  currency: z.string(),
  totalNetAmount: z.number(),
  etag: z.string(),
  items: z.array(InvoiceItemSchema),
})

export const ExistingDocSchema = z.object({
  type: z.enum(['YRE', 'YCR']),
  number: z.string(),
  reasonCode: z.string(),
  amount: z.number(),
  billingBlock: z.string(),
})

export const LookupSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  durationMs: z.number(),
  ok: z.boolean(),
})

/** What the investigation step found in SAP. */
export const FindingsSchema = z.object({
  invoice: InvoiceSnapshotSchema.nullable(),
  candidateInvoices: z.array(InvoiceSnapshotSchema),
  existingReturns: z.array(ExistingDocSchema),
  existingCredits: z.array(ExistingDocSchema),
  agreedUnitPrice: z.number().nullable(),
  plantCompanyCode: z.string().nullable(),
  lookups: z.array(LookupSchema),
})

/** The money decision. Produced by code, never by the model. */
export const DecisionSchema = z.object({
  ruleId: z.enum(RULE_IDS),
  documentType: z.enum(DOCUMENT_TYPES),
  reasonCode: z.enum(REASON_CODE_IDS).nullable(),
  material: z.string().nullable(),
  quantity: z.number(),
  unit: z.string().nullable(),
  amount: z.number(),
  currency: z.string(),
  approverRole: z.enum(APPROVER_ROLES).nullable(),
  intercompany: z.boolean(),
  requiresCustomerConfirmation: z.boolean(),
  notes: z.string(),
})

export const BriefingSchema = z.object({
  whatHappened: z.string(),
  whatWePropose: z.string(),
  risk: z.string(),
})

export const ProposalSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  option: z.enum(['A', 'B', 'single']),
  recommended: z.boolean(),
  chosen: z.boolean(),
  decision: DecisionSchema,
  sapPayload: z.record(z.string(), z.unknown()).nullable(),
  explanation: z.string(),
  policyCitations: z.array(z.object({ ruleId: z.enum(RULE_IDS), text: z.string() })),
  replyDraft: z.string(),
  briefing: BriefingSchema,
  createdAt: z.string(),
  /** SAP mode the proposal was built in. A proposal built on mock data must not be approved against the real system. */
  /** Kept for cases stored before 6 Oct 2026, when the system still had a mock SAP mode. */
  sapMode: z.string().optional(),
})

export const ApprovalSchema = z.object({
  id: z.string(),
  proposalId: z.string(),
  actor: z.string(),
  role: z.enum(ROLES),
  decision: z.enum(['approved', 'rejected']),
  editedQuantity: z.number().nullable(),
  comment: z.string(),
  decidedAt: z.string(),
})

export const SapDocumentSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  type: z.enum(['YRE', 'YCR']),
  number: z.string(),
  payload: z.record(z.string(), z.unknown()),
  response: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  released: z.boolean(),
  /** Version stamp SAP returned on create; the release must send it back. */
  etag: z.string().optional(),
  /** Gateway approval record (logRequest → setApprovalStatus) that authorises this document. */
  gatewayLogId: z.string().optional(),
  /** Step 5.1.3 for a return: when and by whom the Returns desk confirmed the goods receipt. */
  goodsReceivedAt: z.string().optional(),
  goodsReceivedBy: z.string().optional(),
})

/** Goods receipt of a return (step 5.1.3): what SAP says, or "unknown" when the system cannot ask. */
export const ReturnStatusSchema = z.object({
  documentId: z.string(),
  type: z.enum(['YRE', 'YCR']),
  status: z.string(),
  received: z.boolean(),
  source: z.enum(['sap', 'none']),
  checkedAt: z.string(),
})

export const CaseEventSchema = z.object({
  id: z.string(),
  caseId: z.string(),
  at: z.string(),
  l4Step: z.enum(L4_STEP_IDS).nullable(),
  kind: z.enum(EVENT_KINDS),
  title: z.string(),
  detail: z.record(z.string(), z.unknown()),
  durationMs: z.number().nullable(),
})

export const AttachmentSchema = z.object({
  name: z.string(),
  mimeType: z.string(),
  url: z.string(),
})

/** "rejected" was a status until 5 Oct 2026; such cases are closed, and the rejection is in their approvals. */
const CaseStatusSchema = z.preprocess((v) => (v === 'rejected' ? 'closed' : v), z.enum(CASE_STATUSES))
export const OUTCOMES = ['approved', 'rejected', 'closed'] as const
export type Outcome = (typeof OUTCOMES)[number]

export const CaseSchema = z.object({
  id: z.string(),
  emailFile: z.string().nullable(),
  receivedAt: z.string(),
  from: z.string(),
  subject: z.string(),
  bodyText: z.string(),
  attachments: z.array(AttachmentSchema),
  status: CaseStatusSchema,
  customer: z.string().nullable(),
  customerName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  complaintType: z.enum(COMPLAINT_TYPES),
  aiMode: z.enum(AI_MODES),
  facts: FactsSchema.nullable(),
  findings: FindingsSchema.nullable(),
  proposals: z.array(ProposalSchema),
  approvals: z.array(ApprovalSchema),
  sapDocuments: z.array(SapDocumentSchema),
  events: z.array(CaseEventSchema),
  anomalies: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const CaseSummarySchema = z.object({
  id: z.string(),
  receivedAt: z.string(),
  from: z.string(),
  subject: z.string(),
  customer: z.string().nullable(),
  customerName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  complaintType: z.enum(COMPLAINT_TYPES),
  status: CaseStatusSchema,
  outcome: z.enum(OUTCOMES).nullable().default(null),
  ruleId: z.enum(RULE_IDS).nullable(),
  documentType: z.enum(DOCUMENT_TYPES).nullable(),
  amount: z.number().nullable(),
  currency: z.string(),
  approverRole: z.enum(APPROVER_ROLES).nullable(),
  /** Plant company differs from the invoicing company: finance must see it (step 5.2.2). */
  intercompany: z.boolean(),
  updatedAt: z.string(),
})

export const EvalFieldSchema = z.object({
  name: z.string(),
  expected: z.string(),
  actual: z.string(),
  pass: z.boolean(),
})

export const EvalResultSchema = z.object({
  caseId: z.string(),
  emailFile: z.string(),
  fields: z.array(EvalFieldSchema),
  pass: z.boolean(),
})

export const MailboxStatusSchema = z.object({
  address: z.string(),
  connected: z.boolean(),
  lastMessageAt: z.string().nullable(),
  lastError: z.string().nullable(),
})

export const AgentStatusSchema = z.object({
  name: z.string(),
  agentId: z.string(),
  cases: z.number(),
  pending: z.number(),
  lastRunAt: z.string().nullable(),
  /** The SAP system behind the gateway: "DS4" in the product, "mock gateway" in tests. */
  sapSystem: z.string(),
  aiMode: z.enum(AI_MODES),
  /** Which mailbox complaints arrive from, if one is configured. */
  mailbox: MailboxStatusSchema.nullable().optional(),
  /** Where the model runs, e.g. "claude (bedrock: eu.anthropic.claude-opus-5-5)" or "rules-only". */
  ai: z.string().optional(),
})

export const SettingsSchema = z.object({
  aiMode: z.enum(AI_MODES),
  simulateConflict: z.boolean(),
})

export type Facts = z.infer<typeof FactsSchema>
export type InvoiceItem = z.infer<typeof InvoiceItemSchema>
export type InvoiceSnapshot = z.infer<typeof InvoiceSnapshotSchema>
export type ExistingDoc = z.infer<typeof ExistingDocSchema>
export type Lookup = z.infer<typeof LookupSchema>
export type Findings = z.infer<typeof FindingsSchema>
export type Decision = z.infer<typeof DecisionSchema>
export type Briefing = z.infer<typeof BriefingSchema>
export type Proposal = z.infer<typeof ProposalSchema>
export type Approval = z.infer<typeof ApprovalSchema>
export type SapDocument = z.infer<typeof SapDocumentSchema>
export type ReturnStatus = z.infer<typeof ReturnStatusSchema>
export type CaseEvent = z.infer<typeof CaseEventSchema>
export type Attachment = z.infer<typeof AttachmentSchema>
export type Case = z.infer<typeof CaseSchema>
export type CaseSummary = z.infer<typeof CaseSummarySchema>
export type EvalResult = z.infer<typeof EvalResultSchema>
export type EvalField = z.infer<typeof EvalFieldSchema>
export type AgentStatus = z.infer<typeof AgentStatusSchema>
export type MailboxStatus = z.infer<typeof MailboxStatusSchema>
export type Settings = z.infer<typeof SettingsSchema>

/**
 * How a finished case ended. Not a status: the status says where the case is, the outcome what was decided. Read from
 * the approval records; a case closed by hand after its last decision is "closed".
 */
export function caseOutcome(c: Pick<Case, 'status' | 'approvals' | 'events'>): Outcome | null {
  if (!['approved', 'written_to_sap', 'sap_write_failed', 'closed'].includes(c.status)) return null
  const a = c.approvals[c.approvals.length - 1]
  if (c.status === 'closed') {
    // Event order, not timestamps: a decision and a manual close can share the same millisecond.
    const last = (ok: (e: CaseEvent) => boolean) => c.events.map(ok).lastIndexOf(true)
    const byHand = last((e) => e.kind === 'status' && e.detail.to === 'closed')
    if (byHand >= 0 && byHand > last((e) => e.kind === 'approval')) return 'closed'
  }
  return a?.decision ?? null
}

/** The proposal that currently represents the case: chosen, else recommended, else the first. */
export function primaryProposal(c: Pick<Case, 'proposals'>): Proposal | undefined {
  return c.proposals.find((x) => x.chosen) ?? c.proposals.find((x) => x.recommended) ?? c.proposals[0]
}

/**
 * Returns a copy of the invoice with the line matching `material` first, so code that reads items[0]
 * works on the line the customer is complaining about. Unchanged when no line matches.
 */
export function preferItem(inv: InvoiceSnapshot, material: string | null): InvoiceSnapshot {
  if (!material || inv.items.length < 2) return inv
  const i = inv.items.findIndex((it) => it.material === material)
  if (i <= 0) return inv
  const items = [inv.items[i]!, ...inv.items.filter((_, j) => j !== i)]
  return { ...inv, items }
}

export function toSummary(c: Case): CaseSummary {
  const p = primaryProposal(c)
  return {
    id: c.id,
    receivedAt: c.receivedAt,
    from: c.from,
    subject: c.subject,
    customer: c.customer,
    customerName: c.customerName,
    invoiceNumber: c.invoiceNumber,
    complaintType: c.complaintType,
    status: c.status,
    outcome: caseOutcome(c),
    ruleId: p?.decision.ruleId ?? null,
    documentType: p?.decision.documentType ?? null,
    amount: p ? p.decision.amount : null,
    currency: p?.decision.currency ?? 'EUR',
    approverRole: p?.decision.approverRole ?? null,
    intercompany: p?.decision.intercompany ?? false,
    updatedAt: c.updatedAt,
  }
}
