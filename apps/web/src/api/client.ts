import type {
  AgentStatus,
  Analytics,
  Case,
  CaseStatus,
  CaseSummary,
  EvalResult,
  ReturnStatus,
  Snapshot,
  Answer,
  RoutingNote,
  RootCauseBriefing,
  ReplyKind,
  ReplySuggestion,
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
  /** 'decision' (default): the one reply after a person decided. 'message': any other email in the thread. */
  kind?: ReplyKind
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
  /** The suggested next email, from every email with the customer about the invoice. */
  replySuggestion(caseId: string): Promise<ReplySuggestion>
  chooseProposal(proposalId: string): Promise<void>
  approve(proposalId: string, input: ApproveInput): Promise<ApproveResult>
  reject(proposalId: string, input: RejectInput): Promise<void>
  /** Reopen a decided case or close one by hand (MANUAL_STATUSES). Never touches SAP. */
  changeStatus(caseId: string, input: ChangeStatusInput): Promise<void>
  release(sapDocumentId: string, input: ReleaseInput): Promise<ReleaseResult>
  /** Goods receipt of a return as SAP reports it (step 5.1.3). */
  getReturnStatus(sapDocumentId: string): Promise<ReturnStatus>
  /** The Returns desk confirms the goods receipt of a return by hand (step 5.1.3). */
  confirmGoodsReceipt(sapDocumentId: string, input: ReleaseInput): Promise<ReleaseResult>
  /** Control Tower (extra credit): the current run, a new run, a question, the memo, the routing notes, a hand-over. */
  getControlTower(): Promise<Snapshot>
  runControlTower(): Promise<Snapshot>
  askControlTower(question: string): Promise<Answer>
  getControlTowerMemo(): Promise<string>
  getControlTowerNotes(): Promise<RoutingNote[]>
  handoverFinding(findingId: string): Promise<{ ok: true; caseId: string } | { ok: false; status: number; message: string }>
  getAnalytics(): Promise<Analytics>
  /** Root causes: the last briefing (null before the first), and a new one. Read-only. */
  getRootCauses(): Promise<RootCauseBriefing | null>
  generateRootCauses(): Promise<RootCauseBriefing>
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
