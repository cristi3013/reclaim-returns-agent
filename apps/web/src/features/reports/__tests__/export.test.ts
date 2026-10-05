import { describe, it, expect, beforeEach } from 'vitest'
import ExcelJS from 'exceljs'
import { buildReport, COMPLAINT_ARCHIVE, localRootCauses, primaryProposal } from '@reclaim/shared'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { caseAuditPdf, readableDetail, rootCausesPdf, reportBlob } from '../export'

/** jsdom's Blob has no arrayBuffer(); FileReader works. */
const bytes = (b: Blob) =>
  new Promise<ArrayBuffer>((ok, fail) => {
    const fr = new FileReader()
    fr.onload = () => ok(fr.result as ArrayBuffer)
    fr.onerror = () => fail(fr.error)
    fr.readAsArrayBuffer(b)
  })

/** Runs one case through the mock to an approved SAP document, then renders the report in all three formats. */
async function report() {
  const c = new MockApiClient({ fast: true })
  await c.seedCases()
  await c.runCase('case-01')
  await c.approve(primaryProposal(await c.getCase('case-01'))!.id, { actor: 'Demo', role: 'credit_manager' })
  const cases = await Promise.all((await c.listCases()).map((s) => c.getCase(s.id)))
  return buildReport(cases, { generatedBy: 'Credit manager', sapMode: 'mock' })
}

const pdfHead = async (b: Blob) => new TextDecoder().decode(new Uint8Array(await bytes(b)).slice(0, 5))

describe('report exports', () => {
  beforeEach(() => localStorage.clear())

  it('Excel has one sheet per table, with every audit event', async () => {
    const r = await report()
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(await bytes(await reportBlob(r, 'xlsx')))
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Cases', 'Approvals', 'SAP documents', 'Audit log'])
    const events = r.tables.find((t) => t.key === 'events')!.rows
    expect(events.length).toBeGreaterThan(0)
    expect(wb.getWorksheet('Audit log')!.rowCount).toBe(events.length + 1)
    expect(wb.getWorksheet('Approvals')!.getRow(2).getCell(3).value).toBe('Demo')
  })

  it('PDF and XML are well formed', async () => {
    const r = await report()
    const pdf = new Uint8Array(await bytes(await reportBlob(r, 'pdf')))
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-')
    const xml = new TextDecoder().decode(await bytes(await reportBlob(r, 'xml')))
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(doc.querySelectorAll('AuditLog > Event').length).toBe(r.tables.find((t) => t.key === 'events')!.rows.length)
  })

  it('the case audit pack is a PDF of that one case', async () => {
    const c = new MockApiClient({ fast: true })
    await c.seedCases()
    await c.runCase('case-01')
    expect(await pdfHead(await caseAuditPdf(await c.getCase('case-01'), { generatedBy: 'Credit manager', sapMode: 'mock' }))).toBe('%PDF-')
  })

  it('the root causes report is a PDF', async () => {
    expect(await pdfHead(await rootCausesPdf(localRootCauses(COMPLAINT_ARCHIVE, new Date('2026-10-06T08:00:00Z'))))).toBe('%PDF-')
  })

  it('event detail reads as key: value lines, not raw JSON', () => {
    expect(readableDetail(JSON.stringify({ args: { invoiceNumber: '90000353' }, result: { returns: [], credits: [] }, options: [{ a: 1 }, { a: 2 }], empty: null }))).toBe('args: invoiceNumber=90000353\nresult: returns=none, credits=none\noptions: 2 items')
  })
})
