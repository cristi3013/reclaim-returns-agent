import { z } from 'zod'
import { caseOutcome, primaryProposal, type Case, type EvalResult } from './schemas'
import { estimateCostUsd, ModelUsageSchema, type ModelUsage } from './pricing'

/** Everything the Analytics page shows, computed from real cases only. Same function for backend and mock. */
export const AnalyticsSchema = z.object({
  generatedAt: z.string(),
  currency: z.string(),
  totals: z.object({
    cases: z.number(),
    last24h: z.number(),
    byChannel: z.record(z.string(), z.number()),
    byStatus: z.record(z.string(), z.number()),
    byType: z.record(z.string(), z.number()),
    byRule: z.record(z.string(), z.number()),
    byOutcome: z.record(z.string(), z.number()),
    byAiMode: z.record(z.string(), z.number()),
  }),
  value: z.object({ proposed: z.number(), approved: z.number(), released: z.number(), rejected: z.number(), pending: z.number() }),
  approvals: z.object({ approved: z.number(), rejected: z.number(), editedQuantity: z.number(), acceptedUnchangedRatio: z.number().nullable() }),
  timing: z.object({
    medianMinutesToProposal: z.number().nullable(),
    medianMinutesToDecision: z.number().nullable(),
    medianAgentSeconds: z.number().nullable(),
    oldestPendingMinutes: z.number().nullable(),
  }),
  control: z.object({ duplicatesPrevented: z.number(), intercompanyFlagged: z.number(), policyGaps: z.number(), sapConflicts: z.number(), sapWriteFailures: z.number(), customerConfirmations: z.number(), handovers: z.number() }),
  sap: z.object({ lookups: z.number(), avgLookupMs: z.number().nullable(), documentsCreated: z.number(), returnsCreated: z.number(), creditRequestsCreated: z.number(), released: z.number() }),
  series: z.object({ bucket: z.enum(['hour', 'day', 'week']), points: z.array(z.object({ label: z.string(), received: z.number(), approved: z.number(), rejected: z.number(), noDocument: z.number(), value: z.number() })) }),
  topCustomers: z.array(z.object({ customer: z.string(), name: z.string(), cases: z.number(), value: z.number() })),
  eval: z.object({ passed: z.number(), total: z.number() }).nullable(),
  /** Token usage of the model, from the audit events. Costs are list-price estimates. */
  model: z.object({
    calls: z.number(),
    casesWithModel: z.number(),
    models: z.array(z.string()),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number(),
    estimatedCostUsd: z.number(),
    avgTokensPerCall: z.number().nullable(),
    avgTokensPerCase: z.number().nullable(),
    avgCostPerCaseUsd: z.number().nullable(),
    avgLatencyMs: z.number().nullable(),
    maxCase: z.object({ caseId: z.string(), tokens: z.number(), costUsd: z.number() }).nullable(),
    minCase: z.object({ caseId: z.string(), tokens: z.number(), costUsd: z.number() }).nullable(),
    byPurpose: z.record(z.string(), z.object({ calls: z.number(), inputTokens: z.number(), outputTokens: z.number(), avgLatencyMs: z.number(), costUsd: z.number() })),
    perDay: z.array(z.object({ day: z.string(), calls: z.number(), inputTokens: z.number(), outputTokens: z.number(), costUsd: z.number() })),
    projectedMonthlyCostUsd: z.number().nullable(),
  }),
})
export type Analytics = z.infer<typeof AnalyticsSchema>

const NO_DOCUMENT: Record<string, string> = {
  needs_customer_input: 'Customer asked to confirm or correct',
  handed_over: 'Handed over for replacement',
  duplicate: 'Duplicate prevented',
  closed: 'Reply sent, no credit',
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

const inc = (m: Record<string, number>, k: string, by = 1) => {
  m[k] = (m[k] ?? 0) + by
}

const minutes = (a: string, b: string) => Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 60000)
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

