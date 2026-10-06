import { AGENTS, type Answer, type ConformanceRow, type CustomerRow, type Finding, type Route, type Snapshot } from './types'

const COUNTRIES: Record<string, string> = { norway: 'NO', norwegian: 'NO', switzerland: 'CH', swiss: 'CH', germany: 'DE', german: 'DE', romania: 'RO', romanian: 'RO', japan: 'JP', 'united states': 'US', usa: 'US', austria: 'AT', france: 'FR', italy: 'IT', spain: 'ES', netherlands: 'NL', poland: 'PL', sweden: 'SE', denmark: 'DK', finland: 'FI', uk: 'GB', 'united kingdom': 'GB' }
const fmt = (v: number, cur: string) => `${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ' ')} ${cur}`
const sumBy = (rows: Finding[]) => {
  const m: Record<string, number> = {}
  for (const f of rows) if (f.value != null) m[f.currency] = Math.round(((m[f.currency] ?? 0) + f.value) * 100) / 100
  return m
}
const per = (m: Record<string, number>) => (Object.keys(m).length ? Object.entries(m).map(([c, v]) => fmt(v, c)).join(' + ') : 'not valued')

export interface ParsedQuestion {
  topic: Answer['topic']
  country: string | null
  customer: string | null
  order: string | null
}

/** Subject (country, customer, order) and topic of a management question. Code, not the model: the subject must be exact. */
export function parseQuestion(text: string, customers: CustomerRow[]): ParsedQuestion {
  const t = text.toLowerCase()
  let country: string | null = null
  for (const [word, code] of Object.entries(COUNTRIES)) if (new RegExp(`\\b${word}\\b`).test(t)) country = code
  let customer: string | null = null
  const cm = /customer\s*(\d{3,10})|\((\d{4,10})\)/.exec(t)
  if (cm) customer = cm[1] ?? cm[2] ?? null
  if (!customer) for (const c of customers) if (c.name.length > 4 && t.includes(c.name.toLowerCase())) customer = c.id
  const om = /order\s*(\d{3,10})|\b(1\d{3})\b/.exec(t)
  const order = om ? (om[1] ?? om[2] ?? null) : null
  const change = /\b(release|remove|unblock|create the invoice|invoice it|just remove|change)\b/.test(t) && /\b(block|invoice)\b/.test(t)
  const topic: Answer['topic'] = change
    ? 'change_request'
    : /\bdso\b/.test(t)
      ? 'dso'
      : /\bclose\b/.test(t) || /\bmemo\b/.test(t)
        ? 'close'
        : /\boverdue\b|\bowe\b|\bowes\b/.test(t)
          ? 'overdue'
          : order || /\bclean example\b|\bconformance\b|\bdocument chain\b|\bdeviation\b/.test(t)
            ? 'conformance'
            : /\bleak|\bleaks\b|\binvoices? (reach|arrive)\b|\blate\b/.test(t)
              ? 'leakage'
              : 'unknown'
  return { topic, country, customer, order }
}

/**
 * Answers from the snapshot only. Every number comes from a finding or a KPI of the run; a subject with no finding
 * gets "no data", never an invented cause; a request to change SAP is refused and routed.
 */
