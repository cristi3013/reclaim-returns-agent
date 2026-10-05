import { computeAnalytics, type Analytics } from './analytics'
import { COMPLAINT_LABELS, ROLE_LABELS, STATUS_LABELS } from './enums'
import { L4_STEPS, RULES } from './policy'
import { primaryProposal, type Case } from './schemas'

/**
 * The audit report: one table model that the Excel, PDF and XML exports all render, so the three
 * files always carry the same numbers. Pure; the browser and the backend can both call it.
 */
export type ReportCell = string | number | boolean | null

export interface ReportColumn {
  key: string
  label: string
  /** Rough width in characters, used by the Excel and PDF writers. */
  width?: number
  money?: boolean
}

export interface ReportTable {
  key: 'summary' | 'cases' | 'approvals' | 'sapDocuments' | 'events'
  title: string
  columns: ReportColumn[]
  rows: Record<string, ReportCell>[]
}

export interface ReportMeta {
  title: string
  generatedAt: string
  generatedBy: string
  sapMode: string
  from: string | null
  to: string | null
  currency: string
  caseCount: number
}

export interface Report {
  meta: ReportMeta
  analytics: Analytics
  tables: ReportTable[]
}

export interface ReportOptions {
  /** Inclusive ISO date (YYYY-MM-DD) or timestamp, compared with the case's receivedAt. */
  from?: string | null
  to?: string | null
  generatedBy?: string
  sapMode?: string
  title?: string
  now?: Date
}

const day = (s: string) => s.slice(0, 10)

/** Cases received inside [from, to], dates inclusive. */
export function filterCasesByPeriod(cases: Case[], from?: string | null, to?: string | null): Case[] {
  return cases.filter((c) => (!from || day(c.receivedAt) >= day(from)) && (!to || day(c.receivedAt) <= day(to)))
}

