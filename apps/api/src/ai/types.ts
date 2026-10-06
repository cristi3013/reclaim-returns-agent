import type { Answer, Case, Decision, Facts, Findings, ModelUsage, Narrative, RootCauseNarration } from '@reclaim/shared'

export { MODEL_IMAGE_TYPES, MODEL_MAX_ATTACHMENT_BYTES, MODEL_READABLE_TYPES, mimeFromName } from '@reclaim/shared'

/**
 * The two places the model is used. Everything about money stays outside this interface:
 * the rules engine decides, the model reads and explains.
 */
export interface Ai {
  readonly name: string
  /** Read the complaint (text, photos and PDFs) into facts. */
  extractFacts(c: Case, attachments: { mimeType: string; base64: string }[]): Promise<{ facts: Facts; usage?: ModelUsage }>
  /** Explain a decision, draft the customer reply and the approver briefing, grounded in policy text and SAP facts. */
  narrate(d: Decision, facts: Facts, findings: Findings, ctx: { existingDocNumber?: string; openCaseId?: string }): Promise<{ narrative: Narrative; usage?: ModelUsage }>
  /** Control Tower: phrase a computed answer for a manager. Every number stays as computed; the model only words it. */
  phrase?(question: string, answer: Answer): Promise<{ text: string; usage?: ModelUsage }>
  /** Root causes: name the cause and the fix for each group of similar complaints. Words only; code computes the figures. */
  explainRootCauses?(prompt: string): Promise<{ narrations: RootCauseNarration[]; usage?: ModelUsage; fallback?: string }>
  /** Reply to the customer: word the next email from the computed facts and the email history. A person edits and sends it. */
  suggestReply?(prompt: string): Promise<{ text: string; usage?: ModelUsage; fallback?: string }>
}
