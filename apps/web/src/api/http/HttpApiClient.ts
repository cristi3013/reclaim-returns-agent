import {
  API_ROUTES,
  AgentStatusSchema,
  AnalyticsSchema,
  CaseSchema,
  CaseSummarySchema,
  EvalResultSchema,
  ReturnStatusSchema,
  SnapshotSchema,
  AnswerSchema,
  RoutingNoteSchema,
  SapDocumentSchema,
  SettingsSchema,
  type Settings,
} from '@reclaim/shared'
import { z } from 'zod'
import type { ApiClient, ApiEvent, ApproveInput, ChangeStatusInput, ApproveResult, RejectInput, ReleaseInput, ReleaseResult, SendReplyInput, SendReplyResult } from '../client'

type Routes = typeof API_ROUTES

/** Thin fetch wrapper over the shared route table. Validates responses in development. */
export class HttpApiClient implements ApiClient {
  constructor(
    private base: string,
    /** Current session token; every call carries it, the API refuses calls without one. */
    private getToken: () => Promise<string | null> = async () => null,
  ) {}

  private url(path: string, params: Record<string, string> = {}) {
    return this.base + path.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''))
  }

  private async call<T>(
    key: keyof Routes,
    params: Record<string, string> = {},
    body?: unknown,
    schema?: z.ZodType<T>,
  ): Promise<T> {
    const r = API_ROUTES[key]
    const isForm = body instanceof FormData
    const token = await this.getToken()
    const res = await fetch(this.url(r.path, params), {
      method: r.method,
      headers: { ...(isForm || body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      let message = text || res.statusText
      try {
        const j = JSON.parse(text) as { message?: string; error?: { message?: string } }
        message = j.message ?? j.error?.message ?? message
      } catch {
        /* plain text body */
      }
      throw Object.assign(new Error(message), { status: res.status })
    }
    const raw = res.status === 204 ? '' : await res.text()
    const data = raw ? JSON.parse(raw) : undefined
    return schema && import.meta.env.DEV ? schema.parse(data) : (data as T)
  }

  listCases() {
    return this.call('listCases', {}, undefined, z.array(CaseSummarySchema))
  }
  getCase(id: string) {
    return this.call('getCase', { id }, undefined, CaseSchema)
  }
  async seedCases() {
    await this.call('seedCases')
  }
  ingest(files: File[]) {
    const fd = new FormData()
    files.forEach((f) => fd.append('files', f))
    return this.call('ingest', {}, fd, z.array(CaseSummarySchema))
  }
  async runCase(id: string) {
    await this.call('runCase', { id })
  }
  async runAll() {
    await this.call('runAll')
  }
  async sendReply(id: string, input: SendReplyInput): Promise<SendReplyResult> {
    try {
      const r = await this.call<{ to: string; messageId: string }>('sendReply', { id }, input)
      return { ok: true, ...r }
    } catch (e) {
      const err = e as Error & { status?: number }
      return { ok: false, status: err.status ?? 500, message: err.message }
    }
  }
  async chooseProposal(id: string) {
    await this.call('chooseProposal', { id })
  }
  async approve(id: string, input: ApproveInput): Promise<ApproveResult> {
    try {
      return { ok: true, document: await this.call('approve', { id }, input, SapDocumentSchema.nullable()) }
    } catch (e) {
      const err = e as Error & { status?: number }
      return { ok: false, status: err.status ?? 500, message: err.message }
    }
  }
  async reject(id: string, input: RejectInput) {
    await this.call('reject', { id }, input)
  }
  async changeStatus(id: string, input: ChangeStatusInput) {
    await this.call('changeStatus', { id }, input)
  }
  async release(id: string, input: ReleaseInput): Promise<ReleaseResult> {
    try {
      return { ok: true, document: await this.call('release', { id }, input, SapDocumentSchema) }
    } catch (e) {
      const err = e as Error & { status?: number }
      return { ok: false, status: err.status ?? 500, message: err.message }
    }
  }
  async confirmGoodsReceipt(id: string, input: ReleaseInput): Promise<ReleaseResult> {
    try {
      return { ok: true, document: await this.call('confirmGoodsReceipt', { id }, input, SapDocumentSchema) }
    } catch (e) {
      const err = e as Error & { status?: number }
      return { ok: false, status: err.status ?? 500, message: err.message }
    }
  }
  getControlTower() {
    return this.call('controlTower', {}, undefined, SnapshotSchema)
  }
  runControlTower() {
    return this.call('controlTowerRun', {}, {}, SnapshotSchema)
  }
  askControlTower(question: string) {
    return this.call('controlTowerAsk', {}, { question }, AnswerSchema)
  }
  async getControlTowerMemo() {
    const token = await this.getToken()
    const res = await fetch(this.url(API_ROUTES.controlTowerMemo.path), { headers: token ? { authorization: `Bearer ${token}` } : {} })
    if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status })
    return res.text()
  }
  getControlTowerNotes() {
    return this.call('controlTowerNotes', {}, undefined, z.array(RoutingNoteSchema))
  }
  async handoverFinding(id: string): Promise<{ ok: true; caseId: string } | { ok: false; status: number; message: string }> {
    try {
      return await this.call('controlTowerHandover', { id }, {}, z.object({ ok: z.literal(true), caseId: z.string() }))
    } catch (e) {
      const err = e as Error & { status?: number }
      return { ok: false, status: err.status ?? 500, message: err.message }
    }
  }
  getReturnStatus(id: string) {
    return this.call('returnStatus', { id }, undefined, ReturnStatusSchema)
  }
  getAnalytics() {
    return this.call('analytics', {}, undefined, AnalyticsSchema)
  }
  runEval() {
    return this.call('runEval', {}, undefined, z.array(EvalResultSchema))
  }
  getLatestEval() {
    return this.call('latestEval', {}, undefined, z.array(EvalResultSchema).nullish()).then((v) => v ?? null)
  }
  getStatus() {
    return this.call('status', {}, undefined, AgentStatusSchema)
  }
  getSettings() {
    return this.call('getSettings', {}, undefined, SettingsSchema)
  }
  updateSettings(patch: Partial<Settings>) {
    return this.call('updateSettings', {}, patch, SettingsSchema)
  }
  async reset() {
    await this.call('reset')
  }
  subscribe(listener: (e: ApiEvent) => void) {
    if (typeof EventSource !== 'undefined') {
      // EventSource cannot send headers: the token travels as a query parameter. The app subscribes before anyone
      // signed in, so wait for a session; and when the stream drops (token expired, server restart), reconnect
      // with a fresh token.
      let es: EventSource | null = null
      let closed = false
      let timer: ReturnType<typeof setTimeout> | null = null
      const start = async () => {
        if (closed) return
        const token = await this.getToken()
        if (closed) return
        if (!token) {
          timer = setTimeout(() => void start(), 1500)
          return
        }
        es = new EventSource(`${this.base}${API_ROUTES.events.path}?token=${encodeURIComponent(token)}`)
        es.onmessage = (m) => {
          try {
            listener(JSON.parse(m.data) as ApiEvent)
          } catch {
            /* heartbeat or comment */
          }
        }
        es.onerror = () => {
          es?.close()
          es = null
          timer = setTimeout(() => void start(), 3000)
        }
      }
      void start()
      return () => {
        closed = true
        if (timer) clearTimeout(timer)
        es?.close()
      }
    }
    const t = setInterval(() => listener({ type: 'status_changed' }), 3000)
    return () => clearInterval(t)
  }
}
