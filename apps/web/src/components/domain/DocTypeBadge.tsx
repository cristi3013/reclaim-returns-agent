import type { DocumentType } from '@reclaim/shared'

export function DocTypeBadge({ type, compact }: { type: DocumentType | null; compact?: boolean }) {
  if (!type || type === 'NONE') return <span className="text-xs text-muted">no document</span>
  const isReturn = type === 'YRE'
  return (
    <span
      className={`inline-flex items-baseline gap-1 rounded px-1.5 py-0.5 font-mono text-xs font-medium ${isReturn ? 'bg-info-soft text-info' : 'bg-accent-soft text-green'}`}
    >
      {type}
      {!compact && <span className="font-sans font-normal text-muted">{isReturn ? 'return' : 'credit memo request'}</span>}
    </span>
  )
}
