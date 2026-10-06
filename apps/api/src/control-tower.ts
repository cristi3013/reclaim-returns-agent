import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENTS, answerQuestion, buildMemo, packToScanInput, parseQuestion, runScan, type Answer, type ConformanceRow, type Finding, type PackFiles, type ReturnRow, type RoutingNote, type ScanInput, type Settings, type Snapshot } from '@reclaim/shared'
import type { Ai } from './ai/types'
import type { Gateway } from './gateway/types'
import { RealGateway } from './gateway/real'
import type { Store } from './store'
import type { InboundEmail } from './intake/mailbox'

const here = path.dirname(fileURLToPath(import.meta.url))
/** The organisers' pack: real DS4 answers of 1 Oct 2026. A live read would fill the same PackFiles from the gateway. */
export const PACK_DIR = path.resolve(here, '../../../mock-data/control-tower/mock-data')

export function loadPack(dir = PACK_DIR): PackFiles {
  const J = (f: string) => JSON.parse(readFileSync(path.join(dir, 'sap-responses', f), 'utf8'))
  const has = (f: string) => existsSync(path.join(dir, 'sap-responses', f))
  const conformance = readdirSync(path.join(dir, 'sap-responses')).filter((f) => f.startsWith('conformance-order-')).map(J)
  return {
    asOf: '2026-10-01',
    unbilled: has('unbilled-deliveries-all.json') ? J('unbilled-deliveries-all.json') : J('unbilled-deliveries.json'),
    awaitingPod: J('deliveries-awaiting-pod.json'),
    blockedOrders: has('blocked-orders-all.json') ? J('blocked-orders-all.json') : J('blocked-orders.json'),
    leakage: { YDE1: J('leakage-scan-yde1.json'), YRO1: J('leakage-scan-yro1.json') },
    dueLists: [J('billing-due-list-customer-10044.json')],
    keyDeliveries: J('delivery-status-key-deliveries.json'),
    customers: J('customers-country.json'),
    conformance,
  }
}

export interface ControlTowerDeps {
  store: Store
  ai: (s: Settings) => Ai
  /** The SAP gateway. When it is live (RealGateway), the lists are read from DS4; otherwise the pack is used (tests). */
  gateway: (s: Settings) => Gateway
  /** Hands a finding routed to the Returns & Credit Note agent into our own inbox. */
  ingest: (mail: InboundEmail) => Promise<{ id: string } | null>
  pack?: () => PackFiles
  log?: (msg: string) => void
}

/**
 * The O2C Control Tower (extra credit, agent 10): reads the SAP lists, computes KPIs and findings with the shared
 * scan, writes the close memo, answers questions and routes findings. It never writes to SAP: there is no write
 * call in this file, and the request log it keeps holds GET requests only.
 */
export class ControlTower {
  private snapshot: Snapshot | null = null
  private input: ScanInput | null = null
  private runs: { at: string; requests: number; findings: number; by: string }[] = []
  private answers: Answer[] = []
  constructor(private deps: ControlTowerDeps) {}

  /** Returns of our own system: a customer return written more than 7 days ago with its credit still blocked. */
  private ownReturns(): ReturnRow[] {
    const rows: ReturnRow[] = []
    for (const c of this.deps.store.cases.values()) {
      for (const d of c.sapDocuments) {
        if (d.type !== 'YRE') continue
        const p = c.proposals.find((x) => x.chosen) ?? c.proposals[0]
        rows.push({ number: d.number, soldTo: c.customer ?? '', creationDate: d.createdAt.slice(0, 10), netAmount: p?.decision.amount ?? null, currency: p?.decision.currency ?? 'EUR', hasCreditMemo: d.released })
      }
    }
    return rows
  }

  /** The customers the findings may name: the pack's list plus whoever appears in today's lists. */
  private static KNOWN_PARTNERS = ['10012', '10020', '10021', '10044', '10057', '10059', '10100', '10101', '10110', '10172', '10220', '62', '46', '51', '7800000096']
  private static WALKED_ORDERS = ['1876', '1937', '1832', '1510']

