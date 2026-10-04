import { describe, it, expect } from 'vitest'
import { useUi } from '../ui'

describe('ui store', () => {
  it('defaults to credit manager and system theme', () => {
    const s = useUi.getState()
    expect(s.role).toBe('credit_manager')
    expect(s.theme).toBe('system')
  })
  it('applies data-theme on setTheme', () => {
    useUi.getState().setTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    useUi.getState().setTheme('system')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})
