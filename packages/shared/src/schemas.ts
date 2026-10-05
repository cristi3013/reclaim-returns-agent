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
  SAP_MODES,
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
  sapMode: z.enum(SAP_MODES).optional(),
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

export const CaseSchema = z.object({
  id: z.string(),
  emailFile: z.string().nullable(),
  receivedAt: z.string(),
  from: z.string(),
  subject: z.string(),
  bodyText: z.string(),
  attachments: z.array(AttachmentSchema),
  status: z.enum(CASE_STATUSES),
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
  status: z.enum(CASE_STATUSES),
  ruleId: z.enum(RULE_IDS).nullable(),
  documentType: z.enum(DOCUMENT_TYPES).nullable(),
  amount: z.number().nullable(),
  currency: z.string(),
  approverRole: z.enum(APPROVER_ROLES).nullable(),
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

export const AgentStatusSchema = z.object({
  name: z.string(),
  agentId: z.string(),
  cases: z.number(),
  pending: z.number(),
  lastRunAt: z.string().nullable(),
  sapMode: z.enum(SAP_MODES),
  aiMode: z.enum(AI_MODES),
})

export const SettingsSchema = z.object({
  sapMode: z.enum(SAP_MODES),
  aiMode: z.enum(AI_MODES),
  simulateConflict: z.boolean(),
})

export const WeekPointSchema = z.object({
  week: z.string(),
  damaged: z.number(),
  ruined: z.number(),
  quality: z.number(),
  price: z.number(),
  short_delivery: z.number(),
  other: z.number(),
  approvedValue: z.number(),
  rejectedValue: z.number(),
})

export const AnalyticsSummarySchema = z.object({
  casesThisMonth: z.number(),
  pendingApprovals: z.number(),
  approvedValue: z.number(),
  rejectedValue: z.number(),
  medianHoursToApproval: z.number(),
  acceptedUnchangedRatio: z.number(),
  duplicatesPrevented: z.number(),
  intercompanyFlagged: z.number(),
  byStatus: z.record(z.string(), z.number()),
  byType: z.record(z.string(), z.number()),
  weeks: z.array(WeekPointSchema),
  currency: z.string(),
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
export type CaseEvent = z.infer<typeof CaseEventSchema>
export type Attachment = z.infer<typeof AttachmentSchema>
export type Case = z.infer<typeof CaseSchema>
export type CaseSummary = z.infer<typeof CaseSummarySchema>
export type EvalResult = z.infer<typeof EvalResultSchema>
export type EvalField = z.infer<typeof EvalFieldSchema>
export type AgentStatus = z.infer<typeof AgentStatusSchema>
export type Settings = z.infer<typeof SettingsSchema>
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>
export type WeekPoint = z.infer<typeof WeekPointSchema>

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
    ruleId: p?.decision.ruleId ?? null,
    documentType: p?.decision.documentType ?? null,
    amount: p ? p.decision.amount : null,
    currency: p?.decision.currency ?? 'EUR',
    approverRole: p?.decision.approverRole ?? null,
    updatedAt: c.updatedAt,
  }
}
