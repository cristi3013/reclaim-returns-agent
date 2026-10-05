import { describe, it, expect } from 'vitest'
import { buildFixtureCases } from '../fixtures/cases'
import { buildReport, filterCasesByPeriod, reportFileName, reportToXml } from '../report'
import type { Case } from '../schemas'

const decision = { ruleId: 'R3', documentType: 'YCR', reasonCode: '104', material: '54', quantity: 2, unit: 'KG', amount: 540, currency: 'EUR', approverRole: 'credit_manager', intercompany: false, requiresCustomerConfirmation: false, notes: '' } as const
const briefing = { whatHappened: '', whatWePropose: '', risk: '' }

function sample(): Case[] {
  const [a, b] = buildFixtureCases() as [Case, Case]
  const done: Case = {
    ...a,
    id: 'case-a',
    receivedAt: '2026-10-02T09:00:00.000Z',
    status: 'written_to_sap',
    from: 'Ops <ops@cust.example> & "Co"',
    proposals: [{ id: 'p1', caseId: 'case-a', option: 'single', recommended: true, chosen: true, decision, sapPayload: null, explanation: '', policyCitations: [], replyDraft: '', briefing, createdAt: '2026-10-02T09:01:00.000Z' }],
    approvals: [{ id: 'ap1', proposalId: 'p1', actor: 'Dana', role: 'credit_manager', decision: 'approved', editedQuantity: null, comment: 'ok <fine>', decidedAt: '2026-10-02T09:05:00.000Z' }],
    sapDocuments: [{ id: 's1', caseId: 'case-a', type: 'YCR', number: '60000200', payload: {}, response: {}, createdAt: '2026-10-02T09:05:01.000Z', released: true, gatewayLogId: 'log-1' }],
    events: [
      { id: 'e2', caseId: 'case-a', at: '2026-10-02T09:05:01.000Z', l4Step: '5.2.1', kind: 'sap_write', title: 'Credit memo request created', detail: { number: '60000200' }, durationMs: 420 },
      { id: 'e1', caseId: 'case-a', at: '2026-10-02T09:00:00.000Z', l4Step: null, kind: 'intake', title: 'Email received', detail: {}, durationMs: null },
    ],
  }
  return [done, { ...b, id: 'case-b', receivedAt: '2026-09-20T10:00:00.000Z' }]
}

describe('buildReport', () => {
  it('builds the five tables from the cases, audit log in time order with L4 names', () => {
    const r = buildReport(sample(), { now: new Date('2026-10-05T12:00:00Z'), generatedBy: 'Dana', sapMode: 'mock' })
    expect(r.tables.map((t) => t.key)).toEqual(['summary', 'cases', 'approvals', 'sapDocuments', 'events'])
    expect(r.meta).toMatchObject({ caseCount: 2, generatedBy: 'Dana', sapMode: 'mock', generatedAt: '2026-10-05T12:00:00.000Z' })
    const cases = r.tables[1]!.rows
    expect(cases.map((c) => c.id)).toEqual(['case-b', 'case-a'])
    expect(cases[1]).toMatchObject({ rule: 'R3', document: 'YCR', amount: 540, approverRole: 'Credit manager', status: 'Processed', sapDocuments: 'YCR 60000200' })
    expect(r.tables[2]!.rows[0]).toMatchObject({ actor: 'Dana', decision: 'approved', rule: 'R3', amount: 540 })
    expect(r.tables[3]!.rows[0]).toMatchObject({ number: '60000200', released: true, gatewayLogId: 'log-1' })
    const events = r.tables[4]!.rows
    expect(events.map((e) => e.title)).toEqual(['Email received', 'Credit memo request created'])
    expect(events[1]).toMatchObject({ l4Step: '5.2.1', detail: '{"number":"60000200"}' })
    expect(events[1]!.l4Name).toBeTruthy()
  })

  it('filters by period, dates inclusive', () => {
    expect(filterCasesByPeriod(sample(), '2026-10-01', '2026-10-02').map((c) => c.id)).toEqual(['case-a'])
    const r = buildReport(sample(), { from: '2026-09-01', to: '2026-09-30', now: new Date('2026-10-05T12:00:00Z') })
    expect(r.meta.caseCount).toBe(1)
    expect(r.tables[4]!.rows).toHaveLength(0)
    expect(reportFileName(r)).toBe('reclaim-audit-2026-09-01_2026-09-30')
  })
})

describe('reportToXml', () => {
  it('escapes text and nests one element per row', () => {
    const xml = reportToXml(buildReport(sample(), { now: new Date('2026-10-05T12:00:00Z') }))
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<ReclaimAuditReport ')).toBe(true)
    expect(xml).toContain('<from>Ops &lt;ops@cust.example&gt; &amp; &quot;Co&quot;</from>')
    expect(xml).toContain('<comment>ok &lt;fine&gt;</comment>')
    expect(xml).toContain('<AuditLog count="2">')
    expect(xml).toContain('<SapDocuments count="1">')
    expect(xml.match(/<Event>/g)).toHaveLength(2)
  })
})
