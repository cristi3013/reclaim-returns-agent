import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { CaseSchema, type Case, type EvalResult, type Settings } from '@reclaim/shared'
import type { Store } from './store'

/**
 * Write-through persistence for the in-memory Store. The map stays the working copy, so nothing in the
 * service changes; every touched case is upserted in the background, and at startup all rows are loaded.
 * Enabled only when SUPABASE_URL and SUPABASE_SECRET_KEY are set. A database error is logged and never
 * blocks a request: the demo must not depend on the network.
 */
export class SupabasePersistence {
  private db: SupabaseClient
  private queue = new Map<string, Promise<void>>()
  private log: (msg: string) => void

  constructor(url: string, secretKey: string, log: (msg: string) => void = console.error) {
    this.db = createClient(url, secretKey, { auth: { persistSession: false } })
    this.log = log
  }

  static fromEnv(log?: (msg: string) => void): SupabasePersistence | null {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
    return url && key ? new SupabasePersistence(url, key, log) : null
  }

  /** Fills the store from the database. Returns how many cases were loaded. */
  async load(store: Store): Promise<number> {
    const { data: rows, error } = await this.db.from('cases').select('id, data')
    if (error) throw new Error(`Supabase load failed: ${error.message}. Did you run apps/api/supabase/schema.sql?`)
    let n = 0
    for (const row of rows ?? []) {
      const parsed = CaseSchema.safeParse(row.data)
      if (!parsed.success) {
        this.log(`Skipping stored case ${row.id}: does not match the current schema`)
        continue
      }
      const c = parsed.data
      // A case caught mid-run goes back to received, as the frontend mock does.
      if (c.status === 'investigating' || c.status === 'proposed') c.status = 'received'
      store.cases.set(c.id, c)
      n++
    }
    const { data: s } = await this.db.from('settings').select('data, last_run_at').eq('id', 'default').maybeSingle()
    if (s?.data) store.settings = { ...store.settings, ...(s.data as Partial<Settings>) }
    if (s?.last_run_at) store.lastRunAt = s.last_run_at
    const { data: ev } = await this.db.from('eval_runs').select('results').order('ran_at', { ascending: false }).limit(1).maybeSingle()
    if (ev?.results) store.evalResults = ev.results as EvalResult[]
    return n
  }

  /** Upsert one case. Calls for the same case are serialised so the last write wins. */
  saveCase(c: Case) {
    const prev = this.queue.get(c.id) ?? Promise.resolve()
    const next = prev
      .then(async () => {
        const { error } = await this.db.from('cases').upsert({
          id: c.id,
          status: c.status,
          invoice: c.invoiceNumber,
          customer: c.customer,
          received_at: c.receivedAt,
          updated_at: c.updatedAt,
          data: c,
        })
        if (error) this.log(`Supabase upsert of ${c.id} failed: ${error.message}`)
        for (const d of c.sapDocuments) {
          const { error: e2 } = await this.db.from('sap_writes').upsert({ id: d.id, case_id: c.id, doc_type: d.type, doc_number: d.number, released: d.released, payload: d.payload, response: d.response, created_at: d.createdAt })
          if (e2) this.log(`Supabase upsert of SAP write ${d.id} failed: ${e2.message}`)
        }
      })
      .catch((e) => this.log(`Supabase save failed: ${(e as Error).message}`))
    this.queue.set(c.id, next)
  }

  /**
   * Insert a brand-new case, and only if no instance has inserted it yet (same id = same email). False means
   * another instance took it; the sync loop brings its copy over. A database error never blocks intake.
   */
  async insertCase(c: Case): Promise<boolean> {
    const { error } = await this.db.from('cases').insert({ id: c.id, status: c.status, invoice: c.invoiceNumber, customer: c.customer, received_at: c.receivedAt, updated_at: c.updatedAt, data: c })
    if (!error) return true
    if (error.code === '23505') return false
    this.log(`Supabase insert of ${c.id} failed: ${error.message}`)
    return true
  }

  saveSettings(settings: Settings, lastRunAt: string | null) {
    void this.db
      .from('settings')
      .upsert({ id: 'default', data: settings, last_run_at: lastRunAt, updated_at: new Date().toISOString() })
      .then(({ error }) => error && this.log(`Supabase settings save failed: ${error.message}`))
  }

  saveEval(results: EvalResult[]) {
    void this.db
      .from('eval_runs')
      .insert({ passed: results.filter((r) => r.pass).length, total: results.length, results })
      .then(({ error }) => error && this.log(`Supabase eval save failed: ${error.message}`))
  }

  async deleteCase(id: string) {
    const { error } = await this.db.from('cases').delete().eq('id', id)
    if (error) this.log(`Supabase delete of ${id} failed: ${error.message}`)
  }

  async deleteAll() {
    const { error } = await this.db.from('cases').delete().neq('id', '')
    if (error) this.log(`Supabase reset failed: ${error.message}`)
  }

  /**
   * Pulls what other instances wrote: rows newer than the local copy are reloaded, rows that disappeared
   * (a reset elsewhere) are dropped. Cases this instance is working on are left alone. Returns the ids that
   * changed locally so the caller can tell the UI.
   */
  async refresh(store: Store, busy: (id: string) => boolean): Promise<{ changed: string[]; removed: string[] }> {
    const { data: rows, error } = await this.db.from('cases').select('id, updated_at')
    if (error) throw new Error(`Supabase refresh failed: ${error.message}`)
    const plan = planSync(store.cases, rows ?? [], busy)
    const changed: string[] = []
    if (plan.toFetch.length) {
      const { data: full, error: e2 } = await this.db.from('cases').select('id, data').in('id', plan.toFetch)
      if (e2) throw new Error(`Supabase refresh failed: ${e2.message}`)
      for (const row of full ?? []) {
        const parsed = CaseSchema.safeParse(row.data)
        if (!parsed.success) continue
        const c = parsed.data
        if (c.status === 'investigating' || c.status === 'proposed') c.status = 'received'
        store.cases.set(c.id, c)
        changed.push(c.id)
      }
    }
    for (const id of plan.toRemove) store.cases.delete(id)
    return { changed, removed: plan.toRemove }
  }

  /** Waits for queued writes (tests and graceful shutdown). */
  async flush() {
    await Promise.all([...this.queue.values()])
  }
}

/**
 * Which cases to reload and which to drop, given the database's id + updated_at list. Pure, so it is testable:
 * a row is stale locally when the database is newer than the local copy (by more than a second, to survive
 * timestamp rounding); a local case absent from the database was reset elsewhere. Busy cases are never touched.
 */
export function planSync(
  local: Map<string, Case>,
  remote: { id: string; updated_at: string }[],
  busy: (id: string) => boolean,
): { toFetch: string[]; toRemove: string[] } {
  const seen = new Set<string>()
  const toFetch: string[] = []
  for (const r of remote) {
    seen.add(r.id)
    if (busy(r.id)) continue
    const mine = local.get(r.id)
    if (!mine || Date.parse(r.updated_at) - Date.parse(mine.updatedAt) > 1000) toFetch.push(r.id)
  }
  const toRemove = [...local.keys()].filter((id) => !seen.has(id) && !busy(id))
  return { toFetch, toRemove }
}