  /** Reads the seven Control Tower functions of the gateway. A section that fails is captured as an error, not guessed. */
  private async loadLive(gw: RealGateway): Promise<PackFiles> {
    const today = new Date().toISOString().slice(0, 10)
    const read = async <T>(name: string, params: Record<string, string | number>) => {
      try {
        return await gw.readTool<T>(name, params)
      } catch (e) {
        const err = e as Error & { status?: number }
        return { response: undefined as unknown as T, status: err.status ?? 500, error: err.message, underlyingRequests: [`GET ${name}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(',')}) → failed`] }
      }
    }
    const [unbilled, awaitingPod, blockedOrders, yde1, yro1, dueList, customers] = await Promise.all([
      read<{ count: number; deliveries: unknown[] }>('listUnbilledDeliveries', { top: 500, soldToParty: '' }),
      read<{ count: number; deliveries: unknown[] }>('listDeliveriesAwaitingPod', { top: 500, shipToParty: '' }),
      read<{ count: number; orders: unknown[] }>('listBlockedOrders', { top: 500 }),
      read<{ asOf?: string; overdueReceivables?: unknown }>('listOverdueReceivables', { companyCode: 'YDE1', keyDate: today }),
      read<{ asOf?: string; overdueReceivables?: unknown }>('listOverdueReceivables', { companyCode: 'YRO1', keyDate: today }),
      read<{ total: number; items: unknown[] }>('listBillingDueList', { soldToParty: '10044', top: 100 }),
      read<{ addresses: unknown[]; names: unknown[]; norway: unknown[]; noAddressOnDS4?: string[] }>('getCustomerAddresses', { partners: ControlTower.KNOWN_PARTNERS.join(',') }),
    ])
    const conformance = await Promise.all(ControlTower.WALKED_ORDERS.map((o) => read<{ salesOrder: string; conforms: boolean; findings: unknown[]; deliveries: string[]; billingDocuments: string[] }>('checkOrderConformance', { salesOrder: o })))
    return {
      asOf: today,
      cap: 500,
      unbilled: unbilled as PackFiles['unbilled'],
      awaitingPod: awaitingPod as PackFiles['awaitingPod'],
      blockedOrders: blockedOrders as PackFiles['blockedOrders'],
      leakage: { YDE1: yde1 as NonNullable<PackFiles['leakage']>[string], YRO1: yro1 as NonNullable<PackFiles['leakage']>[string] },
      dueLists: [dueList as NonNullable<PackFiles['dueLists']>[number]],
      customers: customers as PackFiles['customers'],
      conformance: conformance.filter((c) => !(c as { error?: string }).error && c.response) as PackFiles['conformance'],
    }
  }

  async run(by = 'system'): Promise<Snapshot> {
    const gw = this.deps.gateway(this.deps.store.settings)
    const live = gw instanceof RealGateway
    const pack = live ? await this.loadLive(gw) : (this.deps.pack ?? loadPack)()
    pack.returns = this.ownReturns()
    this.input = packToScanInput(pack)
    this.snapshot = runScan(this.input, undefined, live ? `SAP DS4, live through the gateway (${pack.asOf})` : "organisers' pack (SAP DS4 answers of 1 Oct 2026)")
    this.runs.push({ at: new Date().toISOString(), requests: this.snapshot.requestLog.length, findings: this.snapshot.findings.length, by })
    this.deps.log?.(`Control Tower run by ${by}: ${this.snapshot.findings.length} findings, verdict ${this.snapshot.verdict}, ${this.snapshot.requestLog.length} GET requests`)
    return this.snapshot
  }

  async current(): Promise<Snapshot> {
    return this.snapshot ?? this.run()
  }

  async memo(): Promise<string> {
    return buildMemo(await this.current())
  }

  async ask(question: string, by: string): Promise<Answer> {
    const s = await this.current()
    const input = this.input!
    // A question about an order that was not walked in the run: walk it now, live, before answering.
    const asked = parseQuestion(question, input.customers)
    const gw = this.deps.gateway(this.deps.store.settings)
    if (asked.order && !input.conformance.some((c) => c.order === asked.order) && gw instanceof RealGateway) {
      try {
        const r = await gw.readTool<{ salesOrder: string; conforms: boolean; findings: ConformanceRow['findings']; deliveries: string[]; billingDocuments: string[] }>('checkOrderConformance', { salesOrder: asked.order })
        input.conformance.push({ order: r.response.salesOrder, conforms: r.response.conforms, findings: r.response.findings, deliveries: r.response.deliveries, billingDocuments: r.response.billingDocuments })
        s.requestLog.push(...(r.underlyingRequests ?? []))
      } catch (e) {
        this.deps.log?.(`Control Tower: conformance of ${asked.order} not read (${(e as Error).message})`)
      }
    }
    const base = answerQuestion(question, s, input.customers, input.conformance, input.blockedOrders.rows)
    let answer = base
    const ai = this.deps.ai(this.deps.store.settings)
    if (this.deps.store.settings.aiMode === 'assisted' && ai.phrase) {
      try {
        const r = (await ai.phrase(question, base)) as { text: string; fallback?: string }
        answer = { ...base, text: r.text, phrasedBy: r.fallback ? `rules (${r.fallback})` : ai.name }
      } catch (e) {
        answer = { ...base, phrasedBy: `rules (model failed: ${(e as Error).message.slice(0, 80)})` }
      }
    }
    this.answers.unshift({ ...answer, question: `${question}` })
    this.deps.log?.(`Control Tower question by ${by}: topic ${answer.topic}, route ${answer.routeTo}${answer.refused ? ', refused (read-only)' : ''}${answer.noData ? ', no data' : ''}`)
    return answer
  }

