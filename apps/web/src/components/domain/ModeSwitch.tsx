import { cn } from '@/lib/utils'

export function ModeSwitch({
  label,
  value,
  options,
  onChange,
  tone = 'neutral',
  showLabel = true,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  tone?: 'neutral' | 'warn'
  showLabel?: boolean
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs">
      {showLabel && <span className="text-muted">{label}</span>}
      <div role="radiogroup" aria-label={label} className="flex items-center rounded-lg border border-line bg-surface-2 p-0.5">
        {options.map((o) => {
          const active = value === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={cn(
                'rounded-md px-2.5 py-1 transition-colors',
                active
                  ? tone === 'warn' && o.value !== options[0]!.value
                    ? 'bg-warn-soft text-warn font-medium'
                    : 'bg-surface text-fg font-semibold shadow-card'
                  : 'text-muted hover:text-fg',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
