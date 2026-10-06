import Anthropic from '@anthropic-ai/sdk'
import { AnthropicBedrock } from '@anthropic-ai/bedrock-sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { FactsSchema, RULES, RootCauseNarrationsSchema, narrate as templateNarrate, type RootCauseNarration, type Case, type Decision, type Facts, type Findings, type ModelUsage, type Narrative } from '@reclaim/shared'
import { MODEL_IMAGE_TYPES, type Ai } from './types'
import type { Answer } from '@reclaim/shared'

const NarrativeSchema = z.object({
  explanation: z.string().describe('3 to 6 sentences for the approver: what the invoice says, what the customer reports, which rule applies and what is proposed. Quote the rule id.'),
  replyDraft: z.string().describe('A short, polite email reply to the customer in their language. No numbers other than the ones given.'),
  briefing: z.object({
    whatHappened: z.string().describe('One sentence.'),
    whatWePropose: z.string().describe('One sentence.'),
    risk: z.string().describe('One sentence.'),
  }),
})

const SYSTEM_PHRASE = `You word answers for the O2C Control Tower, a read-only agent that reports where money leaks in order-to-cash on SAP.
Write a short reply to the manager who asked (plain prose, at most 160 words, no headings, no markdown). Use ONLY the figures, documents, customers, routes and owners in the COMPUTED ANSWER; never add, round or infer a number, a cause or a customer. Keep every amount with its currency; never add EUR and RON. If the computed answer says there is no data for the subject, say so plainly and do not invent a cause. If the request was refused because the Control Tower only reads, say that first, then the facts and the route. Name the fixing agent as given (e.g. "6 POD Chaser"). Say that nothing was changed in SAP.`

const SYSTEM_EXTRACT = `You read customer complaint emails for the returns desk of a chemicals distributor that uses SAP.
Extract only what the email and its attachments (photos, PDFs such as a signed delivery note) actually say. Do not guess numbers.
- invoiceNumber: the 8-digit SAP invoice number if the email names one, else null.
- material: the material number if named (e.g. "54"), else null.
- claimedQuantity and unit: the quantity the customer complains about (damaged, missing, to return), not the invoiced total.
- complaintType: damaged (arrived damaged/leaking/crushed), ruined (contaminated, destroyed, unusable), quality (defective, discoloured, not as expected), price (invoiced price higher than agreed), short_delivery (less arrived than invoiced), over_quantity, replacement (wants new goods), follow_up (asks about an earlier complaint, "RE:", "any news"), unknown.
- claimedUnitPrice: only for price complaints, the price the customer says was agreed.
- wantsReplacement: true only if the customer asks for new goods and does NOT want a credit (e.g. "please send a replacement", "we need the material, not a credit note"). false when they ask for a credit, or offer a choice such as "credit or replace" / "credit note or new delivery": a credit is always acceptable to them then.
- goodsReturnable: false if the goods are lost/leaked/consumed and cannot be sent back; true if they say the goods can be collected; null if unclear.
- evidence: one sentence with the facts you relied on, including what the photo or document shows (e.g. the quantity signed for on a delivery note).
- language: ISO code of the email language.`

const SYSTEM_NARRATE = `You write for the returns desk of a chemicals distributor that uses SAP. A rules engine has already made the decision; you never change a number, a document type or a reason code.
Ground every statement in the policy text, the SAP facts and the decision you are given. Be concrete and short. Address the customer reply to the customer in the language of their email.`

const SYSTEM_ROOT_CAUSES = `You are a returns analyst for a chemicals distributor that uses SAP. Code has already grouped similar customer complaints and computed the figures. For each group, name the most likely root cause upstream (packaging, loading, carrier, production batch, price master data, ...) and the one action that would stop these complaints.
Ground every statement in the complaints and photo descriptions given and name the specific evidence: a part (e.g. the lid seal), a batch number, a pattern (e.g. the driver asks for a signature before unloading). Do not write any amounts, counts, percentages, prices or dates: code shows the figures next to your words, and any number you add that is not in the complaints is rejected. You may name plant codes, material numbers, batch numbers and customer names exactly as they appear. Write in English, even when the complaints are in German or Romanian. Return one entry per group, with the group id exactly as given.`

type Provider = 'anthropic' | 'bedrock'

/**
 * Where the model runs. ANTHROPIC_API_KEY → Anthropic API. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY → Amazon Bedrock
 * (AWS_REGION, default eu-central-1, with the EU cross-region inference profile so data stays in Europe).
 */
