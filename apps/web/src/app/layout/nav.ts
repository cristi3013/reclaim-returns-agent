import { LayoutDashboard, Inbox, ClipboardCheck, BarChart3, FileDown, FlaskConical } from 'lucide-react'

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/inbox', label: 'Inbox', icon: Inbox },
  { to: '/approvals', label: 'Approvals', icon: ClipboardCheck },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/reports', label: 'Reports', icon: FileDown, desktopOnly: true },
  { to: '/evaluation', label: 'Evaluation', icon: FlaskConical },
] as const

export function isActive(to: string, path: string) {
  return to === '/' ? path === '/' : to === '/inbox' ? path.startsWith('/inbox') || path.startsWith('/cases') : path.startsWith(to)
}