export function answerQuestion(question: string, s: Snapshot, customers: CustomerRow[], conformance: ConformanceRow[], blockedOrdersDetail: { number: string; soldTo: string; netAmount: number; currency: string; billingBlock: string; deliveryBlock: string; creationDate: string; processStatus: string }[] = []): Answer {
  const q = parseQuestion(question, customers)
  const base = { question, topic: q.topic, subject: { country: q.country, customer: q.customer, order: q.order }, phrasedBy: 'rules' }
  const inCountry = (f: Finding) => (q.country ? f.country === q.country : true)
  const live = s.findings.filter((f) => !f.legacy && f.severity !== 'watch')
  const custName = (id: string) => customers.find((c) => c.id === id)?.name ?? id
  const custCountry = (id: string) => customers.find((c) => c.id === id)?.country ?? null

  if (q.topic === 'change_request') {
    const o = blockedOrdersDetail.find((x) => x.number === q.order) ?? null
    const f = s.findings.find((x) => x.document === q.order)
    const facts = o
      ? [`Order ${o.number} (${custName(o.soldTo)}, ${fmt(o.netAmount, o.currency)}) has ${o.billingBlock ? `billing block ${o.billingBlock}` : o.deliveryBlock ? `delivery block ${o.deliveryBlock}` : 'a block'} since ${o.creationDate}.`, o.processStatus === 'A' ? `It has no delivery yet (overall status open), so there is nothing to invoice for this period even without the block.` : 'Its delivery status is in the finding.', f ? `Data owner: ${f.dataOwner}; only that team's Block Buster may act on it.` : '']
      : [`Order ${q.order ?? '?'} is not on the blocked-order lists of this run.`]
    return { ...base, headline: 'The Control Tower only reads SAP: it cannot release a block or create an invoice. Routed to 3 Block Buster as information.', facts: facts.filter(Boolean), findings: f ? [f] : [], routeTo: 'blocks', noData: false, refused: true, text: `${'The Control Tower only reads SAP: it cannot release a block or create an invoice.'} ${facts.filter(Boolean).join(' ')} The request goes to 3 Block Buster as a routing note (information only); the block owner decides.` }
  }

  if (q.topic === 'conformance' && q.order) {
    const c = conformance.find((x) => x.order === q.order)
    const f = s.findings.find((x) => x.documentType === 'order' && x.document === q.order) ?? s.findings.find((x) => c?.deliveries.includes(x.document))
    if (!c) return { ...base, headline: `Order ${q.order} was not walked in this run.`, facts: [], findings: [], routeTo: 'person', noData: true, refused: false, text: `Order ${q.order} is not among the orders walked in this run, so I cannot show its document chain. Ask for a conformance check of that order.` }
    const chain = `order ${c.order}${c.deliveries.length ? ` → delivery ${c.deliveries.join(', ')}` : ' (no delivery yet)'}${c.billingDocuments.length ? ` → invoice ${c.billingDocuments.join(', ')}` : c.deliveries.length ? ' → no invoice' : ''}`
    if (c.conforms) return { ...base, headline: `Yes: ${chain}. No deviation.`, facts: [`Chain: ${chain}.`, c.billingDocuments.length ? 'Delivered and invoiced: it follows the reference process end to end.' : 'Not delivered yet: nothing deviates.'], findings: [], routeTo: 'none', noData: false, refused: false, text: `Yes. ${chain}: no deviation from the reference process.` }
    const dev = c.findings[0]!
    if (f && f.severity === 'watch') {
      return { ...base, headline: `Not a leak yet: ${chain}; goods left ${f.ageDays} day(s) ago, inside the ${3}-day grace period.`, facts: [`Chain: ${chain}.`, `Delivery ${f.document}: goods issue ${f.ageDays} day(s) ago, ${f.kind === 'pod_pending' ? 'POD-relevant and the POD is still open: the invoice waits for it' : 'not billed yet'}.`, `The conformance check flags ${dev.l4} without a grace period; rules S3/S4/S8 give 3 days.`, f.kind === 'pod_pending' ? `If the POD is still open after the grace period it becomes a POD finding (3.4.1) for ${AGENTS.pod}, not a billing finding.` : `If it is still unbilled after the grace period it becomes a billing finding (4.1.1) for ${AGENTS.billing}.`, `Data owner: ${f.dataOwner}.`], findings: [f], routeTo: 'none', noData: false, refused: false, text: `Not a leak yet. ${chain}. The goods left ${f.ageDays} day(s) ago and ${f.kind === 'pod_pending' ? 'the invoice waits for the POD' : 'the invoice is not created yet'}; that is inside the 3-day grace period, so no revenue is leaking today and the ${f.value != null ? fmt(f.value, f.currency) : 'order value'} must not be reported as lost. ${f.kind === 'pod_pending' ? `If the POD is still open after the grace period, it becomes a POD finding (3.4.1) for ${AGENTS.pod}` : `If it is still unbilled after the grace period, it becomes a billing finding (4.1.1) for ${AGENTS.billing}`}. Data owner: ${f.dataOwner}.` }
    }
    if (f) {
      // Past the grace period: our finding decides the words, not the conformance tool's generic text.
      const pod = f.kind === 'pod_pending'
      const sev = `${f.severity}${f.severity === 'medium' ? ', high after 14 days' : ''}`
      const facts = [
        `Chain: ${chain}.`,
        pod
          ? `Delivery ${f.document}: goods issued ${f.ageDays} days ago, POD-relevant and the POD is still open, so the invoice waits for the POD. This is a POD finding (3.4.1), not a billing leak: the cause is the missing proof of delivery.`
          : `Delivery ${f.document}: goods issued ${f.ageDays} days ago, ${f.why}`,
        `Severity ${sev}; rule ${f.rule}; ${f.value == null ? 'value not on the billing due list' : `value ${f.value.toFixed(2)} ${f.currency}`}; route to ${AGENTS[f.routeTo]}; data owner ${f.dataOwner}.`,
        `The conformance check reports it at ${dev.l4} (${dev.finding}); the Control Tower applies the 3-day grace and counts the delivery once.`,
      ]
      return { ...base, headline: `${pod ? 'A POD finding, not a billing leak' : 'A billing leak'}: ${chain}; ${f.ageDays} days, ${f.severity}, ${AGENTS[f.routeTo]}.`, facts, findings: [f], routeTo: f.routeTo, noData: false, refused: false, text: `${chain}. The goods left ${f.ageDays} days ago and ${pod ? 'the invoice waits for the proof of delivery, which is still open' : 'the invoice is still not created'}; past the 3-day grace, so this is a ${pod ? 'POD finding (3.4.1)' : 'billing finding (4.1.1)'} of severity ${sev}, routed to ${AGENTS[f.routeTo]}. ${pod ? 'It is not a billing leak: billing cannot invoice before the POD. ' : ''}${f.value == null ? 'The order value is not reported as lost revenue; the delivery is not valued on the billing due list.' : `Value ${f.value.toFixed(2)} ${f.currency}.`} Data owner: ${f.dataOwner}. Nothing was changed in SAP.` }
    }
    return { ...base, headline: `${chain}: deviation at ${dev.l4}, ${dev.finding}`, facts: [`Chain: ${chain}.`, `${dev.l4}: ${dev.finding} (severity ${dev.severity}).`], findings: [], routeTo: (dev.routeTo in AGENTS ? dev.routeTo : 'person') as Route, noData: false, refused: false, text: `${chain}. Deviation at ${dev.l4}: ${dev.finding}` }
  }

  if (q.country && !customers.some((c) => c.country === q.country)) {
    const drivers = ['DE', 'RO', 'US', 'CH', 'JP'].map((cc) => ({ cc, rows: live.filter((f) => f.country === cc) })).filter((x) => x.rows.length)
    return { ...base, headline: `SAP holds no customer in ${q.country} and no O2C finding for it.`, facts: [`No business partner on DS4 has an address in ${q.country} (A_BusinessPartnerAddress, Country eq '${q.country}' returns nothing).`, 'So no unbilled delivery, open POD, blocked order or overdue item belongs to that country.', `The movement on the slide is not explained by O2C documents in DS4: a person should check the source of the figure.`, ...drivers.map((d) => `For reference, ${d.cc}: ${d.rows.length} findings, ${per(sumBy(d.rows))}.`)], findings: [], routeTo: 'person', noData: true, refused: false, text: `SAP holds no customer in ${q.country}: no business partner on DS4 has an address there, so no O2C finding belongs to ${q.country} and I cannot explain a ${q.topic === 'dso' ? 'DSO' : ''} movement for it from the documents. Please check the source of the board figure with a person. The DSO drivers that do exist are in DE, RO, US, CH and JP${drivers.length ? `: ${drivers.map((d) => `${d.cc} ${d.rows.length} findings (${per(sumBy(d.rows))})`).join('; ')}` : ''}.` }
  }

  if (q.topic === 'overdue' || (q.topic === 'dso' && q.country)) {
    const rows = live.filter((f) => f.kind === 'overdue_receivable' && inCountry(f) && (!q.customer || f.customer === q.customer))
    if (!rows.length) return { ...base, headline: `Nothing overdue for ${q.country ?? q.customer ?? 'this subject'} in this run.`, facts: ['No open item past its net due date matches the subject.'], findings: [], routeTo: 'none', noData: true, refused: false, text: `Nothing is overdue for ${q.country ?? q.customer ?? 'this subject'} in this run's SAP reads.` }
    const facts = rows.map((f) => `${f.customerName ?? f.customer} (${f.customer}, ${f.country ?? '–'}) owes ${fmt(f.value ?? 0, f.currency)} overdue; severity ${f.severity}; route to ${AGENTS.cash}; data owner ${f.dataOwner}.`)
    return { ...base, headline: `${rows.length} customer(s): ${per(sumBy(rows))} overdue.`, facts, findings: rows, routeTo: 'cash', noData: false, refused: false, text: `${rows.length === 1 ? 'One customer' : `${rows.length} customers`}${q.country ? ` in ${q.country}` : ''}: ${rows.map((f) => `${f.customerName ?? f.customer} (${f.customer}) owes ${fmt(f.value ?? 0, f.currency)} overdue${f.severity === 'high' ? ', high' : ''}`).join('; ')}. ${AGENTS.cash} chases it; nothing was changed.` }
  }

  if (q.customer || q.topic === 'leakage') {
    const mine = live.filter((f) => (q.customer ? f.customer === q.customer : inCountry(f)))
    const watch = s.findings.filter((f) => f.severity === 'watch' && (q.customer ? f.customer === q.customer : inCountry(f)))
    const pod = mine.filter((f) => f.kind === 'pod_pending')
    const bill = mine.filter((f) => f.kind === 'shipped_not_billed')
    const blocks = mine.filter((f) => f.kind === 'order_block' || f.kind === 'credit_block')
    const over = mine.filter((f) => f.kind === 'overdue_receivable')
    const groups = [{ name: 'proof of delivery', rows: pod }, { name: 'billing', rows: bill }, { name: 'blocked orders', rows: blocks }, { name: 'overdue receivables', rows: over }].sort((a, b) => Object.values(sumBy(b.rows)).reduce((x, y) => x + y, 0) - Object.values(sumBy(a.rows)).reduce((x, y) => x + y, 0) || b.rows.length - a.rows.length)
    const biggest = groups[0]
    if (!mine.length) return { ...base, headline: `No finding for ${q.customer ? custName(q.customer) : q.country}.`, facts: [], findings: [], routeTo: 'none', noData: true, refused: false, text: `This run holds no finding for ${q.customer ? `customer ${q.customer}` : q.country}: nothing unbilled past the grace period, no open POD, no block, nothing overdue.` }
    const facts = [
      `Biggest leak: ${biggest!.name}.`,
      `Waiting for POD: ${pod.length} deliveries, ${per(sumBy(pod))}; ${pod.filter((f) => f.severity === 'high').length} older than 14 days = ${per(sumBy(pod.filter((f) => f.severity === 'high')))} (high) → ${AGENTS.pod}. Counted once: these are also unbilled.`,
      `POD confirmed (or not required), not billed: ${bill.length} deliveries, ${per(sumBy(bill))} → ${AGENTS.billing}: ${bill.map((f) => `${f.document} (${f.value == null ? 'not valued' : fmt(f.value, f.currency)}, ${f.ageDays} days, ${f.severity})`).join(', ') || 'none'}.`,
      `Within the grace period, not a leak yet: ${watch.map((f) => `${f.document} (${f.value == null ? 'not valued' : fmt(f.value, f.currency)}, ${f.kind === 'pod_pending' ? 'POD open' : 'POD confirmed'}, ${f.ageDays} days)`).join(', ') || 'none'}.`,
      `Blocked orders: ${blocks.length}. Overdue receivables: ${over.length ? per(sumBy(over)) : 'none'}.`,
    ]
    const cc = q.customer ? custCountry(q.customer) : q.country
    return { ...base, headline: `Biggest leak for ${q.customer ? `${custName(q.customer)} (${q.customer}${cc ? `, ${cc}` : ''})` : q.country}: ${biggest!.name}, ${per(sumBy(biggest!.rows))} in ${biggest!.rows.length} items.`, facts, findings: mine, routeTo: biggest!.rows[0]?.routeTo ?? 'none', noData: false, refused: false, text: `${q.customer ? `For ${custName(q.customer)} (${q.customer})` : `For ${q.country}`} the biggest leak is ${biggest!.name}. ${facts.slice(1).join(' ')}` }
  }

  if (q.topic === 'close') {
    const k = s.kpis
    const facts = [`Verdict: ${s.verdict}. ${s.verdictWhy}`, `Unbilled: ${k.unbilled.count} deliveries (${k.unbilled.currentPeriod} of this period; ${k.unbilled.withinGrace} within grace, ${k.unbilled.over14d} past 14 days: ${k.unbilled.over14dPod} wait for POD, ${k.unbilled.over14dBilling} billing); ${k.unbilled.legacy} legacy, reported apart.`, `Waiting for POD: ${k.awaitingPod.count}, ${k.awaitingPod.over14d} past 14 days.`, `Blocked orders: ${k.blocked.count}, ${per(k.blocked.value)}; ageing 0–7: ${k.blocked.ageing['0-7']}, 8–30: ${k.blocked.ageing['8-30']}, 31+: ${k.blocked.ageing['31+']}; ${k.blocked.credit} credit.`, `Overdue: ${Object.entries(k.overdue).map(([cc, o]) => `${fmt(o.total, o.currency)} in ${cc} (${o.customers} customers)`).join('; ')}.`, ...s.rowCaps]
    return { ...base, headline: `${s.period}: ${s.verdict}.`, facts, findings: live.filter((f) => f.severity === 'high').slice(0, 20), routeTo: 'person', noData: false, refused: false, text: facts.join(' ') + ' The full memo is attached.' }
  }

  return { ...base, headline: 'I can answer about DSO, the close, leakage for a customer or country, overdue receivables and one order’s document chain.', facts: [], findings: [], routeTo: 'person', noData: true, refused: false, text: 'I could not tell what the question is about. Ask about DSO, the close, what leaks for a customer or country, overdue receivables, or one order’s document chain.' }
}
