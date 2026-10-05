import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { stubViewport } from '@/test/viewport'
import { useIsMobile } from '../useIsMobile'

describe('useIsMobile', () => {
  it('is true on a phone-width viewport', () => {
    stubViewport('phone')
    expect(renderHook(() => useIsMobile()).result.current).toBe(true)
  })
  it('is false on a desktop viewport', () => {
    stubViewport('desktop')
    expect(renderHook(() => useIsMobile()).result.current).toBe(false)
  })
})
