import { describe, it, expect, beforeEach } from 'vitest'
import { primaryProposal } from '@reclaim/shared'
import { MockApiClient } from '../MockApiClient'
import { EXPECTED } from '../fixtures/expected'

const mk = async () => {
  const c = new MockApiClient({ fast: true })
  await c.seedCases()
  return c
}
const cm = { actor: 'Demo', role: 'credit_manager' as const }

describe('mock pipeline', () => {
  beforeEach(() => localStorage.clear())

  it('every fixture case matches the oracle', async () => {
    const c = await mk()
    await c.runCase('case-01')
    await c.approve(primaryProposal(await c.getCase('case-01'))!.id, cm)
    for (const id of Object.keys(EXPECTED)) {
      if (id !== 'case-01') await c.runCase(id)
      const k = await c.getCase(id)
      const e = EXPECTED[id]!
      const p = primaryProposal(k)!
      expect([
        id,
        p.decision.ruleId,
        p.decision.documentType,
        p.decision.reasonCode ?? '',
        p.decision.quantity,
        p.decision.amount,
        p.decision.approverRole ?? '',
      ]).toEqual([id, e.rule, e.document, e.reason, e.quantity, e.amount, e.approver])
      if (id !== 'case-01') expect(k.status).toBe(e.status)
      if (e.optionA) {
        expect(k.proposals.find((x) => x.option === 'A')!.decision).toMatchObject({
          ruleId: e.optionA.rule,
          documentType: e.optionA.document,
          reasonCode: e.optionA.reason,
        })
      }
    }
  })

  it('approve writes a YCR with block 08 and the exact payload', async () => {
    const c = await mk()
    await c.runCase('case-03')
    const p = primaryProposal(await c.getCase('case-03'))!
    const r = await c.approve(p.id, cm)
    expect(r.ok).toBe(true)
    const k = await c.getCase('case-03')
    expect(k.status).toBe('written_to_sap')
    expect(k.sapDocuments[0]!.payload).toEqual(p.sapPayload)
    expect(k.sapDocuments[0]!.payload).toMatchObject({
      CreditMemoRequestType: 'YCR',
      HeaderBillingBlockReason: '08',
      ReferenceSDDocument: '90000355',
    })
    expect(k.events.some((e) => e.l4Step === '5.2.1' && e.kind === 'sap_write')).toBe(true)
  })

  it('simulateConflict yields 412 and sap_write_failed', async () => {
    const c = await mk()
    await c.updateSettings({ simulateConflict: true })
    await c.runCase('case-03')
    const r = await c.approve(primaryProposal(await c.getCase('case-03'))!.id, cm)
    expect(r).toMatchObject({ ok: false, status: 412 })
    const k = await c.getCase('case-03')
    expect(k.status).toBe('sap_write_failed')
    expect(k.sapDocuments).toHaveLength(0)
  })

  it('approve twice concurrently creates one document', async () => {
    const c = await mk()
    await c.runCase('case-03')
    const id = primaryProposal(await c.getCase('case-03'))!.id
    const [a, b] = await Promise.all([c.approve(id, { actor: 'A', role: 'credit_manager' }), c.approve(id, { actor: 'B', role: 'credit_manager' })])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expect((await c.getCase('case-03')).sapDocuments).toHaveLength(1)
  })

  it('edited quantity is capped and amount recomputed', async () => {
    const c = await mk()
    await c.runCase('case-03')
    const r = await c.approve(primaryProposal(await c.getCase('case-03'))!.id, { ...cm, editedQuantity: 99 })
    expect(r.ok && r.document?.payload).toMatchObject({ to_Item: [{ RequestedQuantity: '20' }] })
    const k = await c.getCase('case-03')
    expect(k.approvals[0]!.editedQuantity).toBe(20)
    expect(primaryProposal(k)!.decision.amount).toBe(5400)
  })

  it('case 06 before case 01 is written: duplicate referencing the open case', async () => {
    const c = await mk()
    await c.runCase('case-01')
    await c.runCase('case-06')
    const k = await c.getCase('case-06')
    expect(k.status).toBe('duplicate')
    expect(primaryProposal(k)!.decision.notes).toContain('case-01')
  })

  it('approving a NONE proposal closes the case without SAP', async () => {
    const c = await mk()
    await c.runCase('case-02')
    const r = await c.approve(primaryProposal(await c.getCase('case-02'))!.id, cm)
    expect(r.ok).toBe(true)
    const k = await c.getCase('case-02')
    expect(k.status).toBe('closed')
    expect(k.sapDocuments).toHaveLength(0)
  })

  it('rules_only mode produces the same decisions without model events', async () => {
    const c = await mk()
    await c.updateSettings({ aiMode: 'rules_only' })
    await c.runCase('case-03')
    const k = await c.getCase('case-03')
    expect(primaryProposal(k)!.decision.ruleId).toBe('R5')
    expect(k.events.some((e) => e.kind === 'model')).toBe(false)
    expect(k.aiMode).toBe('rules_only')
  })

  it('release removes the block', async () => {
    const c = await mk()
    await c.runCase('case-03')
    await c.approve(primaryProposal(await c.getCase('case-03'))!.id, cm)
    const d = (await c.getCase('case-03')).sapDocuments[0]!
    const r = await c.release(d.id)
    expect(r.ok).toBe(true)
    expect((await c.getCase('case-03')).sapDocuments[0]!.released).toBe(true)
  })

  it('restore resets transient statuses', async () => {
    const c = await mk()
    const k = c._store().cases.get('case-03')!
    k.status = 'investigating'
    c._store().save()
    const d = new MockApiClient({ fast: true })
    expect((await d.getCase('case-03')).status).toBe('received')
  })

  it('unknown .eml becomes a received case that runs to a policy-gap proposal', async () => {
    const c = await mk()
    const f = new File(['From: x@y.example\nSubject: Something odd\n\nHello, the labels on the drums are wrong.'], 'other.eml', { type: 'message/rfc822' })
    const [s] = await c.ingest([f])
    expect(s!.status).toBe('received')
    await c.runCase(s!.id)
    const k = await c.getCase(s!.id)
    expect(primaryProposal(k)!.decision.ruleId).toBe('NONE')
    expect(k.status).toBe('awaiting_approval')
  })

  it('eval reports 8 of 8 after running everything', async () => {
    const c = await mk()
    const res = await c.runEval()
    expect(res).toHaveLength(8)
    expect(res.every((r) => r.pass)).toBe(true)
  })
})
