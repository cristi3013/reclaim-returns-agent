import { describe, it, expect } from 'vitest'
import { DecisionSchema, SettingsSchema } from '../schemas'
describe('schemas', () => {
  it('parses a decision', () => { expect(DecisionSchema.parse({ ruleId: 'R5', documentType: 'YCR', reasonCode: '103', material: '54', quantity: 2, unit: 'KG', amount: 540, currency: 'EUR', approverRole: 'credit_manager', intercompany: false, requiresCustomerConfirmation: false, notes: '' }).amount).toBe(540) })
  it('rejects unknown status', () => { expect(() => SettingsSchema.parse({ sapMode: 'live', aiMode: 'assisted', simulateConflict: false })).toThrow() })
})

import { preferItem } from '../schemas'
describe('preferItem', () => {
  const inv = { number: '1', date: '2026-09-29', customer: '10021', customerName: 'C', salesOrg: 'YSOD', distributionChannel: 'Y1', division: 'Y5', companyCode: 'YDE1', currency: 'EUR', totalNetAmount: 0, etag: '', items: [
    { item: '10', material: '99', description: '', quantity: 1, unit: 'KG', netAmount: 10, unitPrice: 10, plant: 'YGLG', salesOrder: '1', delivery: '2' },
    { item: '20', material: '54', description: '', quantity: 5, unit: 'KG', netAmount: 1350, unitPrice: 270, plant: 'YGLG', salesOrder: '1', delivery: '2' },
  ] }
  it('moves the matching line first and keeps the rest', () => { const r = preferItem(inv, '54'); expect(r.items.map((i) => i.item)).toEqual(['20', '10']); expect(inv.items[0]!.item).toBe('10') })
  it('leaves the invoice alone when nothing matches', () => { expect(preferItem(inv, '7').items[0]!.item).toBe('10'); expect(preferItem(inv, null)).toBe(inv) })
})

import { computeAnalytics } from '../analytics'
import { buildFixtureCases } from '../fixtures/cases'
import type { Case } from '../schemas'
describe('computeAnalytics', () => {
  const base = buildFixtureCases()
  const withDecision = (c: Case, patch: Partial<Case>, ruleId: 'R5' | 'R8' | 'R7', documentType: 'YCR' | 'NONE', amount: number): Case => ({
    ...c,
    ...patch,
    proposals: [{ id: `p-${c.id}`, caseId: c.id, option: 'single', recommended: true, chosen: true, decision: { ruleId, documentType, reasonCode: documentType === 'YCR' ? '103' : null, material: '54', quantity: 2, unit: 'KG', amount, currency: 'EUR', approverRole: 'credit_manager', intercompany: false, requiresCustomerConfirmation: ruleId === 'R7', notes: '' }, sapPayload: null, explanation: '', policyCitations: [], replyDraft: '', briefing: { whatHappened: '', whatWePropose: '', risk: '' }, createdAt: '2026-10-05T07:55:00Z' }],
  })
  it('counts only what is in the cases', () => {
    const cases: Case[] = [
      withDecision(base[2]!, { status: 'written_to_sap', approvals: [{ id: 'a', proposalId: 'p-case-03', actor: 'CM', role: 'credit_manager', decision: 'approved', editedQuantity: null, comment: '', decidedAt: '2026-10-05T08:10:00Z' }], sapDocuments: [{ id: 's', caseId: 'case-03', type: 'YCR', number: '60000171', payload: {}, response: {}, createdAt: '2026-10-05T08:10:05Z', released: true }] }, 'R5', 'YCR', 540),
      withDecision(base[5]!, { status: 'duplicate' }, 'R8', 'NONE', 0),
      withDecision(base[3]!, { status: 'needs_customer_input' }, 'R7', 'NONE', 0),
      base[0]!, // received, no proposal
    ]
    const a = computeAnalytics(cases, [{ caseId: 'x', emailFile: 'x', fields: [], pass: true }], new Date('2026-10-05T09:00:00Z'))
    expect(a.totals.cases).toBe(4)
    expect(a.value).toMatchObject({ proposed: 540, approved: 540, released: 540, rejected: 0, pending: 0 })
    expect(a.approvals).toMatchObject({ approved: 1, rejected: 0, editedQuantity: 0, acceptedUnchangedRatio: 1 })
    expect(a.control).toMatchObject({ duplicatesPrevented: 1, customerConfirmations: 1, policyGaps: 0 })
    expect(a.sap).toMatchObject({ documentsCreated: 1, creditRequestsCreated: 1, released: 1 })
    expect(a.totals.byOutcome).toEqual({ 'Credit request (YCR)': 1, 'Duplicate prevented': 1, 'Customer asked to confirm or correct': 1 })
    expect(a.timing.medianMinutesToDecision).toBe(20)
    expect(a.series.bucket).toBe('hour')
    expect(a.series.points.reduce((s, p) => s + p.received, 0)).toBe(4)
    expect(a.eval).toEqual({ passed: 1, total: 1 })
  })
  it('is empty but valid with no cases', () => {
    const a = computeAnalytics([], null)
    expect(a.totals.cases).toBe(0)
    expect(a.timing.medianMinutesToProposal).toBeNull()
    expect(a.series.points).toEqual([])
  })
})

