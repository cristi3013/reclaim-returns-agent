/**
 * Who owns a document on DS4, from the hackathon's team data sheet and the Control Tower guide. The Control Tower
 * never acts: a finding names its owner so the route lands with the team that may act on it.
 */
const T01 = new Set(['80609005', '80609014', '80609024', '80609035', '80608963', '1368', '1369', '1814', '1832', '1510', '1521', '80000170', '80000244', '80000313', '80000443'])
const OTHER_LEGACY = new Set(['80000033', '80000184', '80000186', '80000400', '80608730', '143', '1120'])
const SHARED_CASH = new Set(['1800000012', '100000006'])

export function dataOwner(document: string, opts: { legacy?: boolean; customer?: string; kind?: string } = {}): string {
  const n = document.replace(/^0+/, '')
  if (T01.has(n)) return 'team T01'
  if (OTHER_LEGACY.has(n)) return 'other'
  if (SHARED_CASH.has(n)) return 'shared'
  const num = Number(n)
  if (num >= 80608972 && num <= 80608982) return 'shared (HACK-POD)'
  if (opts.kind === 'overdue_receivable') return 'shared'
  if (opts.customer === '10044') return 'other (AGENTLAB-06, for the hackathon lead)'
  if (opts.customer === '10057' || opts.customer === '10101') return 'shared (HACK-POD)'
  if (opts.legacy) return 'team (billing due-list item, see the team data sheet)'
  return 'other'
}
