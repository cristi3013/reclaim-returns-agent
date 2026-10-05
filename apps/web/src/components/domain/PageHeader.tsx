import type { ReactNode } from 'react'

/**
 * The same header on every page: a plain name, one sentence on what the page is for, and the
 * page's actions on the right. `extra` sits under the sentence (counts, connection state).
 */
export function PageHeader({
  title,
  description,
  actions,
  extra,
  eyebrow,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  extra?: ReactNode
  eyebrow?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-80">
        {eyebrow && <div className="mb-1 text-xs text-muted">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-[15px] text-muted">{description}</p>}
        {extra && <div className="mt-2">{extra}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** A section title inside a page: sentence case, readable, with an optional one-line hint. */
export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 className="text-base font-semibold">{children}</h2>
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  )
}
