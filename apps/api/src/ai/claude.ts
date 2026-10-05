import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import {
  FactsSchema,
  RULES,
  narrate as templateNarrate,
  type Case,
  type Decision,
  type Facts,
  type Findings,
  type Narrative,
} from '@reclaim/shared'
import type { Ai } from './types'

const NarrativeSchema = z.object({
  explanation: z.string().describe('3 to 6 sentences for the approver: what the invoice says, what the customer reports, which rule applies and what is proposed. Quote the rule id.'),
  replyDraft: z.string().describe('A short, polite email reply to the customer in their language. No numbers other than the ones given.'),
  briefing: z.object({
    whatHappened: z.string().describe('One sentence.'),
    whatWePropose: z.string().describe('One sentence.'),
    risk: z.string().describe('One sentence.'),
  }),
})

const SYSTEM_EXTRACT = `You read customer complaint emails for the returns desk of a chemicals distributor that uses SAP.
Extract only what the email (and the photo, if any) actually says. Do not guess numbers.
- invoiceNumber: the 8-digit SAP invoice number if the email names one, else null.
- material: the material number if named (e.g. "54"), else null.
- claimedQuantity and unit: the quantity the customer complains about (damaged, missing, to return), not the invoiced total.
- complaintType: damaged (arrived damaged/leaking/crushed), ruined (contaminated, destroyed, unusable), quality (defective, discoloured, not as expected), price (invoiced price higher than agreed), short_delivery (less arrived than invoiced), over_quantity, replacement (wants new goods), follow_up (asks about an earlier complaint, "RE:", "any news"), unknown.
- claimedUnitPrice: only for price complaints, the price the customer says was agreed.
- wantsReplacement: true only if the customer explicitly wants a re-delivery instead of money.
- goodsReturnable: false if the goods are lost/leaked/consumed and cannot be sent back; true if they say the goods can be collected; null if unclear.
- evidence: one sentence with the facts you relied on, including what the photo shows.
- language: ISO code of the email language.`

const SYSTEM_NARRATE = `You write for the returns desk of a chemicals distributor that uses SAP. A rules engine has already made the decision; you never change a number, a document type or a reason code.
Ground every statement in the policy text, the SAP facts and the decision you are given. Be concrete and short. Address the customer reply to the customer in the language of their email.`

/**
 * Claude does two jobs: read the complaint into facts, and explain the decision.
 * Thinking is always on for this model; depth is controlled by effort.
 */
export class ClaudeAi implements Ai {
  readonly name: string
  private client: Anthropic
  constructor(private model = process.env.CLAUDE_MODEL ?? 'claude-opus-5-5') {
    this.client = new Anthropic()
    this.name = `claude (${this.model})`
  }

  async extractFacts(c: Case, attachments: { mimeType: string; base64: string }[]): Promise<Facts> {
    const content: Anthropic.ContentBlockParam[] = []
    for (const a of attachments) {
      if (a.mimeType === 'image/png' || a.mimeType === 'image/jpeg' || a.mimeType === 'image/webp' || a.mimeType === 'image/gif') {
        content.push({ type: 'image', source: { type: 'base64', media_type: a.mimeType, data: a.base64 } })
      }
    }
    content.push({ type: 'text', text: `From: ${c.from}\nSubject: ${c.subject}\nReceived: ${c.receivedAt}\n\n${c.bodyText}` })
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 4000,
      system: SYSTEM_EXTRACT,
      output_config: { effort: 'medium', format: zodOutputFormat(FactsSchema) },
      messages: [{ role: 'user', content }],
    })
    if (res.stop_reason === 'refusal' || !res.parsed_output) {
      throw Object.assign(new Error(`Extraction failed: ${res.stop_reason}`), { status: 502 })
    }
    return res.parsed_output
  }

  async narrate(d: Decision, facts: Facts, findings: Findings, ctx: { existingDocNumber?: string; openCaseId?: string }): Promise<Narrative> {
    const rule = RULES[d.ruleId]
    const fallback = templateNarrate(d, facts, findings, ctx)
    const inv = findings.invoice ?? findings.candidateInvoices[0] ?? null
    const prompt = `POLICY RULE APPLIED\n${rule.policyText}\n\nSAP FACTS\n${JSON.stringify({ invoice: inv, existingReturns: findings.existingReturns, existingCredits: findings.existingCredits, agreedUnitPrice: findings.agreedUnitPrice, plantCompanyCode: findings.plantCompanyCode }, null, 2)}\n\nWHAT THE CUSTOMER WROTE (extracted)\n${JSON.stringify(facts, null, 2)}\n\nDECISION (made by code, do not change it)\n${JSON.stringify(d, null, 2)}\n${ctx.existingDocNumber ? `\nAn SAP document already exists for this invoice: ${ctx.existingDocNumber}.` : ''}${ctx.openCaseId ? `\nThis invoice is already being handled in case ${ctx.openCaseId}; no document yet.` : ''}\n\nWrite the explanation, the customer reply and the approver briefing.`
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 4000,
      system: [{ type: 'text', text: SYSTEM_NARRATE, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: zodOutputFormat(NarrativeSchema) },
      messages: [{ role: 'user', content: prompt }],
    })
    if (res.stop_reason === 'refusal' || !res.parsed_output) return fallback
    return { ...res.parsed_output, citations: fallback.citations }
  }
}