export function computeAnalytics(cases: Case[], evalResults: EvalResult[] | null, now = new Date()): Analytics {
  const totals: Analytics['totals'] = { cases: cases.length, last24h: 0, byChannel: {}, byStatus: {}, byType: {}, byRule: {}, byOutcome: {}, byAiMode: {} }
  const value = { proposed: 0, approved: 0, released: 0, rejected: 0, pending: 0 }
  const approvals = { approved: 0, rejected: 0, editedQuantity: 0 }
  const control = { duplicatesPrevented: 0, intercompanyFlagged: 0, policyGaps: 0, sapConflicts: 0, sapWriteFailures: 0, customerConfirmations: 0, handovers: 0 }
  const sap = { lookups: 0, lookupMs: 0, documentsCreated: 0, returnsCreated: 0, creditRequestsCreated: 0, released: 0 }
  const toProposal: number[] = []
  const toDecision: number[] = []
  const agentSeconds: number[] = []
  let oldestPending: number | null = null
  const customers = new Map<string, { customer: string; name: string; cases: number; value: number }>()
  let currency = 'EUR'

  for (const c of cases) {
    const p = primaryProposal(c)
    const d = p?.decision
    if (d) currency = d.currency
    const amount = d?.amount ?? 0
    const intake = c.events.find((e) => e.kind === 'intake')
    const channel = String(intake?.detail.channel ?? (c.emailFile?.startsWith('0') ? 'demo' : 'manual'))
    inc(totals.byChannel, channel)
    inc(totals.byStatus, c.status)
    inc(totals.byType, c.complaintType)
    if (d) inc(totals.byRule, d.ruleId)
    inc(totals.byAiMode, c.aiMode)
    if (now.getTime() - new Date(c.receivedAt).getTime() <= 86400000) totals.last24h++

    if (d) {
      if (d.documentType !== 'NONE') inc(totals.byOutcome, d.documentType === 'YRE' ? 'Return (YRE)' : 'Credit request (YCR)')
      else inc(totals.byOutcome, NO_DOCUMENT[c.status] ?? (d.ruleId === 'NONE' ? 'Policy gap, person decides' : c.status === 'awaiting_approval' ? 'Reply proposed, awaiting approval' : 'No document'))
      if (d.intercompany) control.intercompanyFlagged++
      if (d.ruleId === 'NONE') control.policyGaps++
      if (d.requiresCustomerConfirmation) control.customerConfirmations++
      if (d.documentType !== 'NONE' && amount > 0) {
        value.proposed += amount
        if (c.status === 'awaiting_approval') value.pending += amount
        if (['approved', 'written_to_sap'].includes(c.status)) value.approved += amount
        if (caseOutcome(c) === 'rejected') value.rejected += amount
        if (c.sapDocuments.some((x) => x.released)) value.released += amount
      }
    }
    if (c.status === 'duplicate') control.duplicatesPrevented++
    if (c.status === 'handed_over') control.handovers++
    if (c.status === 'sap_write_failed') control.sapWriteFailures++
    control.sapConflicts += c.events.filter((e) => e.kind === 'error' && e.detail.status === 412).length

    for (const a of c.approvals) {
      if (a.decision === 'approved') approvals.approved++
      else approvals.rejected++
      if (a.editedQuantity != null) approvals.editedQuantity++
      toDecision.push(minutes(c.receivedAt, a.decidedAt))
    }
    if (p) toProposal.push(minutes(c.receivedAt, p.createdAt))
    const started = c.events.find((e) => e.kind === 'model' || e.kind === 'lookup' || (e.kind === 'rule' && e.title.startsWith('Facts')))
    const ended = [...c.events].reverse().find((e) => e.kind === 'status')
    if (started && ended && new Date(ended.at) > new Date(started.at)) agentSeconds.push((new Date(ended.at).getTime() - new Date(started.at).getTime()) / 1000)
    if (c.status === 'awaiting_approval') {
      const age = minutes(c.receivedAt, now.toISOString())
      oldestPending = oldestPending == null ? age : Math.max(oldestPending, age)
    }

    for (const l of c.findings?.lookups ?? []) {
      sap.lookups++
      sap.lookupMs += l.durationMs
    }
    for (const doc of c.sapDocuments) {
      sap.documentsCreated++
      if (doc.type === 'YRE') sap.returnsCreated++
      else sap.creditRequestsCreated++
      if (doc.released) sap.released++
    }

    const key = c.customer ?? 'unknown'
    const cu = customers.get(key) ?? { customer: key, name: c.customerName ?? key, cases: 0, value: 0 }
    cu.cases++
    cu.value += d && d.documentType !== 'NONE' ? amount : 0
    customers.set(key, cu)
  }

  // Time series: bucket by hour, day or week depending on the span of the data.
  const times = cases.map((c) => new Date(c.receivedAt).getTime())
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0
  const bucket: 'hour' | 'day' | 'week' = span <= 48 * 3600000 ? 'hour' : span <= 60 * 86400000 ? 'day' : 'week'
  const keyOf = (t: number) => {
    const dt = new Date(t)
    if (bucket === 'hour') return `${String(dt.getUTCHours()).padStart(2, '0')}:00`
    if (bucket === 'day') return dt.toISOString().slice(5, 10)
    const monday = new Date(t - ((dt.getUTCDay() + 6) % 7) * 86400000)
    return monday.toISOString().slice(5, 10)
  }
  const points = new Map<string, { label: string; received: number; approved: number; rejected: number; noDocument: number; value: number; t: number }>()
  for (const c of cases) {
    const t = new Date(c.receivedAt).getTime()
    const k = keyOf(t)
    const pt = points.get(k) ?? { label: k, received: 0, approved: 0, rejected: 0, noDocument: 0, value: 0, t }
    pt.received++
    pt.t = Math.min(pt.t, t)
    const d = primaryProposal(c)?.decision
    if (['approved', 'written_to_sap'].includes(c.status)) {
      pt.approved++
      pt.value += d?.amount ?? 0
    } else if (caseOutcome(c) === 'rejected') pt.rejected++
    else if (d && d.documentType === 'NONE') pt.noDocument++
    points.set(k, pt)
  }

  // Model usage, from the audit events of every case.
  const usages: { caseId: string; day: string; u: ModelUsage }[] = []
  for (const c of cases) {
    for (const e of c.events) {
      if (e.kind !== 'model') continue
      const list = Array.isArray(e.detail.usage) ? e.detail.usage : e.detail.usage ? [e.detail.usage] : []
      for (const raw of list) {
        const parsed = ModelUsageSchema.safeParse(raw)
        if (parsed.success) usages.push({ caseId: c.id, day: e.at.slice(0, 10), u: parsed.data })
      }
    }
  }
  const tokensOf = (u: ModelUsage) => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens
  const perCase = new Map<string, { tokens: number; costUsd: number }>()
  const byPurpose: Analytics['model']['byPurpose'] = {}
  const perDay = new Map<string, { day: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number }>()
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, costUsd = 0, latency = 0
  for (const { caseId, day, u } of usages) {
    const cost = estimateCostUsd(u)
    inputTokens += u.inputTokens
    outputTokens += u.outputTokens
    cacheReadTokens += u.cacheReadTokens
    costUsd += cost
    latency += u.latencyMs
    const pc = perCase.get(caseId) ?? { tokens: 0, costUsd: 0 }
    pc.tokens += tokensOf(u)
    pc.costUsd += cost
    perCase.set(caseId, pc)
    const bp = byPurpose[u.purpose] ?? { calls: 0, inputTokens: 0, outputTokens: 0, avgLatencyMs: 0, costUsd: 0 }
    bp.calls++
    bp.inputTokens += u.inputTokens
    bp.outputTokens += u.outputTokens
    bp.avgLatencyMs += u.latencyMs
    bp.costUsd += cost
    byPurpose[u.purpose] = bp
    const pd = perDay.get(day) ?? { day, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
    pd.calls++
    pd.inputTokens += u.inputTokens
    pd.outputTokens += u.outputTokens
    pd.costUsd += cost
    perDay.set(day, pd)
  }
  for (const k of Object.keys(byPurpose)) {
    const bp = byPurpose[k]!
    bp.avgLatencyMs = Math.round(bp.avgLatencyMs / bp.calls)
    bp.costUsd = round(bp.costUsd, 4)
  }
  const caseEntries = [...perCase.entries()].map(([caseId, v]) => ({ caseId, tokens: v.tokens, costUsd: round(v.costUsd, 4) }))
  const maxCase = caseEntries.length ? caseEntries.reduce((a, b) => (b.tokens > a.tokens ? b : a)) : null
  const minCase = caseEntries.length ? caseEntries.reduce((a, b) => (b.tokens < a.tokens ? b : a)) : null
  const totalTokens = usages.reduce((s, x) => s + tokensOf(x.u), 0)
  const activeDays = perDay.size
  const model: Analytics['model'] = {
    calls: usages.length,
    casesWithModel: perCase.size,
    models: [...new Set(usages.map((x) => x.u.model))],
    inputTokens,
    outputTokens,
    cacheReadTokens,
    estimatedCostUsd: round(costUsd, 4),
    avgTokensPerCall: usages.length ? Math.round(totalTokens / usages.length) : null,
    avgTokensPerCase: perCase.size ? Math.round(totalTokens / perCase.size) : null,
    avgCostPerCaseUsd: perCase.size ? round(costUsd / perCase.size, 4) : null,
    avgLatencyMs: usages.length ? Math.round(latency / usages.length) : null,
    maxCase,
    minCase,
    byPurpose,
    perDay: [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ ...d, costUsd: round(d.costUsd, 4) })),
    projectedMonthlyCostUsd: activeDays ? round((costUsd / activeDays) * 22, 2) : null,
  }

  const decided = approvals.approved + approvals.rejected
  return {
    generatedAt: now.toISOString(),
    currency,
    totals,
    value: { proposed: round(value.proposed, 2), approved: round(value.approved, 2), released: round(value.released, 2), rejected: round(value.rejected, 2), pending: round(value.pending, 2) },
    approvals: { ...approvals, acceptedUnchangedRatio: decided ? round((approvals.approved - approvals.editedQuantity) / decided, 3) : null },
    timing: {
      medianMinutesToProposal: median(toProposal) == null ? null : round(median(toProposal)!),
      medianMinutesToDecision: median(toDecision) == null ? null : round(median(toDecision)!),
      medianAgentSeconds: median(agentSeconds) == null ? null : round(median(agentSeconds)!),
      oldestPendingMinutes: oldestPending == null ? null : round(oldestPending),
    },
    control,
    sap: { lookups: sap.lookups, avgLookupMs: sap.lookups ? Math.round(sap.lookupMs / sap.lookups) : null, documentsCreated: sap.documentsCreated, returnsCreated: sap.returnsCreated, creditRequestsCreated: sap.creditRequestsCreated, released: sap.released },
    series: { bucket, points: [...points.values()].sort((a, b) => a.t - b.t).map(({ t: _t, ...p }) => p) },
    topCustomers: [...customers.values()].sort((a, b) => b.cases - a.cases || b.value - a.value).slice(0, 5),
    eval: evalResults ? { passed: evalResults.filter((r) => r.pass).length, total: evalResults.length } : null,
    model,
  }
}
