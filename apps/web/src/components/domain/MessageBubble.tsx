import type { ReactNode } from 'react'
import type { ThreadMessage } from '@reclaim/shared'
import { Attachments } from './Attachments'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Who wrote a message, as the conversation shows them: a name, their side or company, their colour. */
export interface Person {
  name: string
  label: string
  color: string
}

/** "Jane Doe" → "JD", "quality" → "QU". */
export function initials(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean)
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2)).toUpperCase()
}

export function Avatar({ p, className }: { p: Person; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
        className,
      )}
      style={{ backgroundColor: p.color }}
    >
      {initials(p.name)}
    </span>
  )
}

/**
 * One email: incoming on the left, ours on the right, like a support ticket thread. With `person`, the sender's
 * initials and colour mark the bubble, so several people writing on one case stay apart.
 */
export function MessageBubble({
  m,
  person,
  footer,
}: {
  m: ThreadMessage
  person?: Person
  footer?: ReactNode
}) {
  const ours = m.direction === 'out'
  return (
    <li className={cn('flex items-end gap-2', ours ? 'flex-row-reverse' : 'flex-row')}>
      {person && <Avatar p={person} />}
      <div
        className={cn(
          'max-w-[85%] rounded-lg border px-3 py-2',
          ours
            ? 'rounded-br-sm border-line bg-accent-soft'
            : 'rounded-bl-sm border-line bg-surface-2',
        )}
        style={person ? { borderLeftColor: person.color, borderLeftWidth: 3 } : undefined}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
          <span className="font-medium text-fg">
            {ours ? (m.actor ? `${m.actor} · Reclaim` : 'Reclaim') : m.from}
          </span>
          {person && !ours && (
            <span className="font-medium" style={{ color: person.color }}>
              {person.label}
            </span>
          )}
          <time dateTime={m.at}>{formatDateTime(m.at)}</time>
        </div>
        <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
          {m.text}
        </pre>
        <Attachments list={m.attachments} />
        {footer && (
          <div className="mt-1.5 border-t border-line/60 pt-1 text-xs text-muted">{footer}</div>
        )}
      </div>
    </li>
  )
}
