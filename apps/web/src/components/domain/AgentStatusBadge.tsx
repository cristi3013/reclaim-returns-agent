import { useStatus } from '@/api'
import { formatRelative } from '@/lib/format'

export function AgentStatusBadge() {
  const { data } = useStatus()
  if (!data) return null
  return (
    <div
      className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface-2 px-3 py-1 text-xs"
      title="Status endpoint for the Control Tower: /api/status"
    >
      <span className="size-2 rounded-full bg-accent animate-pulse-dot" aria-hidden />
      <span className="hidden font-mono font-medium sm:inline">{data.agentId}</span>
      <span className="text-muted tnum">
        <span className="hidden sm:inline">{data.cases} cases · </span>
        {data.pending} pending
        <span className="hidden 2xl:inline">{data.lastRunAt ? ` · ran ${formatRelative(data.lastRunAt)}` : ''}</span>
      </span>
    </div>
  )
}
