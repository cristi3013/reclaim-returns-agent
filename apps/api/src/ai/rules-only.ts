import { FIXTURES, narrate, regexFacts, type Case, type Decision, type Facts, type Findings } from '@reclaim/shared'
import type { Ai } from './types'

/**
 * No model at all. Facts come from pattern rules (and, for the eight demo emails, from the fixture so the
 * demo decisions are identical in both modes); explanations come from the shared templates.
 * This is the proof that the decision never depended on the model.
 */
export class RulesOnlyAi implements Ai {
  readonly name = 'rules-only'

  async extractFacts(c: Case): Promise<{ facts: Facts }> {
    const fx = FIXTURES.find((f) => f.id === c.id || f.emailFile === c.emailFile)
    const base = regexFacts(c)
    if (!fx) return { facts: base }
    const facts: Facts = {
      ...base,
      complaintType: fx.facts.complaintType,
      claimedQuantity: fx.facts.claimedQuantity,
      invoiceNumber: fx.facts.invoiceNumber,
      wantsReplacement: fx.facts.wantsReplacement,
      goodsReturnable: fx.facts.goodsReturnable,
      claimedUnitPrice: fx.facts.claimedUnitPrice,
      evidence: 'pattern rules, demo facts for the fixture email',
    }
    return { facts }
  }

  async narrate(d: Decision, facts: Facts, findings: Findings, ctx: { existingDocNumber?: string; openCaseId?: string }) {
    return { narrative: narrate(d, facts, findings, ctx) }
  }
}
