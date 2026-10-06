import { z } from 'zod'

/**
 * The Control Tower reads SAP and never writes. These are the normalised inputs of one run (what the SAP lists
 * say), and the outputs (KPIs per currency, findings with their L4 step and route, the close verdict).
 */
export interface DeliveryRow {
  number: string
  soldTo: string
  shipTo: string
  goodsIssueDate: string
  /** 'A' | 'B' not (fully) billed, 'C' billed, '' unknown */
  billingStatus: string
  /** '' not POD-relevant, 'A' | 'B' open, 'C' confirmed */
  podStatus: string
  podDate: string | null
  salesOrg: string
}
export interface BlockedOrderRow {
  number: string
  type: string
  salesOrg: string
  soldTo: string
  creationDate: string
  netAmount: number
  currency: string
  billingBlock: string
  deliveryBlock: string
  creditStatus: string
  processStatus: string
}
export interface OverdueRow {
  companyCode: string
  customer: string
  amount: number
  currency: string
}
export interface DueListRow {
  delivery: string
  netAmount: number
  currency: string
  hasError: boolean
  soldTo: string
}
export interface ReturnRow {
  number: string
  soldTo: string
  creationDate: string
  netAmount: number | null
  currency: string
  hasCreditMemo: boolean
}
export interface CustomerRow {
  id: string
  name: string
  country: string | null
  city: string | null
}
export interface ConformanceRow {
  order: string
  conforms: boolean
  findings: { severity: string; l4: string; step: string; finding: string; routeTo: string }[]
  deliveries: string[]
  billingDocuments: string[]
  soldTo?: string
  netAmount?: number
  currency?: string
}

/** A list as read from SAP, with whether it was cut at its row cap, or not read at all. */
export interface ReadList<T> {
  rows: T[]
  /** The cap the request used; `rows.length === cap` means the list is incomplete. */
  cap: number | null
  /** Set when the read failed: the section is reported as not read, the run continues. */
  error: string | null
  /** The GET requests behind this list (the run's request log). */
  requests: string[]
}

export interface ScanInput {
  asOf: string
  unbilled: ReadList<DeliveryRow>
  awaitingPod: ReadList<DeliveryRow>
  blockedOrders: ReadList<BlockedOrderRow>
  /** One read per company code. */
  overdue: Record<string, ReadList<OverdueRow>>
  dueList: ReadList<DueListRow>
  returns: ReadList<ReturnRow>
  customers: CustomerRow[]
  conformance: ConformanceRow[]
}

export const SEVERITIES = ['high', 'medium', 'info', 'watch'] as const
export type Severity = (typeof SEVERITIES)[number]

export const FINDING_KINDS = ['pod_pending', 'shipped_not_billed', 'order_block', 'credit_block', 'overdue_receivable', 'return_without_credit', 'conformance_deviation'] as const
export type FindingKind = (typeof FINDING_KINDS)[number]

export const AGENTS = {
  pod: '6 POD Chaser',
  billing: '7 Billing Gatekeeper',
  blocks: '3 Block Buster',
  cash: '9 Cash Application & Collections',
  returns: '8 Returns & Credit Note',
  person: 'a person',
  none: 'none',
} as const
export type Route = keyof typeof AGENTS

export const FindingSchema = z.object({
  id: z.string(),
  kind: z.enum(FINDING_KINDS),
  l4: z.string(),
  documentType: z.string(),
  document: z.string(),
  customer: z.string(),
  customerName: z.string().nullable(),
  country: z.string().nullable(),
  value: z.number().nullable(),
  currency: z.string(),
  ageDays: z.number(),
  severity: z.enum(SEVERITIES),
  rule: z.string(),
  why: z.string(),
  routeTo: z.enum(Object.keys(AGENTS) as [Route, ...Route[]]),
  dataOwner: z.string(),
  /** Goods issue (or creation) before the period being closed, and older than a year: reported, not deciding the close. */
  legacy: z.boolean(),
  /** Goods issue inside the period being closed. */
  currentPeriod: z.boolean(),
})
export type Finding = z.infer<typeof FindingSchema>

export const MoneySchema = z.record(z.string(), z.number())

export const KpisSchema = z.object({
  unbilled: z.object({ count: z.number(), currentPeriod: z.number(), withinGrace: z.number(), over3d: z.number(), over14d: z.number(), over14dPod: z.number(), over14dBilling: z.number(), legacy: z.number(), valued: z.number(), value: MoneySchema, oldestDays: z.number().nullable(), capped: z.boolean() }),
  awaitingPod: z.object({ count: z.number(), over3d: z.number(), over14d: z.number(), value: MoneySchema, capped: z.boolean() }),
  blocked: z.object({ count: z.number(), value: MoneySchema, credit: z.number(), ageing: z.object({ '0-7': z.number(), '8-30': z.number(), '31+': z.number() }), capped: z.boolean() }),
  overdue: z.record(z.string(), z.object({ currency: z.string(), total: z.number(), customers: z.number() })),
  returns: z.object({ count: z.number(), value: MoneySchema }),
  conformance: z.object({ walked: z.number(), conform: z.number(), deviationsByL4: z.record(z.string(), z.number()) }),
})
export type Kpis = z.infer<typeof KpisSchema>

export const SnapshotSchema = z.object({
  asOf: z.string(),
  /** Where the lists came from: "SAP DS4, live" or the organisers' pack of 1 Oct 2026. */
  source: z.string(),
  period: z.string(),
  verdict: z.enum(['ready', 'at risk', 'not ready']),
  verdictWhy: z.string(),
  kpis: KpisSchema,
  findings: z.array(FindingSchema),
  rowCaps: z.array(z.string()),
  notRead: z.array(z.object({ section: z.string(), error: z.string() })),
  requestLog: z.array(z.string()),
})
export type Snapshot = z.infer<typeof SnapshotSchema>

export const RoutingNoteSchema = z.object({
  id: z.string(),
  date: z.string(),
  agent: z.string(),
  route: z.enum(Object.keys(AGENTS) as [Route, ...Route[]]),
  l4: z.array(z.string()),
  findingIds: z.array(z.string()),
  subject: z.string(),
  body: z.string(),
})
export type RoutingNote = z.infer<typeof RoutingNoteSchema>

export const AnswerSchema = z.object({
  question: z.string(),
  topic: z.enum(['dso', 'close', 'leakage', 'conformance', 'overdue', 'change_request', 'unknown']),
  subject: z.object({ country: z.string().nullable(), customer: z.string().nullable(), order: z.string().nullable() }),
  headline: z.string(),
  facts: z.array(z.string()),
  findings: z.array(FindingSchema),
  routeTo: z.enum(Object.keys(AGENTS) as [Route, ...Route[]]),
  /** SAP holds nothing for the subject: said plainly, nothing invented. */
  noData: z.boolean(),
  /** The question asked for a change in SAP; the Control Tower refuses and routes. */
  refused: z.boolean(),
  /** Plain text answer (template or model-phrased). Every number in it comes from `facts`. */
  text: z.string(),
  phrasedBy: z.string(),
})
export type Answer = z.infer<typeof AnswerSchema>
