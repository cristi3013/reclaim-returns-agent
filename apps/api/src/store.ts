import type { Case, EvalResult, Settings } from '@reclaim/shared'

/**
 * In-memory state. Enough for the demo; swap for Supabase/Postgres by implementing the same methods.
 * Keep it dumb: no business logic here.
 */
export class Store {
  cases = new Map<string, Case>()
  settings: Settings
  lastRunAt: string | null = null
  evalResults: EvalResult[] | null = null

  constructor(initial: Partial<Settings> = {}) {
    this.settings = { sapMode: 'mock', aiMode: 'assisted', simulateConflict: false, ...initial }
  }

  get(id: string): Case {
    const c = this.cases.get(id)
    if (!c) throw Object.assign(new Error('Case not found'), { status: 404 })
    return c
  }

  list(): Case[] {
    return [...this.cases.values()].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  }

  locateProposal(proposalId: string) {
    for (const c of this.cases.values()) {
      const p = c.proposals.find((x) => x.id === proposalId)
      if (p) return { c, p }
    }
    throw Object.assign(new Error('Proposal not found'), { status: 404 })
  }

  locateDocument(id: string) {
    for (const c of this.cases.values()) {
      const d = c.sapDocuments.find((x) => x.id === id)
      if (d) return { c, d }
    }
    throw Object.assign(new Error('Document not found'), { status: 404 })
  }

  reset(keepSettings = false) {
    const s = this.settings
    this.cases.clear()
    this.lastRunAt = null
    this.evalResults = null
    if (!keepSettings) this.settings = { sapMode: 'mock', aiMode: 'assisted', simulateConflict: false }
    else this.settings = s
  }
}
