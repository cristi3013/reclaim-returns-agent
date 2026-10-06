import type { Proposal } from '@reclaim/shared'
import { RuleBadge } from '@/components/domain/RuleBadge'
import { DocTypeBadge } from '@/components/domain/DocTypeBadge'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

/** The option a person starts from: the one already chosen, else the one the rules recommend. */
export function defaultOption(proposals: Proposal[]): string | undefined {
  return (proposals.find((p) => p.chosen) ?? proposals.find((p) => p.recommended) ?? proposals[0])
    ?.id
}

/** Option A or Option B, side by side: the person picks the one to send to approval, approve or reject. */
export function OptionPicker({
  proposals,
  value,
  onChange,
  disabled = false,
}: {
  proposals: Proposal[]
  value: string | undefined
  onChange: (id: string) => void
  disabled?: boolean
}) {
  if (proposals.length < 2) return null
  return (
    <div role="radiogroup" aria-label="Options" className="mt-3 grid gap-2 sm:grid-cols-2">
      {proposals.map((p) => {
        const d = p.decision
        const on = p.id === value
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(p.id)}
            className={cn(
              'rounded-md border p-3 text-left text-sm hover:bg-surface-2 disabled:cursor-default disabled:hover:bg-transparent',
              on ? 'border-accent bg-accent-soft/40 ring-1 ring-accent' : 'border-line',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'size-3.5 rounded-full border',
                  on ? 'border-4 border-accent' : 'border-line',
                )}
              />
              <span className="font-semibold">Option {p.option}</span>
              {p.recommended && (
                <span className="rounded bg-accent-soft px-2 py-0.5 text-xs font-medium text-green">
                  Recommended
                </span>
              )}
              {p.chosen && (
                <span className="rounded bg-ok-soft px-2 py-0.5 text-xs text-ok">Chosen</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <RuleBadge ruleId={d.ruleId} />
              <DocTypeBadge type={d.documentType} />
              <span className="font-mono tnum">
                {d.amount > 0 ? formatMoney(d.amount, d.currency) : 'no amount'}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-xs text-muted">{p.briefing.whatWePropose}</p>
          </button>
        )
      })}
    </div>
  )
}
