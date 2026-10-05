import { useSyncExternalStore } from 'react'

/** Below Tailwind's md breakpoint: one column, bottom tabs, queue-then-case approvals. */
export const MOBILE_QUERY = '(max-width: 767px)'

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(MOBILE_QUERY) : null
}

function subscribe(onChange: () => void) {
  const mql = query()
  if (!mql) return () => {}
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

const snapshot = () => query()?.matches ?? false

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
