import { describe, it, expect, beforeEach } from 'vitest'
import { EXPECTED, primaryProposal } from '@reclaim/shared'
import { MockApiClient } from '../MockApiClient'

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
    const r = await c.approve(primaryProposal(await c.getCase('case-03'))!.id, { actor: 'FD', role: 'finance_director', editedQuantity: 99 })
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
    const r = await c.release(d.id, cm)
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

  it('unknown .eml with no invoice becomes a received case that runs to Pending', async () => {
    const c = await mk()
    const f = new File(['From: x@y.example\nSubject: Something odd\n\nHello, the labels on the drums are wrong.'], 'other.eml', { type: 'message/rfc822' })
    const [s] = await c.ingest([f])
    expect(s!.status).toBe('received')
    await c.runCase(s!.id)
    const k = await c.getCase(s!.id)
    expect(primaryProposal(k)!.decision.ruleId).toBe('NONE')
    // No invoice named and none found: we ask the customer, so the case waits for them (Pending).
    expect(k.status).toBe('needs_customer_input')
  })

  it('eval reports 8 of 8 after running everything', async () => {
    const c = await mk()
    const res = await c.runEval()
    expect(res).toHaveLength(8)
    expect(res.every((r) => r.pass)).toBe(true)
  })
})

describe('review fixes', () => {
  beforeEach(() => localStorage.clear())

  it('a case with a SAP document cannot be re-run, and keeps its audit trail', async () => {
    const c = await mk()
    await c.runCase('case-03')
    await c.approve(primaryProposal(await c.getCase('case-03'))!.id, cm)
    await expect(c.runCase('case-03')).rejects.toMatchObject({ status: 409 })
    const k = await c.getCase('case-03')
    expect(k.status).toBe('written_to_sap')
    expect(k.sapDocuments).toHaveLength(1)
    expect(k.events.some((e) => e.kind === 'sap_write')).toBe(true)
  })

  it('editing the quantity up re-routes the approver and refuses a lower role', async () => {
    const c = await mk()
    await c.runCase('case-03')
    const id = primaryProposal(await c.getCase('case-03'))!.id
    const r = await c.approve(id, { ...cm, editedQuantity: 20 })
    expect(r).toMatchObject({ ok: false, status: 403 })
    const k = await c.getCase('case-03')
    expect(k.status).toBe('awaiting_approval')
    // A refused approval changes nothing.
    expect(primaryProposal(k)!.decision).toMatchObject({ approverRole: 'credit_manager', amount: 540 })
    const r2 = await c.approve(id, { actor: 'FD', role: 'finance_director', editedQuantity: 20 })
    expect(r2.ok).toBe(true)
    expect(primaryProposal(await c.getCase('case-03'))!.decision).toMatchObject({ approverRole: 'finance_director', amount: 5400 })
  })

  it('YRE payload carries billing block 08', async () => {
    const c = await mk()
    await c.runCase('case-08')
    expect(primaryProposal(await c.getCase('case-08'))!.sapPayload).toMatchObject({ CustomerReturnType: 'YRE', HeaderBillingBlockReason: '08' })
  })

  it('runEval does not crash while a case is mid-run', async () => {
    const c = await mk()
    const running = c.runCase('case-01')
    const res = await c.runEval()
    expect(res.find((r) => r.caseId === 'case-01')!.pass).toBe(false)
    await running
  })

  it('reject and choose are refused once a case is no longer awaiting approval', async () => {
    const c = await mk()
    await c.runCase('case-03')
    const id = primaryProposal(await c.getCase('case-03'))!.id
    await c.approve(id, cm)
    await expect(c.reject(id, { ...cm, comment: 'late' })).rejects.toMatchObject({ status: 409 })
    await expect(c.chooseProposal(id)).rejects.toMatchObject({ status: 409 })
    expect((await c.getCase('case-03')).status).toBe('written_to_sap')
  })
})

describe('audit fixes (mock mirrors the backend)', () => {
  beforeEach(() => localStorage.clear())
  it('a refused approval leaves the proposal unchanged and quantity 0 is rejected', async () => {
    const c = await mk()
    await c.runCase('case-03')
    const before = primaryProposal(await c.getCase('case-03'))!
    expect(await c.approve(before.id, { actor: 'RD', role: 'returns_desk', editedQuantity: 0 })).toMatchObject({ ok: false, status: 400 })
    expect(await c.approve(before.id, { ...cm, editedQuantity: 20 })).toMatchObject({ ok: false, status: 403 })
    const after = primaryProposal(await c.getCase('case-03'))!
    expect(after.decision).toEqual(before.decision)
  })
  it('release: role, once, goods receipt for a return', async () => {
    const c = await mk()
    await c.runCase('case-08')
    const r = await c.approve(primaryProposal(await c.getCase('case-08'))!.id, cm)
    const d = r.ok ? r.document! : null
    expect(d?.type).toBe('YRE')
    expect(await c.release(d!.id, { actor: 'RD', role: 'returns_desk' })).toMatchObject({ ok: false, status: 403 })
    expect(await c.release(d!.id, cm)).toMatchObject({ ok: false, status: 409 })
    expect(await c.confirmGoodsReceipt(d!.id, cm)).toMatchObject({ ok: false, status: 403 })
    expect((await c.confirmGoodsReceipt(d!.id, { actor: 'RD', role: 'returns_desk' })).ok).toBe(true)
    expect(await c.confirmGoodsReceipt(d!.id, { actor: 'RD', role: 'returns_desk' })).toMatchObject({ ok: false, status: 409 })
    expect((await c.release(d!.id, cm)).ok).toBe(true)
    expect(await c.release(d!.id, cm)).toMatchObject({ ok: false, status: 409 })
    expect((await c.getCase('case-08')).events.some((e) => e.kind === 'goods_receipt' && e.l4Step === '5.1.3')).toBe(true)
  })
  it('closed cases cannot be re-run', async () => {
    const c = await mk()
    await c.runCase('case-02')
    await c.approve(primaryProposal(await c.getCase('case-02'))!.id, cm)
    await expect(c.runCase('case-02')).rejects.toMatchObject({ status: 409 })
  })
})

it('rejecting needs the approver role and a reason', async () => {
  const c = new MockApiClient({ fast: true })
  await c.seedCases()
  await c.runCase('case-03')
  const p = primaryProposal(await c.getCase('case-03'))!
  await expect(c.reject(p.id, { actor: 'CS', role: 'customer_service_lead', comment: 'no' })).rejects.toMatchObject({ status: 403 })
  await expect(c.reject(p.id, { ...cm, comment: ' ' })).rejects.toMatchObject({ status: 400 })
  expect((await c.getCase('case-03')).status).toBe('awaiting_approval')
  await c.reject(p.id, { ...cm, comment: 'Delivery note signed for 20 KG' })
  expect((await c.getCase('case-03')).status).toBe('closed')
})