export function detectProvider(): Provider | null {
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return 'bedrock'
  return null
}

const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: 'claude-opus-5-5',
  bedrock: 'eu.anthropic.claude-opus-5-5',
}

/**
 * Claude does two jobs: read the complaint into facts, and explain the decision.
 * Structured output: `messages.parse` with the Zod schema where the platform accepts it; on Bedrock the 5.x models
 * reject `output_config.format` and `strict` tools, so the same call falls back to a JSON-only instruction validated
 * with the same Zod schema. Either way, nothing reaches the rules engine without passing the schema.
 */
export class ClaudeAi implements Ai {
  readonly name: string
  /** AnthropicBedrock exposes the same messages surface; typed as Anthropic for one code path. */
  private client: Anthropic
  private model: string
  private structuredSupported: boolean | null = null

  constructor(opts: { provider?: Provider; model?: string } = {}) {
    const provider = opts.provider ?? detectProvider() ?? 'anthropic'
    this.model = opts.model || process.env.CLAUDE_MODEL || DEFAULT_MODEL[provider]
    this.client =
      provider === 'bedrock'
        ? (new AnthropicBedrock({
            awsAccessKey: process.env.AWS_ACCESS_KEY_ID!,
            awsSecretKey: process.env.AWS_SECRET_ACCESS_KEY!,
            awsRegion: process.env.AWS_REGION ?? 'eu-central-1',
          }) as unknown as Anthropic)
        : new Anthropic()
    this.name = `claude (${provider}: ${this.model})`
  }

  /** One structured call: parse with the schema when supported, else JSON instruction + schema validation. */
  private effortSupported: boolean | null = null

  private effortConfig(effort: 'low' | 'medium' | 'high'): { effort?: 'low' | 'medium' | 'high' } {
    return this.effortSupported === false ? {} : { effort }
  }

  private isEffortRejection(e: unknown): boolean {
    const err = e as Error & { status?: number }
    return err.status === 400 && /effort/i.test(err.message ?? '') && this.effortSupported !== false
  }

  /** One structured call: parse with the schema when supported, else JSON instruction + schema validation. */
  private lastUsage: ModelUsage | null = null

  private record(purpose: ModelUsage['purpose'], res: Anthropic.Message, startedAt: number) {
    const u = res.usage
    this.lastUsage = { model: this.model, purpose, inputTokens: u?.input_tokens ?? 0, outputTokens: u?.output_tokens ?? 0, cacheReadTokens: u?.cache_read_input_tokens ?? 0, cacheWriteTokens: u?.cache_creation_input_tokens ?? 0, latencyMs: Date.now() - startedAt }
  }

