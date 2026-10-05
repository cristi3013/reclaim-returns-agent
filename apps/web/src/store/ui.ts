import { create } from 'zustand'
import type { Role } from '@reclaim/shared'
import { DEFAULT_SORT, type InboxSort, type StatusFilter } from '@/features/inbox/view'

export type Theme = 'light' | 'dark' | 'system'

interface UiState {
  role: Role
  theme: Theme
  navCollapsed: boolean
  inboxSort: InboxSort
  inboxStatus: StatusFilter
  setRole: (r: Role) => void
  setTheme: (t: Theme) => void
  toggleNav: () => void
  setInboxSort: (s: InboxSort) => void
  setInboxStatus: (f: StatusFilter) => void
}

function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage unavailable: keep in memory only */
  }
}

const initialTheme = read<Theme>('reclaim.theme', 'system')
applyTheme(initialTheme)

export const useUi = create<UiState>((set) => ({
  role: read<Role>('reclaim.role', 'credit_manager'),
  theme: initialTheme,
  navCollapsed: read<boolean>('reclaim.nav', false),
  inboxSort: read<InboxSort>('reclaim.inbox.sort', DEFAULT_SORT),
  inboxStatus: read<StatusFilter>('reclaim.inbox.status', ''),
  setRole: (role) => {
    write('reclaim.role', role)
    set({ role })
  },
  setTheme: (theme) => {
    write('reclaim.theme', theme)
    applyTheme(theme)
    set({ theme })
  },
  toggleNav: () =>
    set((s) => {
      write('reclaim.nav', !s.navCollapsed)
      return { navCollapsed: !s.navCollapsed }
    }),
  setInboxSort: (inboxSort) => {
    write('reclaim.inbox.sort', inboxSort)
    set({ inboxSort })
  },
  setInboxStatus: (inboxStatus) => {
    write('reclaim.inbox.status', inboxStatus)
    set({ inboxStatus })
  },
}))
