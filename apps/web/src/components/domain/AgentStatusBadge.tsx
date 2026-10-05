import { useStatus } from '@/api'
import { formatRelative } from '@/lib/format'

export function AgentStatusBadge() {
  const { data } = useStatus()
  if (!data) return null
  return (
    <div
      className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1 text-xs"
      title={`Agent ${data.agentId}. Status endpoint for the Control Tower: /api/status`}
    >
      <span className="size-2 rounded-full bg-ok animate-pulse-dot" aria-hidden />
      <span className="font-medium">Agent online</span>
      <span className="hidden font-mono text-muted lg:inline">{data.agentId}</span>
      <span className="tnum text-muted">
        · {data.pending} waiting
        <span className="hidden 2xl:inline">
          {data.lastRunAt ? ` · last run ${formatRelative(data.lastRunAt)}` : ''}
        </span>
      </span>
    </div>
  )
}
