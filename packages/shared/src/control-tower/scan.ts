import { AGENTS, type BlockedOrderRow, type CustomerRow, type DeliveryRow, type Finding, type FindingKind, type Kpis, type ReadList, type Route, type ScanInput, type Severity, type Snapshot } from './types'
import { dataOwner } from './owners'

export interface ScanRules {
  /** Days before a shipped, unbilled delivery (or an open POD) counts as a leak. S3/S4. */
  graceDays: number
  /** Days after which a leak is high. S3/S4. */
  highDays: number
  /** Days after which a block is high. S5. */
  blockHighDays: number
  /** Overdue per customer from which the finding is high. S6. */
  overdueHigh: number
  /** A return without a credit memo after this many days. S7. */
  returnDays: number
  /** Older than this is legacy: reported, not deciding the close. S9. */
  legacyDays: number
}
export const DEFAULT_RULES: ScanRules = { graceDays: 3, highDays: 14, blockHighDays: 30, overdueHigh: 10000, returnDays: 7, legacyDays: 365 }

const DAY = 86_400_000
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY)
const add = (m: Record<string, number>, cur: string, v: number) => (m[cur] = Math.round(((m[cur] ?? 0) + v) * 100) / 100)
const money = (v: number | null, cur: string) => (v == null ? 'not valued' : `${v.toLocaleString('en-GB', { minimumFractionDigits: 2 }).replace(/,/g, ' ')} ${cur}`)

/**
 * One run of the Control Tower over the SAP lists: KPIs per currency, one finding per leak with its L4 step,
 * severity, rule, route and owner, and the close verdict. Pure: same input, same output.
 */
