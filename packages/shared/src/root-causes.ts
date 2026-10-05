import { z } from 'zod'
import { COMPLAINT_LABELS, COMPLAINT_TYPES, type ComplaintType } from './enums'
import { primaryProposal, type Case } from './schemas'
import { ModelUsageSchema } from './pricing'
import { stripQuoted } from './thread'

/**
 * Root causes: why money leaks through complaints, and what to fix upstream.
 * Similar complaints are grouped by their meaning (embeddings, any language), the model names the cause and the
 * action for each group, and code computes every figure: count, credit value, desk hours, trend. The model's wording
 * is checked against the data; a figure that is not in the data replaces it with the template. Read-only.
 */

/** One complaint, as the analysis sees it: a live case or a closed one from the archive. */
export const ComplaintRecordSchema = z.object({
  id: z.string(),
  source: z.enum(['live', 'archive']),
  receivedAt: z.string(),
  customer: z.string(),
  customerName: z.string(),
  material: z.string().nullable(),
  plant: z.string().nullable(),
  complaintType: z.enum(COMPLAINT_TYPES),
  ruleId: z.string().nullable(),
  documentType: z.enum(['YRE', 'YCR', 'NONE']),
  /** Credit value of the return or credit request, 0 when no document. */
  amount: z.number(),
  currency: z.string(),
  /** Case status (live) or how it ended (archive). */
  outcome: z.string(),
  language: z.string(),
  text: z.string(),
  /** What the photo shows, as the model read it. */
  evidence: z.string().nullable(),
})
export type ComplaintRecord = z.infer<typeof ComplaintRecordSchema>

/** What the model writes for one group. Words only: the figures come from code. */
export const RootCauseNarrationSchema = z.object({
  id: z.string().describe('The group id, exactly as given.'),
  title: z
    .string()
    .describe('At most 8 words naming the pattern, e.g. "Leaking drum lids from plant YGLG".'),
  rootCause: z
    .string()
    .describe(
      '1 or 2 sentences: the most likely cause, as the complaints and photos show it. Say what the evidence is.',
    ),
  action: z
    .string()
    .describe('1 sentence, imperative: the one thing to fix upstream so these complaints stop.'),
  owner: z
    .string()
    .describe(
      'Who should act, as a function, e.g. "Plant YGLG packaging", "Transport management", "Pricing master data", "Quality management".',
    ),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('high when most complaints and photos point to the same cause.'),
})
export type RootCauseNarration = z.infer<typeof RootCauseNarrationSchema>
export const RootCauseNarrationsSchema = z.object({ clusters: z.array(RootCauseNarrationSchema) })

export const RootCauseClusterSchema = RootCauseNarrationSchema.extend({
  rank: z.number(),
  wordedBy: z.enum(['model', 'template']),
  /** Set when the model's wording was replaced because it named a figure that is not in the data. */
  groundingNote: z.string().nullable(),
  complaints: z.number(),
  value: z.number(),
  currency: z.string(),
  /** Share of all credit value in the period, 0..1. */
  share: z.number(),
  deskHours: z.number(),
  last30Days: z.number(),
  /** Complaints per 30 days in the 60 days before. */
  prior30DayAverage: z.number(),
  trend: z.enum(['rising', 'stable', 'falling']),
  types: z.array(z.object({ type: z.enum(COMPLAINT_TYPES), count: z.number() })),
  plants: z.array(z.string()),
  materials: z.array(z.string()),
  customers: z.array(z.object({ customer: z.string(), name: z.string(), count: z.number() })),
  languages: z.array(z.string()),
  /** Open live cases that fit the pattern: the issue is happening now. */
  openCaseIds: z.array(z.string()),
  quotes: z.array(z.object({ id: z.string(), text: z.string(), language: z.string() })),
  members: z.array(
    ComplaintRecordSchema.pick({
      id: true,
      source: true,
      receivedAt: true,
      customerName: true,
      complaintType: true,
      documentType: true,
      amount: true,
      outcome: true,
    }),
  ),
})
export type RootCauseCluster = z.infer<typeof RootCauseClusterSchema>

export const RootCauseBriefingSchema = z.object({
  generatedAt: z.string(),
  generatedBy: z.string(),
  embeddings: z.object({ model: z.string(), store: z.string(), vectors: z.number() }),
  period: z.object({ from: z.string(), to: z.string() }),
  totals: z.object({
    complaints: z.number(),
    live: z.number(),
    archive: z.number(),
    value: z.number(),
    currency: z.string(),
    deskHours: z.number(),
    clusteredValue: z.number(),
  }),
  clusters: z.array(RootCauseClusterSchema),
  /** Complaints that belong to no group of three or more. */
  unclustered: z.number(),
  usage: ModelUsageSchema.nullable(),
  note: z.string().nullable(),
})
export type RootCauseBriefing = z.infer<typeof RootCauseBriefingSchema>

