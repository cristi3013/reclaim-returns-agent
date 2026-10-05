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
  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-3 sm:p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 break-words text-xl font-semibold tnum sm:text-2xl ${c}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  )
}
