import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { answerQuestion, buildMemo, packToScanInput, runScan, type PackFiles } from '../control-tower'

/** The organisers' Control Tower pack (real DS4 answers of 1 Oct 2026) against their expected-results.json. */
const dir = resolve(__dirname, '../../../../mock-data/control-tower/mock-data')
const J = (f: string) => JSON.parse(readFileSync(resolve(dir, 'sap-responses', f), 'utf8'))
const expected = JSON.parse(readFileSync(resolve(dir, 'expected-results.json'), 'utf8'))

function pack(full = true): PackFiles {
  return {
    asOf: '2026-10-01',
    unbilled: J(full ? 'unbilled-deliveries-all.json' : 'unbilled-deliveries.json'),
    awaitingPod: J('deliveries-awaiting-pod.json'),
    blockedOrders: J(full ? 'blocked-orders-all.json' : 'blocked-orders.json'),
    leakage: { YDE1: J('leakage-scan-yde1.json'), YRO1: J('leakage-scan-yro1.json') },
    dueLists: [J('billing-due-list-customer-10044.json')],
    keyDeliveries: J('delivery-status-key-deliveries.json'),
    customers: J('customers-country.json'),
    conformance: ['conformance-order-1876-deviation-4.1.1.json', 'conformance-order-1937-conforms.json', 'conformance-order-1832-credit-block.json', 'conformance-order-1510-no-delivery-yet.json'].map(J),
  }
}
const input = packToScanInput(pack())
const s = runScan(input)
const kf = expected.emails['02-controller-what-blocks-close.eml'].keyFigures

describe('Control Tower scan against the oracle (full lists)', () => {
  it('counts unbilled deliveries, the period, the grace, the 14-day leaks and the legacy items', () => {
    expect(s.kpis.unbilled.count).toBe(kf.unbilledAll)
    expect(s.kpis.unbilled.currentPeriod).toBe(kf.unbilledCurrentPeriod)
    expect(s.kpis.unbilled.withinGrace).toBe(kf.unbilledCurrentWithinGrace3d)
    expect(s.kpis.unbilled.over14d).toBe(kf.unbilledCurrentOver14d)
    expect(s.kpis.unbilled.over14dPod).toBe(kf.of31_causePod)
    expect(s.kpis.unbilled.over14dBilling).toBe(1)
    expect(s.kpis.unbilled.legacy).toBe(34)
  })
  it('counts POD, blocks and overdue per currency', () => {
    expect(s.kpis.awaitingPod.count).toBe(kf.awaitingPod)
    expect(s.kpis.awaitingPod.over14d).toBe(kf.awaitingPodOver14d)
    expect(s.kpis.blocked.count).toBe(kf.blockedOrdersAll)
    expect(s.kpis.blocked.value).toEqual(kf.blockedValueAtRisk)
    expect(s.kpis.blocked.credit).toBe(kf.blockedCredit)
    expect(s.kpis.blocked.ageing).toEqual(kf.blockAgeing)
    expect(s.kpis.overdue).toEqual({ YDE1: { currency: 'EUR', total: 368598.4, customers: 3 }, YRO1: { currency: 'RON', total: 150, customers: 2 } })
  })
  it('counts a delivery once: unbilled and awaiting POD is one finding, cause POD', () => {
    const d = s.findings.filter((f) => f.document === '80609014')
    expect(d).toHaveLength(1)
    expect(d[0]).toMatchObject({ kind: 'pod_pending', l4: '3.4.1', routeTo: 'pod', dataOwner: 'team T01', severity: 'medium', ageDays: 13 })
    expect(s.findings.filter((f) => f.kind === 'pod_pending' || f.kind === 'shipped_not_billed')).toHaveLength(178)
  })
  it('every finding carries the fields the oracle lists', () => {
    for (const f of s.findings) {
      expect(f.l4).toMatch(/^\d\.\d\.\d$/)
      expect(f.document).toBeTruthy()
      expect(f.currency).toMatch(/^(EUR|RON)$/)
      expect(f.rule).toMatch(/^S\d/)
      expect(f.why).toMatch(/\d/)
      expect(f.dataOwner).toBeTruthy()
    }
  })
  it('the close verdict is not ready, with the rule and the numbers, and the memo keeps legacy apart', () => {
    expect(s.verdict).toBe('not ready')
    expect(s.verdictWhy).toMatch(/31 deliveries .* 2026-09 .* 14 days \(30 wait for POD, 1 is a billing leak\)/)
    const memo = buildMemo(s)
    expect(memo.startsWith('# Close readiness · 2026-09')).toBe(true)
    expect(memo).toMatch(/\*\*Verdict: not ready\.\*\*/)
    expect(memo).toContain('1 609 540.00 EUR + 474 910.00 RON')
    expect(memo).toContain('368 598.40 EUR (YDE1) + 150.00 RON (YRO1)')
    expect(memo).toContain('## Legacy items')
    expect(memo).not.toMatch(/EUR \+ .*RON = /)
  })
})

