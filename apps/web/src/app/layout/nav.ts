import { BarChart3, ClipboardCheck, FileDown, FolderOpen,Home, Inbox, Radar, ShieldCheck } from 'lucide-react'
import type { CaseSummary } from '@reclaim/shared'

/**
 * Page names say what you do there. `short` is the phone tab label, `group` the heading in the
 * side rail, `badge` the count shown next to the name.
 */
export const NAV_ITEMS = [
  { to: '/', label: 'Home', short: 'Home', icon: Home, group: 'Daily work' },
  {
    to: '/inbox',
    label: 'Inbox',
    short: 'Inbox',
    icon: Inbox,
    group: 'Daily work',
    badge: 'open',
  },
  { to: '/invoices', label: 'Cases', short: 'Cases', icon: FolderOpen, group: 'Daily work' },
  {
    to: '/approvals',
    label: 'To approve',
    short: 'Approve',
    icon: ClipboardCheck,
    group: 'Daily work',
    badge: 'approval',
  },
  { to: '/analytics', label: 'Insights', short: 'Insights', icon: BarChart3, group: 'Results' },
  {
    to: '/reports',
    label: 'Reports',
    short: 'Reports',
    icon: FileDown,
    group: 'Results',
    desktopOnly: true,
  },
  {
    to: '/control-tower',
    label: 'Control Tower',
    short: 'Tower',
    icon: Radar,
    group: 'Results',
    desktopOnly: true,
  },
  {
    to: '/evaluation',
    label: 'Quality check',
    short: 'Quality',
    icon: ShieldCheck,
    group: 'Results',
  },
] as const

export const NAV_GROUPS = ['Daily work', 'Results'] as const

/** Open = our turn (new or reopened); approval = waiting for an approver. */
export function navCounts(rows: CaseSummary[]) {
  return {
    open: rows.filter((r) => r.status === 'received').length,
    approval: rows.filter((r) => r.status === 'awaiting_approval').length,
  }
}

export function isActive(to: string, path: string) {
  return to === '/'
    ? path === '/'
    : to === '/inbox'
      ? path.startsWith('/inbox') || path.startsWith('/cases')
      : path.startsWith(to)
}
