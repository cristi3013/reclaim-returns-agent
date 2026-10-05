import type { Case, Decision, Facts, Findings, Narrative } from '@reclaim/shared'

/**
 * The two places the model is used. Everything about money stays outside this interface:
 * the rules engine decides, the model reads and explains.
 */
export interface Ai {
  readonly name: string
  /** Read the complaint (text + photo) into facts. */
  extractFacts(c: Case, attachments: { mimeType: string; base64: string }[]): Promise<Facts>
  /** Explain a decision, draft the customer reply and the approver briefing, grounded in policy text and SAP facts. */
  narrate(d: Decision, facts: Facts, findings: Findings, ctx: { existingDocNumber?: string; openCaseId?: string }): Promise<Narrative>
}