describe('Control Tower scan on the capped lists', () => {
  it('reports the row caps instead of presenting 100 as a total', () => {
    const c = runScan(packToScanInput(pack(false)))
    expect(c.kpis.unbilled.capped).toBe(true)
    expect(c.kpis.blocked.capped).toBe(true)
    expect(c.rowCaps.length).toBe(2)
    expect(c.verdict).toBe('not ready')
  })
})

describe('Control Tower questions against the oracle', () => {
  const blocked = input.blockedOrders.rows
  const ask = (q: string) => answerQuestion(q, s, input.customers, input.conformance, blocked)
  it('01 Norway: no customer, no finding, nothing invented, for a person', () => {
    const a = ask('The board pack says DSO is up for Norway. Can you tell me why, with the numbers behind it?')
    expect(a.subject.country).toBe('NO')
    expect(a.noData).toBe(true)
    expect(a.routeTo).toBe('person')
    expect(a.text).toMatch(/no customer in NO/)
    expect(a.findings).toHaveLength(0)
  })
  it('03 customer 10044: POD is the biggest leak, 41 deliveries 51 570 EUR, 19 high = 26 000, two POD-done to billing', () => {
    const a = ask('XYZ Partner Limited (customer 10044, Berlin) says our invoices reach them weeks after the goods. What leaks most for this customer?')
    expect(a.subject.customer).toBe('10044')
    expect(a.headline).toMatch(/proof of delivery/)
    expect(a.facts[1]).toMatch(/41 deliveries, 51 570\.00 EUR; 19 older than 14 days = 26 000\.00 EUR/)
    expect(a.facts[2]).toMatch(/80609071 \(340\.00 EUR, 16 days, high\)/)
    expect(a.facts[2]).toMatch(/80609039 \(1 700\.00 EUR, 6 days, medium\)/)
    expect(a.facts[3]).toMatch(/80608955 \(540\.00 EUR, POD confirmed, 1 days\)/)
    expect(a.facts[3]).toMatch(/80609023 \(1 360\.00 EUR, POD open, 2 days\)/)
    expect(a.facts[4]).toMatch(/Blocked orders: 0\. Overdue receivables: none/)
    expect(a.findings.filter((f) => f.kind === 'pod_pending')).toHaveLength(41)
    expect(a.findings.filter((f) => f.kind === 'shipped_not_billed').map((f) => f.document).sort()).toEqual(['80609039', '80609071'])
  })
  it('04 order 1876: a 4.1.1 flag inside the grace period is not a leak; POD Chaser later', () => {
    const a = ask('Your conformance view shows a red flag on order 1876 (customer 10057, 10 800 EUR): delivered but not billed. Is this revenue leakage?')
    expect(a.subject.order).toBe('1876')
    expect(a.text).toMatch(/^Not a leak yet/)
    expect(a.text).toMatch(/1 day\(s\) ago/)
    expect(a.text).toMatch(/6 POD Chaser/)
    expect(a.text).not.toMatch(/10 800\.00 EUR .*lost/)
    expect(a.routeTo).toBe('none')
  })
  it('05 order 1937: clean chain', () => {
    const a = ask('Is order 1937 a clean example from order to invoice? Please show me the document chain.')
    expect(a.text).toBe('Yes. order 1937 → delivery 80609033 → invoice 90000455: no deviation from the reference process.')
  })
  it('06 release the block on 1368: refused, facts, routed to Block Buster, owner T01', () => {
    const a = ask('Order 1368 (Domestic RO Test LN, 8 750 RON) is on billing block. Just remove the block and create the invoice today so it lands in September.')
    expect(a.refused).toBe(true)
    expect(a.routeTo).toBe('blocks')
    expect(a.text).toMatch(/only reads SAP/)
    expect(a.text).toMatch(/billing block 02 since 2026-09-28/)
    expect(a.text).toMatch(/no delivery yet/)
    expect(a.text).toMatch(/team T01/)
  })
  it('07 Switzerland: 10020 owes 50 000 EUR overdue, high, Cash Application', () => {
    const a = ask('How much do Swiss customers owe us that is already overdue, and who chases it?')
    expect(a.subject.country).toBe('CH')
    expect(a.findings).toHaveLength(1)
    expect(a.findings[0]).toMatchObject({ customer: '10020', value: 50000, currency: 'EUR', severity: 'high', routeTo: 'cash', dataOwner: 'shared' })
    expect(a.text).toMatch(/Cust CH 1 \(10020\) owes 50 000\.00 EUR overdue, high/)
  })
  it('02 the close: verdict first with the key figures', () => {
    const a = ask('What is still blocking the September close? I need a short memo: are we ready, at risk or not ready')
    expect(a.topic).toBe('close')
    expect(a.facts[0]).toMatch(/^Verdict: not ready/)
    expect(a.facts[1]).toMatch(/178 deliveries \(144 of this period; 59 within grace, 31 past 14 days: 30 wait for POD, 1 billing\); 34 legacy/)
  })
})

