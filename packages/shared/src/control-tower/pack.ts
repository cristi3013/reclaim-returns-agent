import type { BlockedOrderRow, ConformanceRow, CustomerRow, DeliveryRow, DueListRow, OverdueRow, ReadList, ReturnRow, ScanInput } from './types'

/**
 * Turns the hackathon pack's SAP answers (mock-data/control-tower/mock-data/sap-responses, shaped answers of the
 * organisers' MCP tools, captured on DS4) into the scan's normalised input. The same shapes come back from the live
 * tools, so a live run uses the same function.
 */
type Captured<T> = { response: T; underlyingRequests?: string[]; status?: number; error?: string; arguments?: Record<string, unknown> }

interface RawDelivery {
  DeliveryDocument: string
  SoldToParty?: string
  ShipToParty?: string
  ActualGoodsMovementDate: string
  OverallDelivReltdBillgStatus?: string
  OverallProofOfDeliveryStatus?: string
  ProofOfDeliveryDate?: string | null
  SalesOrganization?: string
  podFields?: { OverallProofOfDeliveryStatus?: string; ProofOfDeliveryDate?: string | null }
}
interface RawOrder {
  SalesOrder: string
  SalesOrderType: string
  SalesOrganization: string
  SoldToParty: string
  CreationDate: string
  TotalNetAmount: string
  TransactionCurrency: string
  HeaderBillingBlockReason: string
  DeliveryBlockReason: string
  OverallSDProcessStatus: string
  TotalCreditCheckStatus: string
}

const list = <T, R>(c: Captured<unknown> | undefined, rows: (r: unknown) => R[], cap: number | null): ReadList<R> => {
  if (!c) return { rows: [], cap, error: 'not available in this run', requests: [] }
  if (c.error || (c.status && c.status >= 400)) return { rows: [], cap, error: c.error ?? `HTTP ${c.status}`, requests: c.underlyingRequests ?? [] }
  return { rows: rows(c.response as T), cap, error: null, requests: c.underlyingRequests ?? [] }
}
const num = (s: unknown) => Number(String(s ?? '0').replace(/,/g, '')) || 0

export const delivery = (d: RawDelivery, fallbackPod = ''): DeliveryRow => ({
  number: d.DeliveryDocument.replace(/^0+/, ''),
  soldTo: (d.SoldToParty ?? d.ShipToParty ?? '').replace(/^0+/, ''),
  shipTo: (d.ShipToParty ?? d.SoldToParty ?? '').replace(/^0+/, ''),
  goodsIssueDate: d.ActualGoodsMovementDate.slice(0, 10),
  billingStatus: d.OverallDelivReltdBillgStatus ?? 'A',
  podStatus: d.podFields?.OverallProofOfDeliveryStatus ?? d.OverallProofOfDeliveryStatus ?? fallbackPod,
  podDate: d.podFields?.ProofOfDeliveryDate ?? d.ProofOfDeliveryDate ?? null,
  salesOrg: d.SalesOrganization ?? 'YSOD',
})
export const order = (o: RawOrder): BlockedOrderRow => ({
  number: o.SalesOrder,
  type: o.SalesOrderType,
  salesOrg: o.SalesOrganization,
  soldTo: o.SoldToParty,
  creationDate: o.CreationDate.slice(0, 10),
  netAmount: num(o.TotalNetAmount),
  currency: o.TransactionCurrency,
  billingBlock: o.HeaderBillingBlockReason ?? '',
  deliveryBlock: o.DeliveryBlockReason ?? '',
  creditStatus: o.TotalCreditCheckStatus ?? '',
  processStatus: o.OverallSDProcessStatus ?? '',
})

export interface PackFiles {
  unbilled?: Captured<{ count: number; deliveries: RawDelivery[] }>
  awaitingPod?: Captured<{ count: number; deliveries: RawDelivery[] }>
  blockedOrders?: Captured<{ count: number; orders: RawOrder[] }>
  leakage?: Record<string, Captured<{ asOf?: string; overdueReceivables?: { total: number; currency: string; topCustomers: { Customer: string; AmountInCompanyCodeCurrency: string; CompanyCodeCurrency: string }[] } }>>
  dueLists?: Captured<{ total: number; items: { ReferenceSDDocument: string; NetAmount: string; TransactionCurrency: string; HasError: boolean; SoldToParty: string }[] }>[]
  keyDeliveries?: Captured<RawDelivery[]>
  customers?: Captured<{ addresses: { BusinessPartner: string; CityName: string; Country: string }[]; names: { BusinessPartner: string; BusinessPartnerFullName: string }[]; noAddressOnDS4?: string[] }>
  conformance?: Captured<{ salesOrder: string; conforms: boolean; findings: ConformanceRow['findings']; deliveries: string[]; billingDocuments: string[] }>[]
  returns?: ReturnRow[]
  asOf?: string
  /** Row cap the list reads used (the organisers' tools cap at 100). */
  cap?: number
}

