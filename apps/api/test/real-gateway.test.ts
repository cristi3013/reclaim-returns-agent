import { describe, it, expect, afterEach, vi } from 'vitest'
import { RealGateway } from '../src/gateway/real'

/**
 * RealGateway against the gateway contract (/odata/v4/returns), with fetch stubbed:
 * checks the URL and body of each call and how the answers are read. No network.
 */
const BASE = 'https://gw.example/odata/v4/returns'
const calls: { url: string; method: string; body: unknown }[] = []

function stub(answer: (url: string) => unknown) {
  calls.length = 0
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify({ value: JSON.stringify(answer(url)) }), { status: 200 })
  })
}
afterEach(() => vi.unstubAllGlobals())

const gw = () => new RealGateway(BASE)
const ctx = (rule: string) => ({ rule, gatewayLogId: 'log-1', creditValue: 540, evidenceUrl: 'https://api.example/uploads/photo.jpg' })
const ycr = (reason: string, invoice = '90001234') => ({
  ReferenceSDDocument: invoice,
  SDDocumentReason: reason,
  SoldToParty: '1000123',
  to_Item: [{ Material: 'MAT-1', RequestedQuantity: '5', RequestedQuantityUnit: 'KG' }],
})

describe('RealGateway', () => {
  it('getAgreedPrice sends the contract parameter names and divides by the condition quantity', async () => {
    stub(() => ({ soldToParty: '1000123', material: 'MAT-1', today: '2026-10-05', agreedPrices: [{ ConditionRateValue: '250', ConditionQuantity: '100' }] }))
    const price = await gw().getAgreedPrice({ customer: '1000123', material: 'MAT-1', salesOrg: 'YDE1', channel: '10' })
    expect(calls[0]?.url).toBe(`${BASE}/getAgreedPrice(soldToParty='1000123',material='MAT-1',salesOrganization='YDE1',distributionChannel='10')`)
    expect(price).toBe(2.5)
  })

  it('escapes single quotes in function parameters', async () => {
    stub(() => null)
    await gw().getAgreedPrice({ customer: "O'Brien", material: 'M', salesOrg: 'S', channel: 'C' })
    expect(calls[0]?.url).toContain(`soldToParty='O${encodeURIComponent("''")}Brien'`)
  })

  it('findInvoices uses soldToParty/fromDate/toDate and reads the live {invoices:[…]} shape without re-reading', async () => {
    const raw = { BillingDocument: '90000357', BillingDocumentDate: '/Date(1790640000000)/', SoldToParty: '10021', SalesOrganization: 'YSOD', DistributionChannel: 'Y1', Division: 'Y5', CompanyCode: 'YDE1', TransactionCurrency: 'EUR', TotalNetAmount: '4050.00', __metadata: { etag: 'W/"e"' }, to_Item: { results: [{ BillingDocumentItem: '10', Material: '54', BillingQuantity: '15.000', BillingQuantityUnit: 'KG', NetAmount: '4050.00', Plant: 'YGLG', SalesDocument: '1614', ReferenceSDDocument: '80608804' }] } }
    stub(() => ({ soldToParty: '10021', invoices: [raw] }))
    const r = await gw().findInvoices({ customer: '1000123', material: 'MAT-1', dateFrom: '2026-09-01', dateTo: '2026-10-05' })
    expect(calls[0]?.url).toBe(`${BASE}/findInvoices(soldToParty='1000123',material='MAT-1',fromDate='2026-09-01',toDate='2026-10-05')`)
    expect(calls).toHaveLength(1)
    expect(r[0]).toMatchObject({ number: '90000357', date: '2026-09-29', etag: 'W/"e"', items: [{ quantity: 15, unitPrice: 270 }] })
  })

  it('getAgreedPrice returns null when the live list is empty', async () => {
    stub(() => ({ soldToParty: '10021', agreedPrices: [] }))
    expect(await gw().getAgreedPrice({ customer: '10021', material: '54', salesOrg: 'YSOD', channel: 'Y1' })).toBeNull()
  })

  it('createCreditMemoRequest sends the rule, the approval record and the credit value, and keeps the version stamp', async () => {
    stub(() => ({ CreditMemoRequest: '60000200', HeaderBillingBlockReason: '08', __metadata: { etag: 'W/"x1"' } }))
    const r = await gw().createCreditMemoRequest(ycr('101'), ctx('R4'))
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${BASE}/createCreditMemoRequest` })
    expect(calls[0]?.body).toEqual({ auditLogID: 'log-1', invoiceNumber: '90001234', material: 'MAT-1', quantity: '5', unit: 'KG', rule: 'R4', soldToParty: '1000123', creditValue: 540, evidenceUrl: 'https://api.example/uploads/photo.jpg' })
    expect(r).toMatchObject({ ok: true, number: '60000200', etag: 'W/"x1"' })
  })

  it('createReturn sends the rule and the approval record', async () => {
    stub(() => ({ CustomerReturn: '60000300', __metadata: { etag: 'W/"r1"' } }))
    const yre = { SoldToParty: '1000123', SDDocumentReason: '102', to_Item: [{ ReferenceSDDocument: '90001234', ReferenceSDDocumentItem: '10', Material: 'MAT-1', RequestedQuantity: '2', RequestedQuantityUnit: 'KG' }] }
    const r = await gw().createReturn(yre, ctx('R1'))
    expect(calls[0]?.body).toEqual({ auditLogID: 'log-1', invoiceNumber: '90001234', invoiceItem: '10', material: 'MAT-1', quantity: '2', unit: 'KG', rule: 'R1', soldToParty: '1000123', creditValue: 540 })
    expect(r).toMatchObject({ ok: true, number: '60000300', etag: 'W/"r1"' })
  })

  it('refuses a rule whose document or reason does not match, without calling the gateway', async () => {
    stub(() => ({}))
    expect(await gw().createCreditMemoRequest(ycr('104'), ctx('R5'))).toMatchObject({ ok: false, status: 400 }) // R5 is 103
    expect(await gw().createCreditMemoRequest(ycr('101'), ctx('R2'))).toMatchObject({ ok: false, status: 400 }) // R2 creates a YRE
    expect(await gw().createCreditMemoRequest(ycr('101'), ctx('R8'))).toMatchObject({ ok: false, status: 400 }) // no document
    expect(await gw().createCreditMemoRequest(ycr('101'), { ...ctx('R4'), gatewayLogId: '' })).toMatchObject({ ok: false, status: 400 })
    expect(calls).toHaveLength(0)
  })

  it('refuses demo invoices before any call', async () => {
    stub(() => ({}))
    const r = await gw().createCreditMemoRequest(ycr('101', '90000355'), ctx('R4'))
    expect(r).toMatchObject({ ok: false, status: 400 })
    expect(calls).toHaveLength(0)
  })

  it('release sends the document number and versionStamp to the action for its type; refuses without a stamp', async () => {
    stub(() => ({ status: 'RELEASED' }))
    expect(await gw().release({ type: 'YCR', number: '60000200', etag: 'W/"x1"' })).toMatchObject({ ok: true })
    expect(calls[0]).toMatchObject({ url: `${BASE}/releaseCreditMemoRequest`, body: { creditMemoNumber: '60000200', versionStamp: 'W/"x1"' } })
    expect(await gw().release({ type: 'YRE', number: '60000201', etag: 'W/"x2"' })).toMatchObject({ ok: true })
    expect(calls[1]).toMatchObject({ url: `${BASE}/releaseCustomerReturn`, body: { returnDocumentNumber: '60000201', versionStamp: 'W/"x2"' } })
    expect(await gw().release({ type: 'YCR', number: '60000200', etag: '' })).toMatchObject({ ok: false, status: 409 })
    expect(calls).toHaveLength(2)
  })

  it('getReturnStatus reads the warehouse receipt', async () => {
    stub(() => ({ returnDocumentNumber: '60000300', overallProcessingStatus: 'A', warehouseReceiptStatus: 'C', received: true }))
    expect(await gw().getReturnStatus('60000300')).toEqual({ status: 'C', received: true })
    expect(calls[0]?.url).toBe(`${BASE}/getReturnStatus(returnDocumentNumber='60000300')`)
  })

  it('a Cloud Foundry "unknown route" 404 is reported as gateway unavailable, not as a missing invoice', async () => {
    calls.length = 0
    vi.stubGlobal('fetch', async () => new Response('404 Not Found: Requested route does not exist.', { status: 404, headers: { 'x-cf-routererror': 'unknown_route' } }))
    await expect(gw().getInvoice('90000353')).rejects.toMatchObject({ status: 503 })
    const w = await gw().createCreditMemoRequest(ycr('101'), ctx('R4'))
    expect(w).toMatchObject({ ok: false, status: 503 })
  })

  it('an invoice SAP cannot have is "not found", so the rules still propose; an outage still fails', async () => {
    calls.length = 0
    let status = 400
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push({ url, method: 'GET', body: undefined })
      return new Response('{"error":{"message":"getInvoice failed: Malformed URI literal syntax"}}', { status })
    })
    expect(await gw().getInvoice('900003539999')).toBeNull()
    expect(calls).toHaveLength(0)
    expect(await gw().getInvoice('INV-77')).toBeNull()
    expect(calls).toHaveLength(0)
    expect(await gw().getInvoice('90000399')).toBeNull()
    expect(calls).toHaveLength(1)
    status = 500
    await expect(gw().getInvoice('90000399')).rejects.toMatchObject({ status: 500 })
  })

  it('logRequest and setApprovalStatus carry the rule, the claim, the approver, and read the record ID', async () => {
    stub((url) => (url.endsWith('logRequest') ? { ID: 'abc', approvalStatus: 'PENDING' } : { ID: 'abc', approvalStatus: 'APPROVED' }))
    const log = await gw().logRequest({ invoiceNumber: '90001234', proposedAction: 'CREDIT', rule: 'R5', reason: 'Short delivery', claimedQuantity: 2, claimedAmount: 540, creditValue: 540 })
    expect(log).toMatchObject({ ok: true, id: 'abc' })
    expect(calls[0]?.body).toEqual({ invoiceNumber: '90001234', proposedAction: 'CREDIT', rule: 'R5', reason: 'Short delivery', claimedQuantity: 2, claimedAmount: 540, creditValue: 540, evidenceUrl: null })
    await gw().setApprovalStatus({ id: 'abc', status: 'APPROVED', approvedBy: 'Demo', approverRole: 'credit_manager' })
    expect(calls[1]?.body).toEqual({ ID: 'abc', status: 'APPROVED', approvedBy: 'Demo', approverRole: 'credit_manager' })
  })
})
