import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { NAV_ITEMS, isActive } from './nav'

/** Phone navigation: a fixed tab bar at the bottom, in place of the side rail. */
export function BottomTabs() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 flex h-[calc(3.5rem+env(safe-area-inset-bottom))] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
        const active = isActive(to, path)
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
              active ? 'text-accent' : 'text-muted',
            )}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
