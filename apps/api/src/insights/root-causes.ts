import {
  assembleBriefing,
  centerVectors,
  CLUSTER_THRESHOLD,
  clusterFacts,
  COMPLAINT_ARCHIVE,
  embeddingText,
  recordFromCase,
  rootCausePrompt,
  tfidfVectors,
  type ComplaintRecord,
  type RootCauseBriefing,
  type RootCauseNarration,
  type Settings,
} from '@reclaim/shared'
import type { Ai } from '../ai/types'
import type { Store } from '../store'
import type { Embedder, VectorCache } from './embeddings'

export interface RootCauseDeps {
  store: Store
  ai: (s: Settings) => Ai
  embedder: Embedder | null
  vectors: VectorCache
  /** Closed complaints from before this system (sample data). */
  archive?: ComplaintRecord[]
  log?: (msg: string) => void
}

/**
 * Root-cause briefing over every investigated complaint plus the archive. Read-only: it reads cases, never changes
 * one, never calls SAP. Assisted mode: Cohere embeddings (cached in pgvector) group the complaints, Claude words each
 * group. Rules-only, or when either model fails: local TF-IDF groups and template wording, said so in the briefing.
 */
export class RootCauses {
  latest: RootCauseBriefing | null = null
  private running: Promise<RootCauseBriefing> | null = null

  constructor(private deps: RootCauseDeps) {}

  generate(by: string): Promise<RootCauseBriefing> {
    // Two clicks at once share one run.
    this.running ??= this.run(by).finally(() => (this.running = null))
    return this.running
  }

  private async run(by: string): Promise<RootCauseBriefing> {
    const { store, log } = this.deps
    const live = [...store.cases.values()].filter((c) => c.facts).map(recordFromCase)
    const records = [...(this.deps.archive ?? COMPLAINT_ARCHIVE), ...live]
    const assisted = store.settings.aiMode === 'assisted'
    const notes: string[] = []

    let vectors: number[][] | null = null
    let embeddings: RootCauseBriefing['embeddings'] = {
      model: 'tf-idf (local)',
      store: 'memory',
      vectors: records.length,
    }
    if (assisted && this.deps.embedder) {
      try {
        const r = await this.deps.vectors.vectors(
          records.map((x) => ({ id: x.id, text: embeddingText(x) })),
          this.deps.embedder,
        )
        vectors = centerVectors(r.vectors)
        embeddings = {
          model: this.deps.embedder.name,
          store: this.deps.vectors.store,
          vectors: records.length,
        }
      } catch (e) {
        notes.push(
          `Embedding model unavailable (${(e as Error).message.slice(0, 100)}); grouped locally.`,
        )
      }
    }
    const facts = vectors
      ? clusterFacts(records, vectors, CLUSTER_THRESHOLD.model)
      : clusterFacts(records, tfidfVectors(records), CLUSTER_THRESHOLD.tfidf)

    const prompt = rootCausePrompt(facts.clusters)
    let narrations: RootCauseNarration[] | null = null
    let usage: RootCauseBriefing['usage'] = null
    let generatedBy = 'rules (template wording)'
    const ai = this.deps.ai(store.settings)
    if (assisted && ai.explainRootCauses && facts.clusters.length) {
      try {
        const r = await ai.explainRootCauses(prompt)
        if (r.fallback) notes.push('The model did not answer; template wording shown.')
        else {
          narrations = r.narrations
          usage = r.usage ?? null
          generatedBy = ai.name
        }
      } catch (e) {
        notes.push(
          `The model failed (${(e as Error).message.slice(0, 100)}); template wording shown.`,
        )
      }
    }

    const briefing = assembleBriefing({
      records,
      facts,
      narrations,
      prompt,
      generatedBy,
      embeddings,
      usage,
      note: notes.join(' ') || null,
    })
    this.latest = briefing
    log?.(
      `Root causes by ${by}: ${records.length} complaints (${live.length} live), ${briefing.clusters.length} groups, ${embeddings.model} via ${embeddings.store}, worded by ${generatedBy}`,
    )
    return briefing
  }
}