  /** One note per fixing agent per day, listing its documents: information only, never an order to write. */
  async notes(): Promise<RoutingNote[]> {
    const s = await this.current()
    const date = s.asOf
    const groups = new Map<string, Finding[]>()
    for (const f of s.findings) {
      if (f.severity === 'watch' || f.routeTo === 'none' || f.routeTo === 'person') continue
      groups.set(f.routeTo, [...(groups.get(f.routeTo) ?? []), f])
    }
    return [...groups.entries()].map(([route, rows]) => {
      const l4 = [...new Set(rows.map((f) => f.l4))].sort()
      const own = rows.filter((f) => f.dataOwner.startsWith('team'))
      const shared = rows.filter((f) => !f.dataOwner.startsWith('team'))
      const line = (f: Finding) => `- ${f.documentType} ${f.document} · ${f.customerName ?? f.customer} · ${f.value == null ? 'not valued' : `${f.value.toFixed(2)} ${f.currency}`} · ${f.ageDays} days · ${f.severity} · ${f.rule} · ${f.l4}${f.legacy ? ' · legacy' : ''}`
      const body = [`Control Tower ${date}: ${rows.length} finding(s) for ${AGENTS[route as keyof typeof AGENTS]} (${l4.join(', ')}).`, 'Information only. Nothing was changed in SAP; act only on the documents your team owns, behind your own approval.', '', own.length ? `Team-owned documents (${own.length}):` : '', ...own.map(line), own.length && shared.length ? '' : '', shared.length ? `Shared or other-owned documents (${shared.length}), for information:` : '', ...shared.map(line), '', 'Value is counted once per delivery (a delivery waiting for POD is not also a billing finding).'].filter((l, i, a) => !(l === '' && a[i - 1] === ''))
      return { id: `note-${date}-${route}`, date, agent: AGENTS[route as keyof typeof AGENTS], route: route as RoutingNote['route'], l4, findingIds: rows.map((f) => f.id), subject: `Control Tower ${date}: ${rows.length} finding(s) (${l4.join(', ')})`, body: body.join('\n') }
    })
  }

  /** A finding for the Returns & Credit Note agent becomes a case in our own inbox. Other agents get the note. */
  async handover(findingId: string, by: string): Promise<{ ok: true; caseId: string } | { ok: false; status: number; message: string }> {
    const s = await this.current()
    const f = s.findings.find((x) => x.id === findingId)
    if (!f) return { ok: false, status: 404, message: 'Finding not found in the current run.' }
    if (f.routeTo !== 'returns') return { ok: false, status: 400, message: `${AGENTS[f.routeTo]} is not part of this system; its routing note is on the Control Tower page.` }
    const r = await this.deps.ingest({ from: `Control Tower <control-tower@reclaim.local>`, subject: `Control Tower ${s.asOf}: return ${f.document} without credit note (5.2.1)`, text: `Information only; nothing was changed in SAP.\n\n${f.why}\nCustomer ${f.customerName ?? f.customer}. Severity ${f.severity}, rule ${f.rule}. Data owner: ${f.dataOwner}.\n\nPlease check the return and create the credit note if the goods were received.`, receivedAt: new Date().toISOString(), attachments: [], messageId: `<ct-${findingId}-${Date.now()}@reclaim.local>`, sourceFile: null })
    if (!r) return { ok: false, status: 409, message: 'This finding was already handed over.' }
    this.deps.log?.(`Control Tower hand-over by ${by}: ${f.document} → case ${r.id}`)
    return { ok: true, caseId: r.id }
  }

  status() {
    return { runs: this.runs.slice(-10), lastAnswers: this.answers.slice(0, 10) }
  }
}
