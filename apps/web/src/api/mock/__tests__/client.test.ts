import { describe, it, expect, beforeEach } from 'vitest'
import { MockApiClient } from '../MockApiClient'

describe('MockApiClient basics', () => {
  beforeEach(() => localStorage.clear())

  it('starts empty, seeds eight cases', async () => {
    const c = new MockApiClient({ fast: true })
    expect(await c.listCases()).toHaveLength(0)
    await c.seedCases()
    expect(await c.listCases()).toHaveLength(8)
    expect((await c.getStatus()).cases).toBe(8)
  })

  it('persists and restores', async () => {
    const a = new MockApiClient({ fast: true })
    await a.seedCases()
    const b = new MockApiClient({ fast: true })
    expect(await b.listCases()).toHaveLength(8)
  })

  it('settings update and notify', async () => {
    const c = new MockApiClient({ fast: true })
    let n = 0
    c.subscribe(() => n++)
    await c.updateSettings({ aiMode: 'rules_only' })
    expect((await c.getSettings()).aiMode).toBe('rules_only')
    expect(n).toBe(1)
  })

  it('refuses the DS4 switch with an explanation', async () => {
    const c = new MockApiClient({ fast: true })
    await expect(c.updateSettings({ sapMode: 'real' })).rejects.toMatchObject({ status: 400 })
    expect((await c.getSettings()).sapMode).toBe('mock')
  })

  it('reset clears everything', async () => {
    const c = new MockApiClient({ fast: true })
    await c.seedCases()
    await c.reset()
    expect(await c.listCases()).toHaveLength(0)
  })
})
