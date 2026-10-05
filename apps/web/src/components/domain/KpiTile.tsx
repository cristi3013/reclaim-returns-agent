export function KpiTile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'neutral' | 'ok' | 'warn' | 'bad'
}) {
  const c = { neutral: 'text-fg', ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' }[tone]
  const dot = { neutral: 'bg-line', ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }[tone]
  return (
    <div className="h-full min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card transition-shadow hover:shadow-md">
      <div className="flex items-center gap-1.5 text-sm text-muted">
        <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
        {label}
      </div>
      <div className={`mt-2 break-words text-2xl font-semibold tracking-tight tnum ${c}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  )
}
