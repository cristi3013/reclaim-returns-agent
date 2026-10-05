import { describe, expect, it } from 'vitest'
import { buildFixtureCases } from '@reclaim/shared'
import { planSync } from '../src/persistence'
import { caseIdForMessage } from '../src/service'

/** Two backends share one Supabase: each must pick up the other's cases without clobbering its own work. */
describe('planSync', () => {
  const [a, b, c] = buildFixtureCases().slice(0, 3)
  const t0 = '2026-10-05T15:00:00.000Z'
  const later = '2026-10-05T15:00:30.000+00:00'
  const local = new Map([
    [a!.id, { ...a!, updatedAt: t0 }],
    [b!.id, { ...b!, updatedAt: t0 }],
  ])

  it('fetches new rows and rows newer than the local copy, drops rows that vanished, leaves busy cases alone', () => {
    const remote = [
      { id: a!.id, updated_at: t0 }, // unchanged
      { id: b!.id, updated_at: later }, // changed elsewhere
      { id: c!.id, updated_at: later }, // new elsewhere
    ]
    expect(planSync(local, remote, () => false)).toEqual({ toFetch: [b!.id, c!.id], toRemove: [] })
    expect(planSync(local, remote, (id) => id === b!.id)).toEqual({ toFetch: [c!.id], toRemove: [] })
    expect(planSync(local, [{ id: a!.id, updated_at: t0 }], () => false)).toEqual({ toFetch: [], toRemove: [b!.id] })
    expect(planSync(local, [], (id) => id === a!.id)).toEqual({ toFetch: [], toRemove: [b!.id] })
  })

  it('tolerates sub-second timestamp rounding between the database and the local copy', () => {
    expect(planSync(local, [{ id: a!.id, updated_at: '2026-10-05T15:00:00.400+00:00' }], () => false).toFetch).toEqual([])
  })
})

describe('caseIdForMessage', () => {
  it('gives every instance the same case id for the same email, and different ids for different emails', () => {
    expect(caseIdForMessage('<abc@mail.gmail.com>')).toBe(caseIdForMessage(' <abc@mail.gmail.com> '))
    expect(caseIdForMessage('<abc@mail.gmail.com>')).not.toBe(caseIdForMessage('<abd@mail.gmail.com>'))
    expect(caseIdForMessage('<abc@mail.gmail.com>')).toMatch(/^case-m[0-9a-f]{10}$/)
  })
})
