import { useState } from 'react'
import { L4_STEPS, type CaseEvent, type EventKind } from '@reclaim/shared'
import { Cpu, Search, Scale, FileText, UserCheck, Database, AlertTriangle, Mail, Flag, Unlock } from 'lucide-react'
import { formatDateTime } from '@/lib/format'

const icon: Record<EventKind, typeof Mail> = {
  intake: Mail,
  lookup: Search,
  rule: Scale,
  model: Cpu,
  proposal: FileText,
  approval: UserCheck,
  sap_write: Database,
  sap_release: Unlock,
  status: Flag,
  error: AlertTriangle,
}

export function Timeline({ events }: { events: CaseEvent[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <ol className="relative ml-3 border-l border-line">
      {events.map((e) => {
        const Icon = icon[e.kind]
        const bad = e.kind === 'error'
        const model = e.kind === 'model'
        const sap = e.kind === 'sap_write' || e.kind === 'sap_release'
        return (
          <li key={e.id} className="ml-5 pb-4">
            <span
              className={`absolute -left-[9px] mt-1 flex size-[18px] items-center justify-center rounded-full border ${
                bad
                  ? 'border-bad bg-bad-soft text-bad'
                  : model
                    ? 'border-teal bg-info-soft text-teal'
                    : sap
                      ? 'border-accent bg-accent-soft text-green'
                      : 'border-line bg-surface text-muted'
              }`}
            >
              <Icon className="size-3" />
            </span>
            <div className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className={bad ? 'font-medium text-bad' : 'font-medium'}>{e.title}</span>
              {e.l4Step && (
                <span
                  className="rounded bg-accent-soft px-1 font-mono text-[11px] text-green"
                  title={`L4 ${e.l4Step} · ${L4_STEPS[e.l4Step].name}`}
                >
                  {e.l4Step}
                </span>
              )}
              <span className="ml-auto text-xs text-muted tnum">
                {formatDateTime(e.at)}
                {e.durationMs != null ? ` · ${e.durationMs} ms` : ''}
              </span>
            </div>
            {Object.keys(e.detail).length > 0 && (
              <button
                type="button"
                onClick={() => setOpen(open === e.id ? null : e.id)}
                aria-expanded={open === e.id}
                className="text-xs text-muted underline hover:text-fg"
              >
                {open === e.id ? 'Hide detail' : 'Detail'}
              </button>
            )}
            {open === e.id && (
              <pre className="mt-1 max-h-72 overflow-auto rounded bg-surface-2 p-2 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(e.detail, null, 2)}
              </pre>
            )}
          </li>
        )
      })}
    </ol>
  )
}