export function buildReport(allCases: Case[], opts: ReportOptions = {}): Report {
  const now = opts.now ?? new Date()
  const cases = filterCasesByPeriod(allCases, opts.from, opts.to).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
  const analytics = computeAnalytics(cases, null, now)
  const meta: ReportMeta = {
    title: opts.title ?? 'Reclaim · Returns & credit notes audit report',
    generatedAt: now.toISOString(),
    generatedBy: opts.generatedBy ?? 'Reclaim',
    sapMode: opts.sapMode ?? 'unknown',
    from: opts.from ?? null,
    to: opts.to ?? null,
    currency: analytics.currency,
    caseCount: cases.length,
  }

  const proposals = new Map(cases.flatMap((c) => c.proposals.map((p) => [p.id, p] as const)))
  const v = analytics.value
  const summary: ReportTable = {
    key: 'summary',
    title: 'Summary',
    columns: [{ key: 'metric', label: 'Metric', width: 40 }, { key: 'value', label: 'Value', width: 20 }],
    rows: ([
      ['Cases', analytics.totals.cases],
      [`Value proposed (${meta.currency})`, v.proposed],
      [`Value approved (${meta.currency})`, v.approved],
      [`Value released in SAP (${meta.currency})`, v.released],
      [`Value rejected (${meta.currency})`, v.rejected],
      [`Value pending approval (${meta.currency})`, v.pending],
      ['Approvals', analytics.approvals.approved],
      ['Rejections', analytics.approvals.rejected],
      ['Quantity edited by approver', analytics.approvals.editedQuantity],
      ['Median minutes to proposal', analytics.timing.medianMinutesToProposal],
      ['Median minutes to decision', analytics.timing.medianMinutesToDecision],
      ['SAP documents created', analytics.sap.documentsCreated],
      ['SAP documents released', analytics.sap.released],
      ['Duplicates prevented', analytics.control.duplicatesPrevented],
      ['Intercompany flagged', analytics.control.intercompanyFlagged],
      ['SAP write failures', analytics.control.sapWriteFailures],
      ['Handovers to a person', analytics.control.handovers],
      ...Object.entries(analytics.totals.byStatus).map(([s, n]): [string, number] => [`Status: ${STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s}`, n]),
      ...Object.entries(analytics.totals.byRule).map(([r, n]): [string, number] => [`Rule ${r}: ${RULES[r as keyof typeof RULES]?.situation ?? ''}`, n]),
    ] as [string, number | null][]).map(([metric, value]) => ({ metric, value })),
  }

  const casesTable: ReportTable = {
    key: 'cases',
    title: 'Cases',
    columns: [
      { key: 'id', label: 'Case', width: 14 },
      { key: 'receivedAt', label: 'Received', width: 18 },
      { key: 'from', label: 'From', width: 26 },
      { key: 'customer', label: 'Customer', width: 10 },
      { key: 'customerName', label: 'Customer name', width: 22 },
      { key: 'invoice', label: 'Invoice', width: 11 },
      { key: 'complaint', label: 'Complaint', width: 18 },
      { key: 'rule', label: 'Rule', width: 6 },
      { key: 'document', label: 'Document', width: 9 },
      { key: 'reason', label: 'Reason', width: 7 },
      { key: 'quantity', label: 'Qty', width: 7 },
      { key: 'amount', label: 'Amount', width: 11, money: true },
      { key: 'approverRole', label: 'Approver role', width: 18 },
      { key: 'status', label: 'Status', width: 18 },
      { key: 'sapDocuments', label: 'SAP documents', width: 18 },
    ],
    rows: cases.map((c) => {
      const d = primaryProposal(c)?.decision
      return {
        id: c.id,
        receivedAt: c.receivedAt,
        from: c.from,
        customer: c.customer,
        customerName: c.customerName,
        invoice: c.invoiceNumber,
        complaint: COMPLAINT_LABELS[c.complaintType],
        rule: d?.ruleId ?? null,
        document: d?.documentType ?? null,
        reason: d?.reasonCode ?? null,
        quantity: d ? d.quantity : null,
        amount: d ? d.amount : null,
        approverRole: d?.approverRole ? ROLE_LABELS[d.approverRole] : null,
        status: STATUS_LABELS[c.status],
        sapDocuments: c.sapDocuments.map((s) => `${s.type} ${s.number}`).join(', ') || null,
      }
    }),
  }

  const approvals: ReportTable = {
    key: 'approvals',
    title: 'Approvals',
    columns: [
      { key: 'decidedAt', label: 'Decided', width: 18 },
      { key: 'caseId', label: 'Case', width: 14 },
      { key: 'actor', label: 'Approver', width: 20 },
      { key: 'role', label: 'Role', width: 18 },
      { key: 'decision', label: 'Decision', width: 10 },
      { key: 'rule', label: 'Rule', width: 6 },
      { key: 'amount', label: 'Amount', width: 11, money: true },
      { key: 'editedQuantity', label: 'Edited qty', width: 9 },
      { key: 'comment', label: 'Comment', width: 40 },
    ],
    rows: cases.flatMap((c) =>
      c.approvals.map((a) => {
        const d = proposals.get(a.proposalId)?.decision
        return { decidedAt: a.decidedAt, caseId: c.id, actor: a.actor, role: ROLE_LABELS[a.role], decision: a.decision, rule: d?.ruleId ?? null, amount: d ? d.amount : null, editedQuantity: a.editedQuantity, comment: a.comment || null }
      }),
    ).sort((a, b) => String(a.decidedAt).localeCompare(String(b.decidedAt))),
  }

  const sapDocuments: ReportTable = {
    key: 'sapDocuments',
    title: 'SAP documents',
    columns: [
      { key: 'createdAt', label: 'Created', width: 18 },
      { key: 'caseId', label: 'Case', width: 14 },
      { key: 'type', label: 'Type', width: 6 },
      { key: 'number', label: 'Number', width: 12 },
      { key: 'invoice', label: 'Invoice', width: 11 },
      { key: 'released', label: 'Released', width: 9 },
      { key: 'gatewayLogId', label: 'Gateway approval record', width: 38 },
    ],
    rows: cases.flatMap((c) =>
      c.sapDocuments.map((s) => ({ createdAt: s.createdAt, caseId: c.id, type: s.type, number: s.number, invoice: c.invoiceNumber, released: s.released, gatewayLogId: s.gatewayLogId ?? null })),
    ).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
  }

  const events: ReportTable = {
    key: 'events',
    title: 'Audit log',
    columns: [
      { key: 'at', label: 'Time', width: 18 },
      { key: 'caseId', label: 'Case', width: 14 },
      { key: 'l4Step', label: 'L4 step', width: 7 },
      { key: 'l4Name', label: 'Process step', width: 30 },
      { key: 'kind', label: 'Kind', width: 10 },
      { key: 'title', label: 'Event', width: 44 },
      { key: 'durationMs', label: 'ms', width: 7 },
      { key: 'detail', label: 'Detail', width: 60 },
    ],
    rows: cases.flatMap((c) =>
      c.events.map((e) => ({
        at: e.at,
        caseId: c.id,
        l4Step: e.l4Step,
        l4Name: e.l4Step ? L4_STEPS[e.l4Step].name : null,
        kind: e.kind,
        title: e.title,
        durationMs: e.durationMs,
        detail: Object.keys(e.detail).length ? JSON.stringify(e.detail) : null,
      })),
    ).sort((a, b) => String(a.at).localeCompare(String(b.at))),
  }

  return { meta, analytics, tables: [summary, casesTable, approvals, sapDocuments, events] }
}

