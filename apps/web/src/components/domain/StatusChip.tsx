import { STATUS_LABELS, type CaseStatus } from '@reclaim/shared'
import { cn } from '@/lib/utils'

type Tone = 'neutral' | 'info' | 'warn' | 'ok' | 'bad'

const tone: Record<CaseStatus, Tone> = {
  received: 'neutral',
  investigating: 'info',
  proposed: 'info',
  awaiting_approval: 'warn',
  approved: 'ok',
  written_to_sap: 'ok',
  closed: 'ok',
  needs_customer_input: 'warn',
  handed_over: 'info',
  duplicate: 'neutral',
  rejected: 'bad',
  sap_write_failed: 'bad',
}

const cls: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted',
  info: 'bg-info-soft text-info',
  warn: 'bg-warn-soft text-warn',
  ok: 'bg-ok-soft text-ok',
  bad: 'bg-bad-soft text-bad',
}

export function StatusChip({ status, pulse }: { status: CaseStatus; pulse?: boolean }) {
  const t = tone[status]
  const live = status === 'investigating' || status === 'proposed' || pulse
  return (
    <span
      data-tone={t}
      className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium', cls[t])}
    >
      {live && <span className="size-1.5 rounded-full bg-current animate-pulse-dot" aria-hidden />}
      {STATUS_LABELS[status]}
    </span>
  )
}