import { estimateCostUsd } from '../pricing'
describe('model usage analytics', () => {
  it('sums tokens, costs and latency per call, case, purpose and day', () => {
    const c = buildFixtureCases()[0]!
    const usage = (purpose: 'extract' | 'narrate', inputTokens: number, outputTokens: number, latencyMs: number) => ({ model: 'eu.anthropic.claude-opus-5-5', purpose, inputTokens, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, latencyMs })
    const withEvents = (id: string, at: string, u1: ReturnType<typeof usage>, u2: ReturnType<typeof usage>[]): Case => ({
      ...c, id, events: [
        { id: `e1-${id}`, caseId: id, at, l4Step: '5.1.1', kind: 'model', title: 'Facts extracted', detail: { usage: u1 }, durationMs: null },
        { id: `e2-${id}`, caseId: id, at, l4Step: '5.1.1', kind: 'model', title: 'Explanation drafted', detail: { usage: u2 }, durationMs: null },
      ],
    })
    const cases = [
      withEvents('a', '2026-10-05T10:00:00Z', usage('extract', 1000, 200, 5000), [usage('narrate', 2000, 400, 10000)]),
      withEvents('b', '2026-10-06T10:00:00Z', usage('extract', 500, 100, 4000), [usage('narrate', 1000, 200, 8000), usage('narrate', 1000, 200, 8000)]),
    ]
    const m = computeAnalytics(cases, null).model
    expect(m.calls).toBe(5)
    expect(m.casesWithModel).toBe(2)
    expect(m.inputTokens).toBe(5500)
    expect(m.outputTokens).toBe(1100)
    expect(m.avgTokensPerCall).toBe(1320)
    expect(m.avgTokensPerCase).toBe(3300)
    expect(m.maxCase?.caseId).toBe('a')
    expect(m.minCase?.caseId).toBe('b')
    expect(m.byPurpose['extract']).toMatchObject({ calls: 2, inputTokens: 1500, outputTokens: 300, avgLatencyMs: 4500 })
    expect(m.perDay.map((d) => [d.day, d.calls])).toEqual([['2026-10-05', 2], ['2026-10-06', 3]])
    expect(m.estimatedCostUsd).toBeCloseTo(estimateCostUsd({ model: 'opus-5-5', inputTokens: 5500, outputTokens: 1100, cacheReadTokens: 0, cacheWriteTokens: 0 }), 4)
    expect(m.projectedMonthlyCostUsd).toBeCloseTo((m.estimatedCostUsd / 2) * 22, 2)
  })
  it('prices by model family', () => {
    expect(estimateCostUsd({ model: 'eu.anthropic.claude-opus-5-5', inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(4)
    expect(estimateCostUsd({ model: 'claude-sonnet-4-6', inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(15)
  })
})
