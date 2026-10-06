import { describe, it, expect } from 'vitest'
import {
  assembleBriefing,
  CLUSTER_THRESHOLD,
  clusterFacts,
  complaintCore,
  isGrounded,
  localRootCauses,
  recordFromCase,
  rootCausePrompt,
  tfidfVectors,
  type RootCauseNarration,
} from '../root-causes'
import { COMPLAINT_ARCHIVE } from '../fixtures/archive'
import { buildFixtureCases } from '../fixtures/cases'

const NOW = new Date('2026-10-06T08:00:00Z')
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort()

describe('root causes', () => {
  it('finds the four patterns hidden in the archive, most credit value first', () => {
    const b = localRootCauses(COMPLAINT_ARCHIVE, NOW)
    expect(b.clusters.map((c) => c.types[0]!.type)).toEqual([
      'damaged',
      'short_delivery',
      'quality',
      'price',
    ])
    const [drums, shorts, quality, price] = b.clusters
    expect(ids(drums!.members)).toEqual(
      COMPLAINT_ARCHIVE.filter((r) => r.id.startsWith('arc-1'))
        .map((r) => r.id)
        .sort(),
    )
    expect(ids(quality!.members)).toEqual(['arc-401', 'arc-402', 'arc-403', 'arc-404', 'arc-405'])
    expect(ids(price!.members)).toEqual(['arc-301', 'arc-302', 'arc-303', 'arc-304', 'arc-305'])
    expect(shorts!.members.filter((m) => m.id.startsWith('arc-2'))).toHaveLength(7)
  })

  it('computes every figure from the records', () => {
    const b = localRootCauses(COMPLAINT_ARCHIVE, NOW)
    const drums = b.clusters[0]!
    expect(drums.complaints).toBe(12)
    expect(drums.value).toBe(15930)
    expect(drums.deskHours).toBe(9)
    expect(drums.plants).toEqual(['YGLG'])
    expect(drums.last30Days).toBe(6)
    expect(drums.trend).toBe('rising')
    expect(b.totals.value).toBe(COMPLAINT_ARCHIVE.reduce((s, r) => s + r.amount, 0))
    expect(b.totals.complaints).toBe(COMPLAINT_ARCHIVE.length)
    expect(b.clusters.reduce((s, c) => s + c.complaints, 0) + b.unclustered).toBe(
      COMPLAINT_ARCHIVE.length,
    )
  })

  it('accepts only figures that are in the data', () => {
    const source = 'Batch 2608-114 caked. Plant YGLG, material 61.'
    expect(isGrounded('Block batch 2608-114 of material 61.', source)).toBe(true)
    expect(isGrounded('Block the batch, it cost 9 999 EUR.', source)).toBe(false)
    expect(isGrounded('No figures at all.', source)).toBe(true)
  })

  it('uses the model wording only when it passes the check, and never lets it change a figure', () => {
    const facts = clusterFacts(
      COMPLAINT_ARCHIVE,
      tfidfVectors(COMPLAINT_ARCHIVE),
      CLUSTER_THRESHOLD.tfidf,
      NOW,
    )
    const prompt = rootCausePrompt(facts.clusters)
    const narrations: RootCauseNarration[] = [
      {
        id: 'G1',
        title: 'Leaking drum lids from plant YGLG',
        rootCause: 'The lid seal fails.',
        action: 'Check the lid gaskets at YGLG.',
        owner: 'Plant YGLG packaging',
        confidence: 'high',
      },
      {
        id: 'G2',
        title: 'Short deliveries',
        rootCause: 'Drivers take signatures first; this cost 123456 EUR.',
        action: 'Count before signing.',
        owner: 'Transport',
        confidence: 'high',
      },
    ]
    const withModel = assembleBriefing({
      records: COMPLAINT_ARCHIVE,
      facts,
      narrations,
      prompt,
      generatedBy: 'model',
      embeddings: { model: 'x', store: 'memory', vectors: 0 },
      now: NOW,
    })
    const without = assembleBriefing({
      records: COMPLAINT_ARCHIVE,
      facts,
      narrations: null,
      prompt,
      generatedBy: 'rules',
      embeddings: { model: 'x', store: 'memory', vectors: 0 },
      now: NOW,
    })

    expect(withModel.clusters[0]).toMatchObject({
      title: 'Leaking drum lids from plant YGLG',
      wordedBy: 'model',
      groundingNote: null,
    })
    expect(withModel.clusters[1]!.wordedBy).toBe('template')
    expect(withModel.clusters[1]!.groundingNote).toMatch(/not in the data/)
    expect(withModel.clusters[1]!.rootCause).not.toMatch(/123456/)
    expect(withModel.clusters[2]!.wordedBy).toBe('template')
    const figures = (b: typeof withModel) =>
      b.clusters.map(({ complaints, value, share, deskHours, trend, members }) => ({
        complaints,
        value,
        share,
        deskHours,
        trend,
        members,
      }))
    expect(figures(withModel)).toEqual(figures(without))
    expect(withModel.totals).toEqual(without.totals)
  })

  it('embeds the complaint, not the greeting, the signature or the invoice number', () => {
    expect(
      complaintCore(
        'Hello,\n\nTwo drums of invoice 90000353 leaked.\n\nRegards,\nQuality, Cust DE 1',
      ),
    ).toBe('Two drums of invoice leaked.')
    expect(
      complaintCore('Sehr geehrte Damen und Herren,\nFässer undicht.\nMit freundlichen Grüßen\nX'),
    ).toBe('Fässer undicht.')
  })

  it('reads a case into a record, without the rules-only placeholder as photo evidence', () => {
    const c = buildFixtureCases()[0]!
    const f = {
      invoiceNumber: '90000353',
      material: '54',
      claimedQuantity: 2,
      unit: 'KG',
      complaintType: 'damaged' as const,
      claimedUnitPrice: null,
      wantsReplacement: false,
      goodsReturnable: false,
      evidence: 'photo shows a puddle',
      language: 'en',
    }
    expect(recordFromCase({ ...c, aiMode: 'assisted', facts: f })).toMatchObject({
      id: 'case-01',
      source: 'live',
      complaintType: 'damaged',
      evidence: 'photo shows a puddle',
      documentType: 'NONE',
      amount: 0,
    })
    expect(
      recordFromCase({
        ...c,
        aiMode: 'rules_only',
        facts: { ...f, evidence: 'extracted by pattern rules' },
      }).evidence,
    ).toBeNull()
  })
})
