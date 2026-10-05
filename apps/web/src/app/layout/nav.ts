import { Inbox, ClipboardCheck, BarChart3, FlaskConical } from 'lucide-react'

export const NAV_ITEMS = [
  { to: '/', label: 'Inbox', icon: Inbox },
  { to: '/approvals', label: 'Approvals', icon: ClipboardCheck },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/evaluation', label: 'Evaluation', icon: FlaskConical },
] as const

export function isActive(to: string, path: string) {
  return to === '/' ? path === '/' || path.startsWith('/cases') : path.startsWith(to)
}