export function runScan(input: ScanInput, rules: ScanRules = DEFAULT_RULES, source = 'organisers\' pack (SAP DS4 answers of 1 Oct 2026)'): Snapshot {
  const today = input.asOf
  // The period being closed: in the first week of a month it is the month before (a run on 1 Oct closes September).
  const period = closingPeriod(today)
  const periodStart = `${period}-01`
  const customers = new Map(input.customers.map((c) => [c.id, c]))
  const cust = (id: string) => customers.get(id.replace(/^0+/, '')) ?? customers.get(id)
  const value = new Map<string, { amount: number; currency: string; hasError: boolean }>()
  for (const r of input.dueList.rows) value.set(r.delivery, { amount: r.netAmount, currency: r.currency, hasError: r.hasError })
  const currencyOf = (salesOrg: string) => (salesOrg === 'YSOR' ? 'RON' : 'EUR')
  const findings: Finding[] = []
  const rowCaps: string[] = []
  const notRead: { section: string; error: string }[] = []
  const requestLog: string[] = []
  const take = <T>(section: string, l: ReadList<T>): T[] => {
    requestLog.push(...l.requests)
    if (l.error) {
      notRead.push({ section, error: l.error })
      return []
    }
    if (l.cap != null && l.rows.length >= l.cap) rowCaps.push(`${section}: ${l.rows.length} rows returned, the list is cut at its row cap; the real total is higher`)
    return l.rows
  }
  const push = (f: Omit<Finding, 'id' | 'customerName' | 'country'>) => {
    const c = cust(f.customer)
    findings.push({ ...f, id: `${f.kind}:${f.document}`, customerName: c?.name ?? null, country: c?.country ?? null })
  }
  const sevForAge = (age: number): Severity => (age > rules.highDays ? 'high' : age > rules.graceDays ? 'medium' : 'watch')

  // ---- deliveries: unbilled and awaiting POD, one finding per delivery (S3, S4)
  const unbilled = take('unbilled deliveries', input.unbilled)
  const pod = take('deliveries awaiting POD', input.awaitingPod)
  const podSet = new Map(pod.map((d) => [d.number, d]))
  const seen = new Set<string>()
  const k = { count: 0, currentPeriod: 0, withinGrace: 0, over3d: 0, over14d: 0, over14dPod: 0, over14dBilling: 0, legacy: 0, valued: 0, value: {} as Record<string, number>, oldestDays: null as number | null, capped: input.unbilled.cap != null && unbilled.length >= input.unbilled.cap }
  const kp = { count: 0, over3d: 0, over14d: 0, value: {} as Record<string, number>, capped: input.awaitingPod.cap != null && pod.length >= input.awaitingPod.cap }
  const deliveryFinding = (d: DeliveryRow, viaPodList: boolean) => {
    if (seen.has(d.number)) return
    seen.add(d.number)
    const age = daysBetween(d.goodsIssueDate, today)
    const podOpen = d.podStatus === 'A' || d.podStatus === 'B' || podSet.has(d.number)
    const legacy = age > rules.legacyDays
    const current = d.goodsIssueDate >= periodStart
    const v = value.get(d.number)
    const cur = v?.currency ?? currencyOf(d.salesOrg)
    if (!viaPodList) {
      k.count++
      if (legacy) k.legacy++
      if (current) {
        k.currentPeriod++
        if (age <= rules.graceDays) k.withinGrace++
        if (age > rules.highDays) {
          k.over14d++
          if (podOpen) k.over14dPod++
          else k.over14dBilling++
        }
      }
      if (age > rules.graceDays) k.over3d++
      if (v) {
        k.valued++
        add(k.value, cur, v.amount)
      }
      k.oldestDays = Math.max(k.oldestDays ?? 0, age)
    }
    // The POD list itself holds deliveries goods-issued at least `graceDays` ago; younger open PODs are watched only.
    if (podOpen && (podSet.has(d.number) || age >= rules.graceDays)) {
      kp.count++
      if (age > rules.graceDays) kp.over3d++
      if (age > rules.highDays) kp.over14d++
      if (v) add(kp.value, cur, v.amount)
    }
    const sev = sevForAge(age)
    if (sev === 'watch' && !legacy) {
      // Inside the grace period: not a leak yet. Kept as a watch item so a question about the order can be answered.
    }
    const kind: FindingKind = podOpen ? 'pod_pending' : 'shipped_not_billed'
    push({
      kind,
      l4: podOpen ? '3.4.1' : '4.1.1',
      documentType: 'delivery',
      document: d.number,
      customer: d.soldTo,
      value: v?.amount ?? null,
      currency: cur,
      ageDays: age,
      severity: sev,
      rule: podOpen ? 'S4' : 'S3',
      why: podOpen
        ? `Goods issued ${age} days ago (${d.goodsIssueDate}), POD still open (status ${d.podStatus || podSet.get(d.number)?.podStatus || 'A'}): the invoice waits for the POD. ${money(v?.amount ?? null, cur)}${v?.hasError ? '; the billing due list reports an error' : ''}.`
        : `Goods issued ${age} days ago (${d.goodsIssueDate}), ${d.podStatus === 'C' ? `POD confirmed ${d.podDate ?? ''}`.trim() : d.podStatus ? 'POD not required' : 'no open POD'}, still not billed. ${money(v?.amount ?? null, cur)}${v?.hasError ? '; the billing due list reports an error (merge: 4.1.1)' : ''}.`,
      routeTo: podOpen ? 'pod' : 'billing',
      dataOwner: dataOwner(d.number, { legacy, customer: d.soldTo }),
      legacy,
      currentPeriod: current,
    })
  }
  for (const d of unbilled) deliveryFinding(d, false)
  for (const d of pod) deliveryFinding(d, true)

  // ---- blocked orders (S5)
  const blocked = take('blocked orders', input.blockedOrders)
  const kb = { count: 0, value: {} as Record<string, number>, credit: 0, ageing: { '0-7': 0, '8-30': 0, '31+': 0 }, capped: input.blockedOrders.cap != null && blocked.length >= input.blockedOrders.cap }
  for (const o of blocked) {
    const age = daysBetween(o.creationDate, today)
    kb.count++
    add(kb.value, o.currency, o.netAmount)
    const credit = o.creditStatus === 'B'
    if (credit) kb.credit++
    kb.ageing[age <= 7 ? '0-7' : age <= 30 ? '8-30' : '31+']++
    const legacy = age > rules.legacyDays
    const blocks = [o.billingBlock && `billing block ${o.billingBlock}`, o.deliveryBlock && `delivery block ${o.deliveryBlock}`, credit && 'credit block'].filter(Boolean).join(', ')
    push({
      kind: credit ? 'credit_block' : 'order_block',
      l4: '2.3.3',
      documentType: 'order',
      document: o.number,
      customer: o.soldTo,
      value: o.netAmount,
      currency: o.currency,
      ageDays: age,
      severity: age > rules.blockHighDays ? 'high' : 'medium',
      rule: 'S5',
      why: `${blocks} since ${o.creationDate} (${age} days); ${money(o.netAmount, o.currency)} at risk${credit ? '; a credit-limit change is master data: for a person' : ''}${o.processStatus === 'A' ? '; not delivered yet' : ''}.`,
      routeTo: 'blocks',
      dataOwner: dataOwner(o.number, { legacy, customer: o.soldTo }),
      legacy,
      currentPeriod: o.creationDate >= periodStart,
    })
  }

  // ---- overdue receivables per company code (S6)
  const ko: Kpis['overdue'] = {}
  for (const [cc, list] of Object.entries(input.overdue)) {
    const rows = take(`overdue receivables ${cc}`, list)
    if (list.error) continue
    const total = rows.reduce((s, r) => s + r.amount, 0)
    ko[cc] = { currency: rows[0]?.currency ?? (cc === 'YRO1' ? 'RON' : 'EUR'), total: Math.round(total * 100) / 100, customers: rows.length }
    for (const r of rows) {
      push({
        kind: 'overdue_receivable',
        l4: '6.1.2',
        documentType: 'customer',
        document: r.customer,
        customer: r.customer,
        value: r.amount,
        currency: r.currency,
        ageDays: 0,
        severity: r.amount >= rules.overdueHigh ? 'high' : 'medium',
        rule: 'S6',
        why: `Open items past their net due date in ${cc}: ${money(r.amount, r.currency)}.`,
        routeTo: 'cash',
        dataOwner: dataOwner(r.customer, { kind: 'overdue_receivable', customer: r.customer }),
        legacy: false,
        currentPeriod: true,
      })
    }
  }

  // ---- returns without credit (S7)
  const returns = take('customer returns', input.returns)
  const kr = { count: 0, value: {} as Record<string, number> }
  for (const r of returns) {
    const age = daysBetween(r.creationDate, today)
    if (r.hasCreditMemo || age <= rules.returnDays) continue
    kr.count++
    if (r.netAmount != null) add(kr.value, r.currency, r.netAmount)
    push({ kind: 'return_without_credit', l4: '5.2.1', documentType: 'return', document: r.number, customer: r.soldTo, value: r.netAmount, currency: r.currency, ageDays: age, severity: 'medium', rule: 'S7', why: `Customer return created ${r.creationDate} (${age} days) with no credit memo referencing it.`, routeTo: 'returns', dataOwner: dataOwner(r.number, { customer: r.soldTo }), legacy: age > rules.legacyDays, currentPeriod: r.creationDate >= periodStart })
  }

  // ---- conformance (S8): deviations at 4.1.1 inside the grace period are watched, not leaks
  const kc = { walked: input.conformance.length, conform: 0, deviationsByL4: {} as Record<string, number> }
  for (const c of input.conformance) {
    if (c.conforms) {
      kc.conform++
      continue
    }
    for (const f of c.findings) {
      const delivery = c.deliveries[0]
      const known = delivery ? findings.find((x) => x.document === delivery) : undefined
      if (f.l4 === '4.1.1' && known) {
        // Already a delivery finding (counted once); only note the deviation.
        kc.deviationsByL4[f.l4] = (kc.deviationsByL4[f.l4] ?? 0) + (known.severity === 'watch' ? 0 : 1)
        continue
      }
      kc.deviationsByL4[f.l4] = (kc.deviationsByL4[f.l4] ?? 0) + 1
      if (findings.some((x) => x.document === c.order)) continue
      push({ kind: 'conformance_deviation', l4: f.l4, documentType: 'order', document: c.order, customer: c.soldTo ?? '', value: c.netAmount ?? null, currency: c.currency ?? 'EUR', ageDays: 0, severity: (f.severity as Severity) ?? 'medium', rule: 'S8', why: f.finding, routeTo: (f.routeTo in AGENTS ? f.routeTo : 'person') as Route, dataOwner: dataOwner(c.order, { customer: c.soldTo }), legacy: false, currentPeriod: true })
    }
  }

  const kpis: Kpis = { unbilled: k, awaitingPod: kp, blocked: kb, overdue: ko, returns: kr, conformance: kc }

  // ---- close verdict (S9)
  const highCurrent = findings.filter((f) => f.currentPeriod && !f.legacy && (f.kind === 'pod_pending' || f.kind === 'shipped_not_billed') && f.severity === 'high')
  const anyOther = findings.some((f) => !f.legacy && (f.severity === 'high' || f.severity === 'medium'))
  const verdict = highCurrent.length ? 'not ready' : anyOther ? 'at risk' : 'ready'
  const verdictWhy = highCurrent.length
    ? `S9: ${highCurrent.length} deliveries with goods issue in ${period} are unbilled for more than ${rules.highDays} days (${highCurrent.filter((f) => f.kind === 'pod_pending').length} wait for POD, ${highCurrent.filter((f) => f.kind === 'shipped_not_billed').length} ${highCurrent.filter((f) => f.kind === 'shipped_not_billed').length === 1 ? 'is' : 'are'} a billing leak).`
    : anyOther
      ? 'S9: no delivery of the period is unbilled for more than 14 days, but high or medium findings remain.'
      : 'S9: nothing shipped in the period is unbilled beyond the grace period, no high or medium finding.'

  const order: Record<Severity, number> = { high: 0, medium: 1, info: 2, watch: 3 }
  findings.sort((a, b) => Number(a.legacy) - Number(b.legacy) || order[a.severity] - order[b.severity] || (b.value ?? -1) - (a.value ?? -1) || b.ageDays - a.ageDays)
  return { asOf: today, source, period, verdict, verdictWhy, kpis, findings, rowCaps, notRead, requestLog }
}

/** `2026-10-01` → `2026-09`; `2026-10-15` → `2026-10`. */
export function closingPeriod(asOf: string): string {
  const d = new Date(asOf.slice(0, 10) + 'T00:00:00Z')
  if (d.getUTCDate() <= 7) d.setUTCDate(0)
  return d.toISOString().slice(0, 7)
}

export const customerOf = (customers: CustomerRow[], id: string) => customers.find((c) => c.id === id.replace(/^0+/, ''))
export type { BlockedOrderRow, DeliveryRow }