/** File name stem for the report, e.g. reclaim-audit-2026-10-05. */
export function reportFileName(r: Report, suffix = ''): string {
  const period = r.meta.from || r.meta.to ? `${r.meta.from ? day(r.meta.from) : 'start'}_${r.meta.to ? day(r.meta.to) : day(r.meta.generatedAt)}` : day(r.meta.generatedAt)
  return `reclaim-audit-${period}${suffix}`
}

const escapeXml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch] as string)
    // Control characters other than tab, newline and carriage return are not allowed in XML 1.0.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

const ELEMENT: Record<ReportTable['key'], [string, string]> = {
  summary: ['Summary', 'Metric'],
  cases: ['Cases', 'Case'],
  approvals: ['Approvals', 'Approval'],
  sapDocuments: ['SapDocuments', 'SapDocument'],
  events: ['AuditLog', 'Event'],
}

/** The report as XML: <ReclaimAuditReport> with one element per table and one child per row. Empty cells are left out. */
export function reportToXml(r: Report): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>']
  const m = r.meta
  const attrs = [['generatedAt', m.generatedAt], ['generatedBy', m.generatedBy], ['sapMode', m.sapMode], ['currency', m.currency], ['caseCount', String(m.caseCount)], ['from', m.from], ['to', m.to]]
    .filter((a): a is [string, string] => a[1] != null)
    .map(([k, val]) => ` ${k}="${escapeXml(val)}"`)
    .join('')
  lines.push(`<ReclaimAuditReport${attrs}>`)
  lines.push(`  <Title>${escapeXml(m.title)}</Title>`)
  for (const t of r.tables) {
    const [group, item] = ELEMENT[t.key]
    lines.push(`  <${group} count="${t.rows.length}">`)
    for (const row of t.rows) {
      lines.push(`    <${item}>`)
      for (const c of t.columns) {
        const val = row[c.key]
        if (val === null || val === undefined || val === '') continue
        lines.push(`      <${c.key}>${escapeXml(String(val))}</${c.key}>`)
      }
      lines.push(`    </${item}>`)
    }
    lines.push(`  </${group}>`)
  }
  lines.push('</ReclaimAuditReport>')
  return lines.join('\n') + '\n'
}