/** Build the scan input from the pack's files (or the same shapes read live). */
export function packToScanInput(p: PackFiles): ScanInput {
  const cap = p.cap ?? 100
  const asOf = p.asOf ?? Object.values(p.leakage ?? {})[0]?.response?.asOf ?? new Date().toISOString().slice(0, 10)
  const unbilled = list<{ deliveries: RawDelivery[] }, DeliveryRow>(p.unbilled, (r) => (r as { deliveries: RawDelivery[] }).deliveries.map((d) => delivery(d)), p.unbilled?.arguments?.top != null ? Number(p.unbilled.arguments.top) : cap)
  const awaitingPod = list<{ deliveries: RawDelivery[] }, DeliveryRow>(p.awaitingPod, (r) => (r as { deliveries: RawDelivery[] }).deliveries.map((d) => delivery(d, 'A')), p.awaitingPod?.arguments?.top != null ? Number(p.awaitingPod.arguments.top) : cap)
  // The key-delivery statuses (POD confirmed and date) refine the unbilled rows, which carry no POD fields.
  const key = new Map((p.keyDeliveries?.response ?? []).map((d) => [d.DeliveryDocument.replace(/^0+/, ''), d]))
  for (const row of unbilled.rows) {
    const kd = key.get(row.number)
    if (kd) {
      row.podStatus = kd.OverallProofOfDeliveryStatus ?? row.podStatus
      row.podDate = kd.ProofOfDeliveryDate ?? row.podDate
    }
  }
  const blockedOrders = list<{ orders: RawOrder[] }, BlockedOrderRow>(p.blockedOrders, (r) => (r as { orders: RawOrder[] }).orders.map(order), p.blockedOrders?.arguments?.top != null ? Number(p.blockedOrders.arguments.top) : cap)
  const overdue: Record<string, ReadList<OverdueRow>> = {}
  for (const [cc, c] of Object.entries(p.leakage ?? {})) {
    overdue[cc] = list<unknown, OverdueRow>(c, (r) => ((r as { overdueReceivables?: { topCustomers: { Customer: string; AmountInCompanyCodeCurrency: string; CompanyCodeCurrency: string }[] } }).overdueReceivables?.topCustomers ?? []).map((x) => ({ companyCode: cc, customer: x.Customer.replace(/^0+/, ''), amount: num(x.AmountInCompanyCodeCurrency), currency: x.CompanyCodeCurrency })), null)
  }
  const dueRows: DueListRow[] = []
  const dueReq: string[] = []
  for (const c of p.dueLists ?? []) {
    dueReq.push(...(c.underlyingRequests ?? []))
    for (const it of c.response?.items ?? []) dueRows.push({ delivery: it.ReferenceSDDocument.replace(/^0+/, ''), netAmount: num(it.NetAmount), currency: it.TransactionCurrency, hasError: !!it.HasError, soldTo: it.SoldToParty })
  }
  const dueList: ReadList<DueListRow> = { rows: dueRows, cap: null, error: null, requests: dueReq }
  const names = new Map((p.customers?.response.names ?? []).map((n) => [n.BusinessPartner, n.BusinessPartnerFullName]))
  const customers: CustomerRow[] = (p.customers?.response.addresses ?? []).map((a) => ({ id: a.BusinessPartner, name: names.get(a.BusinessPartner) ?? a.BusinessPartner, country: a.Country || null, city: a.CityName || null }))
  for (const [id, name] of names) if (!customers.some((c) => c.id === id)) customers.push({ id, name, country: null, city: null })
  for (const id of p.customers?.response.noAddressOnDS4 ?? []) if (!customers.some((c) => c.id === id)) customers.push({ id, name: '(no address on DS4)', country: null, city: null })
  const conformance: ConformanceRow[] = (p.conformance ?? []).map((c) => ({ order: c.response.salesOrder, conforms: c.response.conforms, findings: c.response.findings, deliveries: c.response.deliveries, billingDocuments: c.response.billingDocuments }))
  const conformanceRequests = (p.conformance ?? []).flatMap((c) => c.underlyingRequests ?? [])
  const returns: ReadList<ReturnRow> = { rows: p.returns ?? [], cap: null, error: null, requests: [] }
  const customersRequests = p.customers?.underlyingRequests ?? []
  // Requests of sections without their own ReadList are logged through the due list entry.
  dueList.requests.push(...conformanceRequests, ...customersRequests)
  return { asOf, unbilled, awaitingPod, blockedOrders, overdue, dueList, returns, customers, conformance }
}
