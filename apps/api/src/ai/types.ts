import type { Answer, Case, Decision, Facts, Findings, ModelUsage, Narrative, RootCauseNarration } from '@reclaim/shared'

/** Attachment types the model can read: photos, and PDFs such as a signed delivery note. Others are kept, not read. */
export const MODEL_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const MODEL_READABLE_TYPES: readonly string[] = [...MODEL_IMAGE_TYPES, 'application/pdf']
/** Larger files are skipped rather than sent: the model's request limit is about 32 MB. */
export const MODEL_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

const EXTENSION_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' }
/** The media type from a file name or URL, or null when the extension is unknown. */
export function mimeFromName(name: string): string | null {
  return EXTENSION_TYPES[name.split(/[?#]/)[0]!.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

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
}
