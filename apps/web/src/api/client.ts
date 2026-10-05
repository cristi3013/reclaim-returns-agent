import type {
  AgentStatus,
  AnalyticsSummary,
  Case,
  CaseSummary,
  EvalResult,
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

export interface ReleaseInput {
  actor: string
  role: Role
  /** A return (YRE) is credited only after the warehouse received the goods. */
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
  chooseProposal(proposalId: string): Promise<void>
  approve(proposalId: string, input: ApproveInput): Promise<ApproveResult>
  reject(proposalId: string, input: RejectInput): Promise<void>
  release(sapDocumentId: string, input: ReleaseInput): Promise<ReleaseResult>
  getAnalytics(): Promise<AnalyticsSummary>
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
