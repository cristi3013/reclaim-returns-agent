import { Fragment, useState, type ReactNode } from 'react'
import { participantKey, participants, type Participant, type ThreadMessage } from '@reclaim/shared'
import { cn } from '@/lib/utils'
import { Avatar, MessageBubble, type Person } from './MessageBubble'

/** One colour per person, in the order they first wrote. The customer and the desk keep theirs. */
const CUSTOMER = '#2563eb'
const US = '#0f766e'
const OTHERS = ['#7c3aed', '#c2410c', '#be185d', '#4d7c0f', '#0e7490', '#a16207']

const SIDE_LABEL = { customer: 'Customer', us: 'Reclaim' } as const

function people(list: Participant[]): Map<string, Person> {
  let n = 0
  return new Map(
    list.map((p) => [
      p.key,
      {
        name: p.name,
        label: p.side === 'other' ? (p.organisation ?? 'Other') : SIDE_LABEL[p.side],
        color:
          p.side === 'customer' ? CUSTOMER : p.side === 'us' ? US : OTHERS[n++ % OTHERS.length]!,
      },
    ]),
  )
}

/**
 * The emails of a case as a chat: each person in their own colour, and a row of everyone who wrote, so the desk sees
 * who said what and can read one person's emails on their own. `extras` adds a separator before or a footer under a message.
 */
export function Conversation({
  messages,
  customerFrom,
  label,
  extras,
}: {
  messages: ThreadMessage[]
  customerFrom: string
  label: string
  extras?: (m: ThreadMessage) => { before?: ReactNode; footer?: ReactNode }
}) {
  const [only, setOnly] = useState<string | null>(null)
  const list = participants(messages, customerFrom)
  const byKey = people(list)
  const shown = only ? messages.filter((m) => participantKey(m) === only) : messages

  return (
    <div>
      {list.length > 1 && (
        <div
          className="mt-3 flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="People in this conversation"
        >
          {list.map((p) => {
            const person = byKey.get(p.key)!
            const active = only === p.key
            return (
              <button
                key={p.key}
                type="button"
                aria-pressed={active}
                onClick={() => setOnly(active ? null : p.key)}
                title={p.address ?? undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-xs hover:bg-surface-2',
                  active ? 'border-fg bg-surface-2' : 'border-line',
                )}
              >
                <Avatar p={person} className="size-5" />
                <span className="font-medium text-fg">{p.name}</span>
                <span className="text-muted">
                  {person.label} · {p.messages}
                </span>
              </button>
            )
          })}
          {only && (
            <button
              type="button"
              onClick={() => setOnly(null)}
              className="text-xs font-medium text-muted hover:text-fg hover:underline"
            >
              Show everyone
            </button>
          )}
        </div>
      )}
      <ol className="mt-3 space-y-3" aria-label={label}>
        {shown.map((m) => {
          const x = only ? {} : (extras?.(m) ?? {})
          return (
            <Fragment key={m.id}>
              {x.before}
              <MessageBubble m={m} person={byKey.get(participantKey(m))} footer={x.footer} />
            </Fragment>
          )
        })}
      </ol>
    </div>
  )
}