/** Desk time per complaint without the agent, the value calculator's default. */
export const MANUAL_MINUTES_PER_COMPLAINT = 45
const DAY = 86400000
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

/** A case as a complaint record. Material and plant from the invoice line when SAP was read. */
export function recordFromCase(c: Case): ComplaintRecord {
  const p = primaryProposal(c)
  const d = p?.decision
  const inv = c.findings?.invoice ?? null
  const item = inv?.items.find((i) => i.material === c.facts?.material) ?? inv?.items[0] ?? null
  const doc = d?.documentType ?? 'NONE'
  return {
    id: c.id,
    source: 'live',
    receivedAt: c.receivedAt,
    customer: c.customer ?? inv?.customer ?? 'unknown',
    customerName: c.customerName ?? inv?.customerName ?? c.customer ?? 'unknown',
    material: item?.material ?? c.facts?.material ?? null,
    plant: item?.plant ?? null,
    complaintType: c.facts?.complaintType ?? c.complaintType,
    ruleId: d?.ruleId ?? null,
    documentType: doc,
    amount: doc === 'NONE' ? 0 : (d?.amount ?? 0),
    currency: d?.currency ?? inv?.currency ?? 'EUR',
    outcome: c.status,
    language: c.facts?.language ?? 'en',
    text: stripQuoted(c.bodyText).slice(0, 2000),
    // Rules-only facts carry a placeholder, not what the photo shows.
    evidence: c.aiMode === 'assisted' ? c.facts?.evidence || null : null,
  }
}

const GREETING =
  /^\s*(hello|hi|dear|good (morning|afternoon)|sehr geehrte|guten tag|hallo|bună ziua|stimate)\b.*$/i
const CLOSING =
  /^\s*(regards|best regards|kind regards|best|thanks|thank you|mit freundlichen grüßen|viele grüße|mfg|cu stimă|mulțumim)\b/i

/** What the customer complains about, without greeting, signature and invoice references, which say nothing about the cause. */
export function complaintCore(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const end = lines.findIndex((l) => CLOSING.test(l))
  return (end >= 0 ? lines.slice(0, end) : lines)
    .filter((l) => !GREETING.test(l))
    .join(' ')
    .replace(/\b\d{8}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The text that is embedded: what kind of complaint, where it shipped from, and what the customer wrote. */
export function embeddingText(r: ComplaintRecord): string {
  return [
    `${COMPLAINT_LABELS[r.complaintType]}.`,
    r.plant ? `Plant ${r.plant}.` : '',
    r.material ? `Material ${r.material}.` : '',
    complaintCore(r.text).split(r.customerName).join(''),
    r.evidence ?? '',
  ]
    .filter(Boolean)
    .join(' ')
}

// ---------- vectors ----------

export function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

const STOP = new Set(
  'the and for are was were with our you your this that from have has had not but all any per please more again same they them their its into than then out off can will would been also only what when which who how there here wir die der das und ist sind bitte uns ein eine nicht mit von den dem des auf für bei aus sie wie war vor nach noch und din care pentru este sunt vă rugăm cu la de pe nu și un o mai'.split(
    ' ',
  ),
)

function tokens(r: ComplaintRecord): string[] {
  const words = (r.text + ' ' + (r.evidence ?? '')).toLowerCase().match(/[\p{L}\d]{3,}/gu) ?? []
  const family =
    r.complaintType === 'damaged' || r.complaintType === 'ruined' ? 'damage' : r.complaintType
  // The structured fields count more than any single word: they are what the desk would group by.
  const fields = [
    `family:${family}`,
    `type:${r.complaintType}`,
    r.plant ? `plant:${r.plant}` : '',
    r.material ? `material:${r.material}` : '',
  ].filter(Boolean)
  return [...words.filter((w) => !STOP.has(w)), ...fields, ...fields, ...fields]
}

/** Local embedder (TF-IDF over words and fields), for the browser mock, the tests and when no embedding model is reachable. */
export function tfidfVectors(records: ComplaintRecord[]): number[][] {
  const docs = records.map(tokens)
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  const vocab = [...df.keys()].filter((t) => (df.get(t) ?? 0) > 1)
  const index = new Map(vocab.map((t, i) => [t, i]))
  const n = docs.length
  return docs.map((d) => {
    const v = new Array<number>(vocab.length).fill(0)
    for (const t of d) {
      const i = index.get(t)
      if (i != null) v[i]! += Math.log(1 + n / (df.get(t) ?? 1))
    }
    return v
  })
}

/**
 * Model embeddings of complaint emails all point roughly the same way ("a complaint"), so raw cosine is high for
 * every pair. Subtracting the mean vector leaves what tells complaints apart.
 */
export function centerVectors(vectors: number[][]): number[][] {
  if (!vectors.length) return vectors
  const mean = vectors[0]!.map((_, k) => vectors.reduce((s, v) => s + v[k]!, 0) / vectors.length)
  return vectors.map((v) => v.map((x, k) => x - mean[k]!))
}

/** Similarity threshold for grouping, per embedder. `model` is for centred Cohere vectors, tuned on the archive. */
export const CLUSTER_THRESHOLD = { tfidf: 0.3, model: 0.15 }

/**
 * Average-linkage grouping: start with one group per complaint, merge the two most similar groups while their
 * average similarity is above the threshold. Deterministic; fine for a few hundred complaints.
 */
export function clusterVectors(vectors: number[][], threshold: number): number[][] {
  const n = vectors.length
  const sim: number[][] = vectors.map((a) => vectors.map((b) => cosine(a, b)))
  let groups: number[][] = vectors.map((_, i) => [i])
  for (;;) {
    let best = -1,
      bi = -1,
      bj = -1
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        let s = 0
        for (const a of groups[i]!) for (const b of groups[j]!) s += sim[a]![b]!
        s /= groups[i]!.length * groups[j]!.length
        if (s > best) [best, bi, bj] = [s, i, j]
      }
    }
    if (bi < 0 || best < threshold) break
    groups = [...groups.filter((_, k) => k !== bi && k !== bj), [...groups[bi]!, ...groups[bj]!]]
    if (groups.length === 1 || n === 0) break
  }
  return groups.map((g) => g.sort((a, b) => a - b))
}

