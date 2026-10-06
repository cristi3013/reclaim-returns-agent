import { CaseSchema, type Case, type EvalResult, type Settings } from '@reclaim/shared'

const KEY = 'reclaim.mock.v1'

const defaultSettings = (): Settings => ({ aiMode: 'assisted', simulateConflict: false })

/** In-memory state of the mock backend, mirrored to localStorage so a refresh mid-demo loses nothing. */
export class MockStore {
  cases = new Map<string, Case>()
  settings: Settings = defaultSettings()
  lastRunAt: string | null = null
  evalResults: EvalResult[] | null = null
  nextDoc = 60000171

  load() {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return
      const d = JSON.parse(raw) as {
        settings: Settings
        lastRunAt: string | null
        evalResults: EvalResult[] | null
        nextDoc: number
        cases: unknown[]
      }
      this.lastRunAt = d.lastRunAt
      this.evalResults = d.evalResults
      this.nextDoc = Number.isFinite(d.nextDoc) && d.nextDoc > 0 ? d.nextDoc : 60000171
      this.settings = { ...defaultSettings(), ...(d.settings ?? {}) }
      for (const c of d.cases) {
        const parsed = CaseSchema.parse(c)
        // A case caught mid-run is not stuck forever: it goes back to received and can be re-run.
        if (parsed.status === 'investigating' || parsed.status === 'proposed') parsed.status = 'received'
        this.cases.set(parsed.id, parsed)
      }
    } catch {
      this.cases.clear()
    }
  }

  save() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          settings: this.settings,
          lastRunAt: this.lastRunAt,
          evalResults: this.evalResults,
          nextDoc: this.nextDoc,
          cases: [...this.cases.values()],
        }),
      )
    } catch {
      /* storage unavailable */
    }
  }

  clear() {
    this.cases.clear()
    this.settings = defaultSettings()
    this.lastRunAt = null
    this.evalResults = null
    this.nextDoc = 60000171
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* storage unavailable */
    }
  }
}
