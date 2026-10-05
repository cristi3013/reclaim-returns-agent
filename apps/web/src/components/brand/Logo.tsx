import { cn } from '@/lib/utils'

/**
 * The Reclaim mark: a return arrow looping around a check. Goods come back, a person approves.
 * Uses the accent tokens, so it follows light and dark mode. Same drawing as public/icons/favicon.svg.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-8 shrink-0', className)} aria-hidden>
      <rect width="64" height="64" rx="15" fill="var(--accent)" />
      <g fill="none" stroke="var(--accent-fg)" strokeLinecap="round" strokeLinejoin="round">
        <path d="M46.7 23.5A17 17 0 1 1 29 15.3" strokeWidth="5" />
        <path d="M25.5 32.5l4.5 4.5 8.5-9" strokeWidth="4.5" />
      </g>
      <path d="M27.2 10.2l7.4 4.1-5.9 6.1z" fill="var(--accent-fg)" />
    </svg>
  )
}

/** Mark plus name, for the sidebar and the sign-in page. */
export function Logo({ subtitle, className }: { subtitle?: string; className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="min-w-0 leading-tight">
        <span className="block font-semibold tracking-tight">Reclaim</span>
        {subtitle && <span className="block truncate text-xs text-muted">{subtitle}</span>}
      </span>
    </span>
  )
}
