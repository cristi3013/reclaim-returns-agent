import { Link, useRouterState } from '@tanstack/react-router'
import { useCases } from '@/api'
import { cn } from '@/lib/utils'
import { NAV_ITEMS, isActive, navCounts } from './nav'

/** Phone navigation: a fixed tab bar at the bottom, in place of the side rail. */
export function BottomTabs() {
  const path = useRouterState({ select: (s) => s.location.pathname })
  const counts = navCounts(useCases().data ?? [])
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 flex h-[calc(3.75rem+env(safe-area-inset-bottom))] border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {NAV_ITEMS.filter((n) => !('desktopOnly' in n)).map((n) => {
        const active = isActive(n.to, path)
        const count = 'badge' in n && n.badge === 'approval' ? counts.approval : 0
        const Icon = n.icon
        return (
          <Link
            key={n.to}
            to={n.to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium',
              active ? 'text-fg' : 'text-muted',
            )}
          >
            <span
              className={cn(
                'relative grid h-7 w-12 place-items-center rounded-full transition-colors',
                active && 'bg-accent-soft',
              )}
            >
              <Icon className="size-5" aria-hidden />
              {count > 0 && (
                <span
                  className="tnum absolute -top-1 right-1 min-w-4 rounded-full bg-warn px-1 text-[10px] leading-4 text-white"
                  aria-hidden
                >
                  {count}
                </span>
              )}
            </span>
            {n.short}
          </Link>
        )
      })}
    </nav>
  )
}