// ---------- facts per group (code) ----------

export interface ClusterFacts {
  id: string
  members: ComplaintRecord[]
  /** Members, most typical first (closest to the group's centre). */
  typical: ComplaintRecord[]
  complaints: number
  value: number
  currency: string
  share: number
  deskHours: number
  last30Days: number
  prior30DayAverage: number
  trend: 'rising' | 'stable' | 'falling'
  types: { type: ComplaintType; count: number }[]
  plants: string[]
  materials: string[]
  customers: { customer: string; name: string; count: number }[]
  languages: string[]
  openCaseIds: string[]
}

const OPEN = new Set([
  'received',
  'investigating',
  'proposed',
  'awaiting_approval',
  'needs_customer_input',
])

function countBy<T>(xs: T[], key: (x: T) => string | null): [string, number][] {
  const m = new Map<string, number>()
  for (const x of xs) {
    const k = key(x)
    if (k) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** Groups of at least `minSize` complaints with their figures, most credit value first. */
export function clusterFacts(
  records: ComplaintRecord[],
  vectors: number[][],
  threshold: number,
  now = new Date(),
  minSize = 3,
): { clusters: ClusterFacts[]; unclustered: number } {
  const total = records.reduce((s, r) => s + r.amount, 0)
  const groups = clusterVectors(vectors, threshold).filter((g) => g.length >= minSize)
  const t = now.getTime()
  const clusters = groups.map((g) => {
    const members = g.map((i) => records[i]!)
    const dim = vectors[g[0]!]!.length
    const centre = new Array<number>(dim).fill(0)
    for (const i of g) for (let k = 0; k < dim; k++) centre[k]! += vectors[i]![k]!
    const typical = [...g]
      .sort((a, b) => cosine(vectors[b]!, centre) - cosine(vectors[a]!, centre))
      .map((i) => records[i]!)
    const value = round(
      members.reduce((s, r) => s + r.amount, 0),
      2,
    )
    const age = (r: ComplaintRecord) => (t - new Date(r.receivedAt).getTime()) / DAY
    const last30Days = members.filter((r) => age(r) <= 30).length
    const prior30DayAverage = round(
      members.filter((r) => age(r) > 30 && age(r) <= 90).length / 2,
      1,
    )
    const trend =
      last30Days >= 3 && last30Days >= prior30DayAverage * 1.5
        ? 'rising'
        : last30Days < prior30DayAverage * 0.5
          ? 'falling'
          : 'stable'
    const names = new Map(members.map((r) => [r.customer, r.customerName]))
    return {
      id: '',
      members: [...members].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
      typical,
      complaints: members.length,
      value,
      currency: members[0]?.currency ?? 'EUR',
      share: total ? round(value / total, 3) : 0,
      deskHours: round((members.length * MANUAL_MINUTES_PER_COMPLAINT) / 60, 1),
      last30Days,
      prior30DayAverage,
      trend,
      types: countBy(members, (r) => r.complaintType).map(([type, count]) => ({
        type: type as ComplaintType,
        count,
      })),
      plants: countBy(members, (r) => r.plant).map(([k]) => k),
      materials: countBy(members, (r) => r.material).map(([k]) => k),
      customers: countBy(members, (r) => r.customer).map(([customer, count]) => ({
        customer,
        name: names.get(customer) ?? customer,
        count,
      })),
      languages: countBy(members, (r) => r.language).map(([k]) => k),
      openCaseIds: members
        .filter((r) => r.source === 'live' && OPEN.has(r.outcome))
        .map((r) => r.id),
    } satisfies ClusterFacts
  })
  clusters.sort((a, b) => b.value - a.value || b.complaints - a.complaints)
  clusters.forEach((c, i) => (c.id = `G${i + 1}`))
  return { clusters, unclustered: records.length - clusters.reduce((s, c) => s + c.complaints, 0) }
}

// ---------- words (model or template) ----------

const money = (n: number, cur: string) => `${n.toFixed(2)} ${cur}`

/** What the model is given for every group: the computed figures and the most typical complaints. */
export function rootCausePrompt(clusters: ClusterFacts[]): string {
  return clusters
    .map((c) => {
      const lines = c.typical
        .slice(0, 8)
        .map(
          (r) =>
            `- [${r.id}, ${r.receivedAt.slice(0, 10)}, ${r.customerName}, ${COMPLAINT_LABELS[r.complaintType]}, ${r.language}] ${r.text.replace(/\s+/g, ' ').slice(0, 400)}${r.evidence ? ` (Photo: ${r.evidence})` : ''}`,
        )
      return [
        `GROUP ${c.id}`,
        `Figures (computed, do not repeat them): ${c.complaints} complaints, ${money(c.value, c.currency)} credit, ${c.last30Days} in the last 30 days, trend ${c.trend}.`,
        `Types: ${c.types.map((x) => `${COMPLAINT_LABELS[x.type]} ${x.count}`).join(', ')}. Plants: ${c.plants.join(', ') || 'unknown'}. Materials: ${c.materials.join(', ') || 'unknown'}. Customers: ${c.customers.map((x) => `${x.name} (${x.customer})`).join(', ')}.`,
        'Most typical complaints:',
        ...lines,
      ].join('\n')
    })
    .join('\n\n')
}

/** Every run of digits in the model's text must appear in what it was given (plants, materials, batch numbers …). */
export function isGrounded(text: string, source: string): boolean {
  const allowed = new Set(source.match(/\d+/g) ?? [])
  return (text.match(/\d+/g) ?? []).every((d) => allowed.has(d))
}

/** Template wording when there is no model, or when the model's wording did not pass the check. */
export function templateNarration(c: ClusterFacts): RootCauseNarration {
  const top = c.types[0]?.type ?? 'unknown'
  const plant = c.plants[0] ?? null
  const at = plant ? ` from plant ${plant}` : ''
  const mat = c.materials[0] ? `material ${c.materials[0]}` : 'the material'
  const customer = c.customers[0]
  const conf = c.types[0] && c.types[0].count / c.complaints >= 0.8 ? 'medium' : 'low'
  switch (top) {
    case 'damaged':
    case 'ruined':
      return {
        id: c.id,
        title: `Damaged goods${at}`,
        rootCause: `Goods arrive damaged or leaking, mostly ${mat}${at}. The complaints describe the same kind of damage, which points to packaging or loading rather than single accidents.`,
        action: `Inspect packaging and loading${plant ? ` at plant ${plant}` : ''} and check the carrier's handling.`,
        owner: plant ? `Plant ${plant} logistics` : 'Logistics',
        confidence: conf,
      }
    case 'short_delivery':
      return {
        id: c.id,
        title: `Short deliveries${at}`,
        rootCause: `Less arrives than invoiced, although proof of delivery shows the full quantity.`,
        action:
          'Check proofs of delivery with the carrier and have the goods counted before the delivery note is signed.',
        owner: 'Transport management',
        confidence: conf,
      }
    case 'price':
      return {
        id: c.id,
        title: customer ? `Price disputes, ${customer.name}` : 'Price disputes',
        rootCause: `The customer repeatedly reports a price different from the agreed one: the agreed price is likely missing from the SAP condition records.`,
        action: `Check the agreed price (PR00) for ${customer ? `customer ${customer.customer}` : 'these customers'} in SAP and correct the condition record.`,
        owner: 'Pricing master data',
        confidence: conf,
      }
    case 'quality':
      return {
        id: c.id,
        title: `Quality complaints on ${mat}`,
        rootCause: `Several customers report the same quality defect on ${mat}, which points to production rather than transport.`,
        action: `Check the production batches of ${mat} named in the complaints and block what is still in stock.`,
        owner: 'Quality management',
        confidence: conf,
      }
    default:
      return {
        id: c.id,
        title: `${COMPLAINT_LABELS[top]} complaints`,
        rootCause: 'Similar complaints without a single clear cause.',
        action: 'Review these complaints together with customer service.',
        owner: 'Customer service',
        confidence: 'low',
      }
  }
}

/** The briefing: figures from code, words from the model where they pass the check, else from the template. */
export function assembleBriefing(input: {
  records: ComplaintRecord[]
  facts: { clusters: ClusterFacts[]; unclustered: number }
  narrations: RootCauseNarration[] | null
  prompt: string
  generatedBy: string
  embeddings: RootCauseBriefing['embeddings']
  usage?: RootCauseBriefing['usage']
  note?: string | null
  now?: Date
}): RootCauseBriefing {
  const { records, facts } = input
  const now = input.now ?? new Date()
  const byId = new Map((input.narrations ?? []).map((n) => [n.id, n]))
  const clusters: RootCauseCluster[] = facts.clusters.map((c, i) => {
    const fromModel = byId.get(c.id)
    const grounded = fromModel
      ? [fromModel.title, fromModel.rootCause, fromModel.action, fromModel.owner].every((t) =>
          isGrounded(t, input.prompt),
        )
      : false
    const words = fromModel && grounded ? fromModel : templateNarration(c)
    return {
      ...words,
      id: c.id,
      rank: i + 1,
      wordedBy: fromModel && grounded ? 'model' : 'template',
      groundingNote:
        fromModel && !grounded
          ? 'The model named a figure that is not in the data; template wording shown instead.'
          : null,
      complaints: c.complaints,
      value: c.value,
      currency: c.currency,
      share: c.share,
      deskHours: c.deskHours,
      last30Days: c.last30Days,
      prior30DayAverage: c.prior30DayAverage,
      trend: c.trend,
      types: c.types,
      plants: c.plants,
      materials: c.materials,
      customers: c.customers,
      languages: c.languages,
      openCaseIds: c.openCaseIds,
      quotes: c.typical
        .slice(0, 3)
        .map((r) => ({
          id: r.id,
          text: r.text.replace(/\s+/g, ' ').slice(0, 180),
          language: r.language,
        })),
      members: c.members.map(
        ({
          id,
          source,
          receivedAt,
          customerName,
          complaintType,
          documentType,
          amount,
          outcome,
        }) => ({
          id,
          source,
          receivedAt,
          customerName,
          complaintType,
          documentType,
          amount,
          outcome,
        }),
      ),
    }
  })
  const dates = records.map((r) => r.receivedAt).sort()
  const value = round(
    records.reduce((s, r) => s + r.amount, 0),
    2,
  )
  return {
    generatedAt: now.toISOString(),
    generatedBy: input.generatedBy,
    embeddings: input.embeddings,
    period: {
      from: dates[0] ?? now.toISOString(),
      to: dates[dates.length - 1] ?? now.toISOString(),
    },
    totals: {
      complaints: records.length,
      live: records.filter((r) => r.source === 'live').length,
      archive: records.filter((r) => r.source === 'archive').length,
      value,
      currency: records[0]?.currency ?? 'EUR',
      deskHours: round((records.length * MANUAL_MINUTES_PER_COMPLAINT) / 60, 1),
      clusteredValue: round(
        clusters.reduce((s, c) => s + c.value, 0),
        2,
      ),
    },
    clusters,
    unclustered: facts.unclustered,
    usage: input.usage ?? null,
    note: input.note ?? null,
  }
}

/** The whole analysis without a model: local vectors and template wording. Used by the browser mock and rules-only. */
export function localRootCauses(records: ComplaintRecord[], now = new Date()): RootCauseBriefing {
  const facts = clusterFacts(records, tfidfVectors(records), CLUSTER_THRESHOLD.tfidf, now)
  return assembleBriefing({
    records,
    facts,
    narrations: null,
    prompt: '',
    generatedBy: 'rules (template wording)',
    embeddings: { model: 'tf-idf (local)', store: 'memory', vectors: records.length },
    now,
  })
}
