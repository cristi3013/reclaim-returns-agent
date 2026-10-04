import type { WeekPoint } from '@reclaim/shared'

/** Twelve weeks of demo history for the analytics charts. Deterministic, labelled as demo data in the UI. */
export const HISTORY_WEEKS: WeekPoint[] = Array.from({ length: 12 }, (_, i) => {
  const w = new Date(Date.UTC(2026, 6, 13 + i * 7))
  const n = 5 + ((i * 7) % 6)
  const damaged = Math.round(n * 0.35)
  const ruined = Math.round(n * 0.15)
  const quality = Math.round(n * 0.2)
  const price = Math.round(n * 0.15)
  const short = Math.round(n * 0.1)
  return {
    week: w.toISOString().slice(0, 10),
    damaged,
    ruined,
    quality,
    price,
    short_delivery: short,
    other: Math.max(0, n - damaged - ruined - quality - price - short),
    approvedValue: 1800 + ((i * 937) % 2600),
    rejectedValue: (i * 311) % 700,
  }
})

export const HISTORY_TOTALS = {
  closedCases: HISTORY_WEEKS.reduce(
    (s, w) => s + w.damaged + w.ruined + w.quality + w.price + w.short_delivery + w.other,
    0,
  ),
  duplicatesPrevented: 7,
  intercompanyFlagged: 4,
  acceptedUnchanged: 0.86,
  medianHoursToApproval: 3.4,
}
