import { Link, useRouterState } from '@tanstack/react-router'
import { PanelLeft } from 'lucide-react'
import { useUi } from '@/store/ui'
import { cn } from '@/lib/utils'
import { NAV_ITEMS, isActive } from './nav'

export function NavRail() {
  const { navCollapsed, toggleNav } = useUi()
  const path = useRouterState({ select: (s) => s.location.pathname })
  return (
    <nav
      aria-label="Primary"
      className={cn(
        'hidden shrink-0 flex-col border-r border-line bg-surface py-4 transition-[width] duration-200 md:flex',
        navCollapsed ? 'w-16' : 'w-56',
      )}
    >
      <div className="mb-6 flex items-center gap-2 px-4">
        <span className="inline-block size-6 rounded-sm bg-accent" aria-hidden />
        {!navCollapsed && <span className="font-semibold tracking-tight">Reclaim</span>}
      </div>
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
        const active = isActive(to, path)
        return (
          <Link
            key={to}
            to={to}
            title={label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'mx-2 mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm border-l-2',
              active
                ? 'border-accent bg-accent-soft font-medium text-fg'
                : 'border-transparent text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            <Icon className="size-4 shrink-0" />
            {!navCollapsed && label}
          </Link>
        )
      })}
      <button
        type="button"
        onClick={toggleNav}
        className="mx-2 mt-auto flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted hover:bg-surface-2"
        aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
      >
        <PanelLeft className="size-4" />
        {!navCollapsed && 'Collapse'}
      </button>
    </nav>
  )
}
