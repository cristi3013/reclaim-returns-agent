import type { Snapshot } from './types'
import { AGENTS } from './types'

const fmt = (v: number, cur: string) => `${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ' ')} ${cur}`
const perCurrency = (m: Record<string, number>) => (Object.keys(m).length ? Object.entries(m).map(([c, v]) => fmt(v, c)).join(' + ') : 'not valued')

/** The close-readiness memo in the template's shape: verdict first, KPIs per currency, what blocks, legacy apart. */
export function buildMemo(s: Snapshot): string {
  const k = s.kpis
  const current = s.findings.filter((f) => !f.legacy)
  const legacy = s.findings.filter((f) => f.legacy)
  const cat = (kind: string[]) => current.filter((f) => kind.includes(f.kind) && f.severity !== 'watch')
  const byCat = [
    { name: 'Waiting for POD (3.4.1)', rows: cat(['pod_pending']), owner: AGENTS.pod },
    { name: 'Shipped, not billed (4.1.1)', rows: cat(['shipped_not_billed']), owner: AGENTS.billing },
    { name: 'Blocked orders (2.3.3)', rows: cat(['order_block', 'credit_block']), owner: AGENTS.blocks },
    { name: 'Overdue receivables (6.1.2)', rows: cat(['overdue_receivable']), owner: AGENTS.cash },
    { name: 'Returns without credit (5.2.1)', rows: cat(['return_without_credit']), owner: AGENTS.returns },
  ].filter((c) => c.rows.length)
  const sum = (rows: typeof current) => {
    const m: Record<string, number> = {}
    for (const f of rows) if (f.value != null) m[f.currency] = Math.round(((m[f.currency] ?? 0) + f.value) * 100) / 100
    return perCurrency(m)
  }
  const lines: string[] = []
  lines.push(`# Close readiness · ${s.period} (as of ${s.asOf})`, '')
  lines.push(`**Verdict: ${s.verdict}.** ${s.verdictWhy}`, '')
  lines.push(`Read-only report from the O2C Control Tower. Nothing was changed in SAP. Every figure below comes from SAP reads on ${s.asOf}; amounts are per currency and never added across currencies.`, '')
  lines.push('## KPIs', '', '| KPI | Value | Detail |', '|---|---|---|')
  lines.push(`| Shipped, not billed | ${perCurrency(k.unbilled.value)} | ${k.unbilled.count} deliveries${k.unbilled.capped ? ' (list cut at its row cap)' : ''}, ${k.unbilled.over3d} past 3 days, ${k.unbilled.over14d} of this period past 14 days, oldest ${k.unbilled.oldestDays ?? '–'} days; ${k.unbilled.valued} valued |`)
  lines.push(`| Waiting for POD | ${perCurrency(k.awaitingPod.value)} | ${k.awaitingPod.count} deliveries, ${k.awaitingPod.over3d} past 3 days, ${k.awaitingPod.over14d} past 14 days (counted once, cause POD) |`)
  lines.push(`| Blocked orders | ${perCurrency(k.blocked.value)} | ${k.blocked.count} orders${k.blocked.capped ? ' (list cut at its row cap)' : ''}; ageing 0–7: ${k.blocked.ageing['0-7']}, 8–30: ${k.blocked.ageing['8-30']}, 31+: ${k.blocked.ageing['31+']}; ${k.blocked.credit} credit |`)
  lines.push(`| Overdue receivables | ${Object.entries(k.overdue).map(([cc, o]) => `${fmt(o.total, o.currency)} (${cc})`).join(' + ') || 'none'} | ${Object.entries(k.overdue).map(([cc, o]) => `${o.customers} customers in ${cc}`).join(', ')} |`)
  lines.push(`| Returns without credit | ${perCurrency(k.returns.value)} | ${k.returns.count} returns |`)
  lines.push(`| Conformance | ${k.conformance.walked} orders walked | ${k.conformance.conform} conform; deviations by L4: ${Object.entries(k.conformance.deviationsByL4).map(([l, n]) => `${l}: ${n}`).join(', ') || 'none'} |`, '')
  lines.push('## What blocks the close', '')
  byCat.forEach((c, i) => lines.push(`${i + 1}. ${c.name}: ${sum(c.rows)} in ${c.rows.length} items, ${c.rows.filter((f) => f.severity === 'high').length} high. Owner: ${c.owner}.`))
  if (!byCat.length) lines.push('Nothing of this period blocks the close.')
  lines.push('', '## Findings (top 10 per category; the rest in the run record)', '', '| Document | Customer (country) | Value | Severity | L4 | Why | Route to | Owner of the data |', '|---|---|---|---|---|---|---|---|')
  for (const c of byCat) for (const f of c.rows.slice(0, 10)) lines.push(`| ${f.documentType} ${f.document} | ${f.customerName ?? f.customer} (${f.country ?? '–'}) | ${f.value == null ? 'not valued' : fmt(f.value, f.currency)} | ${f.severity} | ${f.l4} | ${f.why} | ${AGENTS[f.routeTo]} | ${f.dataOwner} |`)
  lines.push('', '## Routed today', '')
  for (const c of byCat) lines.push(`- ${c.owner}: ${c.rows.length} findings (information only; nothing was changed)`)
  lines.push('', '## Not read this run', '')
  if (s.notRead.length) for (const n of s.notRead) lines.push(`- ${n.section}: ${n.error} (the memo is incomplete for this section)`)
  else lines.push('- every section was read')
  if (s.rowCaps.length) {
    lines.push('', '## Lists cut at their row cap', '')
    for (const r of s.rowCaps) lines.push(`- ${r}`)
  }
  lines.push('', '## Legacy items (older than one year, reported, not deciding this close)', '')
  const oldest = legacy.reduce((m, f) => Math.max(m, f.ageDays), 0)
  lines.push(legacy.length ? `- ${legacy.length} items, oldest ${oldest} days. Owner per item: the team whose data sheet lists it (route to its agent), else other, for a person to clean up.` : '- none')
  for (const f of legacy.slice(0, 40)) lines.push(`  - ${f.documentType} ${f.document}, ${f.customerName ?? f.customer}, ${f.ageDays} days, ${f.l4} → ${AGENTS[f.routeTo]}, owner ${f.dataOwner}`)
  return lines.join('\n') + '\n'
}
