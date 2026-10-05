import type {
  AgentStatus,
  Analytics,
  Case,
  CaseStatus,
  CaseSummary,
  EvalResult,
  ReturnStatus,
  Role,
  SapDocument,
  Settings,
} from '@reclaim/shared'

export type ApproveResult =
  | { ok: true; document: SapDocument | null }
  | { ok: false; status: number; message: string }

export type ReleaseResult =
  | { ok: true; document: SapDocument }
  | { ok: false; status: number; message: string }

export type SendReplyResult =
  | { ok: true; to: string; messageId: string }
  | { ok: false; status: number; message: string }

export interface SendReplyInput {
  actor: string
  role: Role
  /** The reply as the person edited it. Default: the proposal's draft. */
  text?: string
}

export type ApiEvent = { type: 'case_changed'; id: string } | { type: 'status_changed' }

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
  /** Why: kept in the audit trail. */
  comment: string
}

export interface ReleaseInput {
  actor: string
  role: Role
  /** Manual confirmation that the warehouse received the goods, for when SAP cannot say so (step 5.1.3). */
  goodsReceived?: boolean
}

/**
 * Everything the UI needs from the backend. Two implementations: MockApiClient (in-browser,
 * fixtures from the organizers' mock data) and HttpApiClient (the real backend).
 */
export interface ApiClient {
  listCases(): Promise<CaseSummary[]>
  getCase(id: string): Promise<Case>
  seedCases(): Promise<void>
  ingest(files: File[]): Promise<CaseSummary[]>
  runCase(id: string): Promise<void>
  runAll(): Promise<void>
  /** Emails the reply to the customer, in their thread. Only after a person decided, once. */
  sendReply(caseId: string, input: SendReplyInput): Promise<SendReplyResult>
  chooseProposal(proposalId: string): Promise<void>
  approve(proposalId: string, input: ApproveInput): Promise<ApproveResult>
  reject(proposalId: string, input: RejectInput): Promise<void>
  /** Reopen a decided case or close one by hand (MANUAL_STATUSES). Never touches SAP. */
  changeStatus(caseId: string, input: ChangeStatusInput): Promise<void>
  release(sapDocumentId: string, input: ReleaseInput): Promise<ReleaseResult>
  /** Goods receipt of a return as SAP reports it (step 5.1.3). */
  getReturnStatus(sapDocumentId: string): Promise<ReturnStatus>
  getAnalytics(): Promise<Analytics>
  runEval(): Promise<EvalResult[]>
  getLatestEval(): Promise<EvalResult[] | null>
  getStatus(): Promise<AgentStatus>
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  reset(): Promise<void>
  subscribe(listener: (e: ApiEvent) => void): () => void
}

export const CONFLICT_MESSAGE =
  'The record changed in SAP since it was read. Nothing was written. Reload the case and approve again.'
