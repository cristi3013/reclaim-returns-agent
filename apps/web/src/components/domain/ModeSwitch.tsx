import { cn } from '@/lib/utils'

export function ModeSwitch({
  label,
  value,
  options,
  onChange,
  tone = 'neutral',
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  tone?: 'neutral' | 'warn'
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs">
      <span className="text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex items-center rounded-md border border-line bg-surface p-0.5">
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
                'rounded px-2 py-1 transition-colors',
                active
                  ? tone === 'warn' && o.value !== options[0]!.value
                    ? 'bg-warn-soft text-warn font-medium'
                    : 'bg-fg text-bg font-medium'
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
