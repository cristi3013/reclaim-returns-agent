import { Link, useRouterState } from '@tanstack/react-router'
import { PanelLeft } from 'lucide-react'
import { useCases } from '@/api'
import { useUi } from '@/store/ui'
import { cn } from '@/lib/utils'
import { LogoMark } from '@/components/brand/Logo'
import { NAV_GROUPS, NAV_ITEMS, isActive, navCounts } from './nav'

export function NavRail() {
  const { navCollapsed, toggleNav } = useUi()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const counts = navCounts(useCases().data ?? [])
  return (
    <nav
      aria-label="Primary"
      className={cn(
        'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-line bg-surface py-4 transition-[width] duration-200 md:flex',
        navCollapsed ? 'w-16' : 'w-60',
      )}
    >
      <Link to="/" className="mb-6 flex items-center gap-2.5 px-4" aria-label="Reclaim home">
        <LogoMark />
        {!navCollapsed && (
          <span className="min-w-0 leading-tight">
            <span className="block font-semibold tracking-tight">Reclaim</span>
            <span className="block truncate text-xs text-muted">Returns &amp; credit notes</span>
          </span>
        )}
      </Link>
      {NAV_GROUPS.map((group) => (
        <div key={group} className="mb-4">
          {!navCollapsed && <div className="mb-1 px-5 text-xs font-medium text-muted">{group}</div>}
          {NAV_ITEMS.filter((n) => n.group === group).map((n) => {
            const active = isActive(n.to, path)
            const badge = 'badge' in n ? n.badge : null
            const count = badge ? counts[badge] : 0
            const Icon = n.icon
            return (
              <Link
                key={n.to}
                to={n.to}
                title={navCollapsed ? n.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative mx-2 mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-accent-soft font-semibold text-fg'
                    : 'text-muted hover:bg-surface-2 hover:text-fg',
                )}
              >
                {active && (
                  <span
                    className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-accent"
                    aria-hidden
                  />
                )}
                <Icon className="size-[18px] shrink-0" />
                {!navCollapsed && <span className="flex-1">{n.label}</span>}
                {count > 0 && (
                  <span
                    className={cn(
                      'tnum rounded-full px-1.5 text-xs font-semibold leading-5',
                      badge === 'approval' ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-fg',
                      navCollapsed && 'absolute -top-1 right-0 min-w-5 text-center',
                    )}
                    aria-label={`${count} ${badge === 'approval' ? 'waiting' : 'open'}`}
                  >
                    {count}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}
      <button
        type="button"
        onClick={toggleNav}
        className="mx-2 mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-fg"
        aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
      >
        <PanelLeft className="size-[18px]" />
        {!navCollapsed && 'Collapse'}
      </button>
    </nav>
  )
}