  private async structured<T>(schema: z.ZodType<T>, system: string, content: Anthropic.ContentBlockParam[], maxTokens: number, effort: 'low' | 'medium' | 'high', purpose: ModelUsage['purpose']): Promise<T | null> {
    const startedAt = Date.now()
    if (this.structuredSupported !== false) {
      try {
        const res = await this.client.messages.parse({
          model: this.model,
          max_tokens: maxTokens,
          system,
          output_config: { ...this.effortConfig(effort), format: zodOutputFormat(schema) },
          messages: [{ role: 'user', content }],
        })
        this.structuredSupported = true
        this.record(purpose, res, startedAt)
        if (res.stop_reason === 'refusal') return null
        return res.parsed_output ?? null
      } catch (e) {
        if (this.isEffortRejection(e)) {
          this.effortSupported = false
          return this.structured(schema, system, content, maxTokens, effort, purpose)
        }
        const err = e as Error & { status?: number }
        const unsupported = err.status === 400 && /output_config\.format|Extra inputs/i.test(err.message ?? '')
        if (!unsupported) throw e
        this.structuredSupported = false
      }
    }
    const jsonSchema = z.toJSONSchema(schema)
    let res: Anthropic.Message
    try {
      res = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        ...(this.effortSupported === false ? {} : { output_config: this.effortConfig(effort) }),
        system: `${system}\n\nAnswer with a single JSON object and nothing else. It must match this JSON schema exactly:\n${JSON.stringify(jsonSchema)}`,
        messages: [{ role: 'user', content }],
      })
    } catch (e) {
      if (this.isEffortRejection(e)) {
        this.effortSupported = false
        return this.structured(schema, system, content, maxTokens, effort, purpose)
      }
      throw e
    }
    this.record(purpose, res, startedAt)
    if (res.stop_reason === 'refusal') return null
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const parsed = schema.safeParse(JSON.parse(match[0]))
    return parsed.success ? parsed.data : null
  }

  async extractFacts(c: Case, attachments: { mimeType: string; base64: string }[]): Promise<{ facts: Facts; usage?: ModelUsage }> {
    const content: Anthropic.ContentBlockParam[] = []
    for (const a of attachments) {
      if ((MODEL_IMAGE_TYPES as readonly string[]).includes(a.mimeType)) {
        content.push({ type: 'image', source: { type: 'base64', media_type: a.mimeType as (typeof MODEL_IMAGE_TYPES)[number], data: a.base64 } })
      } else if (a.mimeType === 'application/pdf') {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.base64 } })
      }
    }
    content.push({ type: 'text', text: `From: ${c.from}\nSubject: ${c.subject}\nReceived: ${c.receivedAt}\n\n${c.bodyText}` })
    const facts = await this.structured(FactsSchema, SYSTEM_EXTRACT, content, 4000, 'medium', 'extract')
    if (!facts) throw Object.assign(new Error('The model could not extract the facts from this email.'), { status: 502 })
    return { facts, usage: this.lastUsage ?? undefined }
  }

  async phrase(question: string, answer: Answer): Promise<{ text: string; usage?: ModelUsage }> {
    const startedAt = Date.now()
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 700,
      system: SYSTEM_PHRASE,
      messages: [{ role: 'user', content: `QUESTION\n${question}\n\nCOMPUTED ANSWER (the only source of numbers, documents and routes)\nHeadline: ${answer.headline}\nFacts:\n${answer.facts.map((f) => `- ${f}`).join('\n')}\nRoute to: ${answer.routeTo}\nNo data for the subject: ${answer.noData}\nRequest refused (read-only): ${answer.refused}\n\nWrite the reply.` }],
    })
    this.record('narrate', res, startedAt)
    // Plain prose for the page: no markdown emphasis, whatever the model does.
    const text = (res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '').replace(/\*\*|__/g, '').trim()
    return { text: text || answer.text, usage: this.lastUsage ?? undefined }
  }

  async explainRootCauses(prompt: string): Promise<{ narrations: RootCauseNarration[]; usage?: ModelUsage }> {
    const out = await this.structured(RootCauseNarrationsSchema, SYSTEM_ROOT_CAUSES, [{ type: 'text', text: `${prompt}\n\nWrite the title, root cause, action, owner and confidence for every group.` }], 6000, 'medium', 'insights')
    if (!out) throw Object.assign(new Error('The model could not word the root causes.'), { status: 502 })
    return { narrations: out.clusters, usage: this.lastUsage ?? undefined }
  }

  async narrate(d: Decision, facts: Facts, findings: Findings, ctx: { existingDocNumber?: string; openCaseId?: string }): Promise<{ narrative: Narrative; usage?: ModelUsage }> {
    const rule = RULES[d.ruleId]
    const fallback = templateNarrate(d, facts, findings, ctx)
    const inv = findings.invoice ?? findings.candidateInvoices[0] ?? null
    const prompt = `POLICY RULE APPLIED\n${rule.policyText}\n\nSAP FACTS\n${JSON.stringify({ invoice: inv, existingReturns: findings.existingReturns, existingCredits: findings.existingCredits, agreedUnitPrice: findings.agreedUnitPrice, plantCompanyCode: findings.plantCompanyCode }, null, 2)}\n\nWHAT THE CUSTOMER WROTE (extracted)\n${JSON.stringify(facts, null, 2)}\n\nDECISION (made by code, do not change it)\n${JSON.stringify(d, null, 2)}\n${ctx.existingDocNumber ? `\nAn SAP document already exists for this invoice: ${ctx.existingDocNumber}.` : ''}${ctx.openCaseId ? `\nThis invoice is already being handled in case ${ctx.openCaseId}; no document yet.` : ''}\n\nWrite the explanation, the customer reply and the approver briefing.`
    try {
      const out = await this.structured(NarrativeSchema, SYSTEM_NARRATE, [{ type: 'text', text: prompt }], 4000, 'low', 'narrate')
      return { narrative: out ? { ...out, citations: fallback.citations } : fallback, usage: this.lastUsage ?? undefined }
    } catch {
      return { narrative: fallback }
    }
  }
}
