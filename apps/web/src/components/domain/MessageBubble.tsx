import type { ReactNode } from 'react'
import type { ThreadMessage } from '@reclaim/shared'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

/** One email: the customer's on the left, ours on the right, like a support ticket thread. */
export function MessageBubble({ m, footer }: { m: ThreadMessage; footer?: ReactNode }) {
  const ours = m.direction === 'out'
  return (
    <li className={cn('flex', ours ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg border px-3 py-2',
          ours
            ? 'rounded-br-sm border-line bg-accent-soft'
            : 'rounded-bl-sm border-line bg-surface-2',
        )}
      >
        <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
          <span className="font-medium text-fg">
            {ours ? (m.actor ? `${m.actor} · Reclaim` : 'Reclaim') : m.from}
          </span>
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

export function Attachments({ list }: { list: ThreadMessage['attachments'] }) {
  return list.map((a) =>
    a.mimeType.startsWith('image/') ? (
      <figure key={a.name} className="mt-3">
        <img src={a.url} alt={a.name} className="max-h-56 rounded border border-line" />
        <figcaption className="mt-1 text-xs text-muted">
          {a.name} · read by the model as evidence
        </figcaption>
      </figure>
    ) : (
      <div key={a.name} className="mt-2 text-xs">
        {a.name}
      </div>
    ),
  )
}