describe('Control Tower, the same order a week later', () => {
  it('04 order 1876 on 6 Oct: past the grace, a POD finding of medium severity for the POD Chaser, not a billing leak', () => {
    const later = packToScanInput({ ...pack(), asOf: '2026-10-06' })
    const s6 = runScan(later)
    const f = s6.findings.find((x) => x.document === '80608983')!
    expect(f).toMatchObject({ kind: 'pod_pending', l4: '3.4.1', severity: 'medium', ageDays: 6, routeTo: 'pod' })
    const a = answerQuestion('Order 1876 is flagged as delivered, not billed. Is this revenue leakage? Who should fix it?', s6, later.customers, later.conformance, later.blockedOrders.rows)
    expect(a.routeTo).toBe('pod')
    expect(a.text).toMatch(/POD finding \(3\.4\.1\) of severity medium, high after 14 days, routed to 6 POD Chaser/)
    expect(a.text).toMatch(/not a billing leak/)
    expect(a.text).not.toMatch(/4\.1\.1.*high/)
    expect(a.facts.join(' ')).not.toMatch(/severity high/)
  })
})

describe('Control Tower, a section that fails to read', () => {
  it('runs on, reports the section as not read, and answers a country question without customers', () => {
    const p = pack()
    p.customers = { response: undefined as unknown as NonNullable<PackFiles['customers']>['response'], status: 503, error: 'getCustomerAddresses: the gateway is not reachable right now' } as PackFiles['customers']
    const input = packToScanInput(p)
    const s2 = runScan(input)
    expect(s2.notRead).toEqual([{ section: 'customer addresses', error: 'getCustomerAddresses: the gateway is not reachable right now' }])
    expect(s2.findings.length).toBeGreaterThan(300)
    expect(buildMemo(s2)).toContain('customer addresses: getCustomerAddresses')
    const a = answerQuestion('How much do Swiss customers owe us?', s2, input.customers, input.conformance, input.blockedOrders.rows)
    expect(a.noData).toBe(true)
  })
})
