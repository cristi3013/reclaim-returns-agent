import { describe, it, expect } from 'vitest'
import { buildFixtureCases } from '@reclaim/shared'
import { ResilientAi } from '../src/ai/resilient'
import { RulesOnlyAi } from '../src/ai/rules-only'
import type { Ai } from '../src/ai/types'

const flaky = (failures: number, status = 503): Ai & { calls: number } => {
  const rules = new RulesOnlyAi()
  const ai = {
    name: 'claude',
    calls: 0,
    async extractFacts(c: Parameters<Ai['extractFacts']>[0], a: Parameters<Ai['extractFacts']>[1]) {
      ai.calls++
      if (ai.calls <= failures) throw Object.assign(new Error('Bedrock is unable to process your request.'), { status })
      void a
      return rules.extractFacts(c)
    },
    narrate: rules.narrate.bind(rules),
  }
  return ai
}
const c = buildFixtureCases()[2]!
const noSleep = { sleep: async () => {} }

describe('ResilientAi', () => {
  it('retries a busy model and succeeds without a fallback', async () => {
    const primary = flaky(2)
    const r = await new ResilientAi(primary, new RulesOnlyAi(), noSleep).extractFacts(c, [])
    expect(primary.calls).toBe(3)
    expect(r.fallback).toBeUndefined()
    expect(r.facts.invoiceNumber).toBe('90000355')
  })

  it('falls back to rules-only when the model stays down, and says so', async () => {
    const primary = flaky(10)
    const r = await new ResilientAi(primary, new RulesOnlyAi(), noSleep).extractFacts(c, [])
    expect(primary.calls).toBe(3)
    expect(r.fallback).toMatch(/claude failed 3 time\(s\) \(503/)
    expect(r.facts.invoiceNumber).toBe('90000355')
  })

  it('does not retry a request error', async () => {
    const primary = flaky(10, 400)
    const r = await new ResilientAi(primary, new RulesOnlyAi(), noSleep).extractFacts(c, [])
    expect(primary.calls).toBe(1)
    expect(r.fallback).toMatch(/400/)
  })
})
