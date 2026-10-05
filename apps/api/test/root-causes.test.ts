import { describe, it, expect, afterEach } from 'vitest'
import { tfidfVectors, COMPLAINT_ARCHIVE, type RootCauseBriefing } from '@reclaim/shared'
import { buildApp } from '../src/app'
import { headerVerifier } from '../src/auth'
import { RulesOnlyAi } from '../src/ai/rules-only'
import type { Ai } from '../src/ai/types'
import type { Embedder } from '../src/insights/embeddings'

const H = { authorization: 'Bearer credit_manager:Demo' }
let ctx: ReturnType<typeof buildApp>
afterEach(async () => ctx.app.close())

/** A stand-in for the model: words the first group well, slips an invented figure into the second. */
const fakeAi: Ai = Object.assign(new RulesOnlyAi(), {
  name: 'fake model',
  explainRootCauses: async () => ({
    narrations: [
      {
        id: 'G1',
        title: 'Leaking drum lids from plant YGLG',
        rootCause: 'Photos show the lid seal failing.',
        action: 'Check the lid gaskets at plant YGLG.',
        owner: 'Plant YGLG packaging',
        confidence: 'high' as const,
      },
      {
        id: 'G2',
        title: 'Short deliveries',
        rootCause: 'This costs 987654 EUR a year.',
        action: 'Count before signing.',
        owner: 'Transport',
        confidence: 'high' as const,
      },
    ],
  }),
})

/** Local vectors stand in for the embedding model, so the test needs no network. */
const fakeEmbedder: Embedder = {
  name: 'fake embedder',
  embed: async (texts) => tfidfVectors(COMPLAINT_ARCHIVE).slice(0, texts.length),
}

function setup(aiMode: 'assisted' | 'rules_only', ai?: Ai) {
  process.env.INBOUND_AUTORUN = 'false'
  ctx = buildApp({
    verifier: headerVerifier(),
    mockDelayMs: 0,
    noSideCars: true,
    mailer: null,
    initialSettings: { aiMode },
    ...(ai ? { ai: () => ai } : {}),
    embedder: ai ? fakeEmbedder : null,
  })
  return {
    generate: async () => {
      const r = await ctx.app.inject({
        method: 'POST',
        url: '/api/insights/root-causes',
        headers: H,
      })
      expect(r.statusCode).toBe(200)
      return r.json() as RootCauseBriefing
    },
    latest: async () =>
      (
        await ctx.app.inject({ method: 'GET', url: '/api/insights/root-causes', headers: H })
      ).json() as { briefing: RootCauseBriefing | null },
  }
}

describe('root causes over HTTP', () => {
  it('runs without a model: local grouping, template wording, figures from code', async () => {
    const { generate, latest } = setup('rules_only')
    expect((await latest()).briefing).toBeNull()
    const b = await generate()
    expect(b.generatedBy).toMatch(/rules/)
    expect(b.embeddings.model).toMatch(/tf-idf/)
    expect(b.usage).toBeNull()
    expect(b.clusters.length).toBeGreaterThanOrEqual(4)
    expect(b.clusters.every((c) => c.wordedBy === 'template')).toBe(true)
    expect(b.clusters[0]!.value).toBe(15930)
    expect((await latest()).briefing?.generatedAt).toBe(b.generatedAt)
  })

  it('takes the model wording only where it passes the figure check', async () => {
    const { generate } = setup('assisted', fakeAi)
    const b = await generate()
    expect(b.generatedBy).toBe('fake model')
    expect(b.embeddings.model).toBe('fake embedder')
    expect(b.clusters[0]).toMatchObject({
      title: 'Leaking drum lids from plant YGLG',
      wordedBy: 'model',
    })
    expect(b.clusters[1]!.wordedBy).toBe('template')
    expect(JSON.stringify(b)).not.toMatch(/987654/)
  })

  it('includes investigated cases, changes none of them, and is cleared by the demo reset', async () => {
    const { generate, latest } = setup('rules_only')
    await ctx.app.inject({ method: 'POST', url: '/api/cases/seed', headers: H })
    await ctx.app.inject({ method: 'POST', url: '/api/cases/run-all', headers: H })
    const before = JSON.stringify([...ctx.store.cases.values()])
    const b = await generate()
    expect(b.totals.live).toBe(8)
    expect(b.clusters.flatMap((c) => c.members).some((m) => m.source === 'live')).toBe(true)
    expect(JSON.stringify([...ctx.store.cases.values()])).toBe(before)
    await ctx.app.inject({ method: 'POST', url: '/api/demo/reset', headers: H })
    expect((await latest()).briefing).toBeNull()
  })
})
