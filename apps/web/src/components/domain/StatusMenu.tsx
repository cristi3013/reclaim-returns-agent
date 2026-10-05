import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, CheckCircle2, ChevronDown, CircleDot, Clock, Lock } from 'lucide-react'
import {
  MANUAL_STATUSES,
  STATUS_LABELS,
  statusChangeBlocked,
  type Case,
  type CaseStatus,
  type Role,
} from '@reclaim/shared'
import { useChangeStatus } from '@/api'
import { Button } from '@/components/ui/button'

const ICONS = { received: CircleDot, closed: CheckCircle2, needs_customer_input: Clock } as Record<
  string,
  typeof Clock
>

/**
 * "Change status" menu: Open, Pending or Closed (MANUAL_STATUSES). Nothing here touches SAP, and a case with a SAP
 * document cannot be changed.
 */
export function StatusMenu({
  c,
  role,
  actor,
  size = 'sm',
}: {
  c: Case
  role: Role
  actor: string
  size?: 'sm' | 'default'
}) {
  const change = useChangeStatus()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState<CaseStatus | null>(null)
  const [comment, setComment] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const target = MANUAL_STATUSES.find((m) => m.to === to)

  useEffect(() => {
    if (!open && !to) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)
      ) {
        setOpen(false)
        setTo(null)
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open, to])

  if (c.status === 'written_to_sap') {
    return (
      <Button
        variant="outline"
        size={size}
        disabled
        title="A SAP document exists for this case, so its status cannot be changed by hand."
      >
        <Lock className="size-3.5" /> {STATUS_LABELS[c.status]}
      </Button>
    )
  }
  const submit = () => {
    if (!to) return
    change.mutate(
      { caseId: c.id, input: { actor, role, to, comment } },
      {
        onSuccess: () => {
          toast.success(`Status set to ${target?.label ?? STATUS_LABELS[to]}`)
          setTo(null)
          setComment('')
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : 'The status did not change'),
      },
    )
  }

  return (
    <div ref={box} className="relative">
      <Button
        variant="outline"
        size={size}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          setTo(null)
        }}
      >
        Change status <ChevronDown className="size-3.5" />
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-64 rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          {MANUAL_STATUSES.map((m) => {
            const current = c.status === m.to
            const blocked = current ? null : statusChangeBlocked(c, m.to, role)
            const Icon = ICONS[m.to] ?? Clock
            return (
              <button
                key={m.to}
                type="button"
                role="menuitem"
                disabled={current || !!blocked}
                onClick={() => {
                  setTo(m.to)
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                <span className={`min-w-0 flex-1 ${blocked ? 'opacity-50' : ''}`}>
                  <span className="block font-medium">{m.label}</span>
                  <span className="block text-xs text-muted">
                    {current ? 'Current status' : (blocked?.message ?? m.hint)}
                  </span>
                </span>
                {current && <Check className="mt-0.5 size-4 shrink-0 text-fg" aria-hidden />}
              </button>
            )
          })}
        </div>
      )}

      {to && (
        <div className="absolute right-0 z-20 mt-1 w-80 rounded-md border border-line bg-surface p-3 shadow-lg">
          <div className="text-sm font-medium">
            {STATUS_LABELS[c.status]} → {target?.label}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {target?.hint} Earlier decisions stay in the audit trail.
          </p>
          <label htmlFor="status-reason" className="mt-2 block text-xs font-medium">
            Why? (kept in the audit trail)
          </label>
          <textarea
            id="status-reason"
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={
              to === 'closed'
                ? 'e.g. Customer did not answer'
                : to === 'needs_customer_input'
                  ? 'e.g. Asked the customer for the invoice number'
                  : 'e.g. Customer sent the correct invoice number'
            }
            className="mt-1 min-h-16 w-full rounded-md border border-line bg-surface p-2 text-sm"
          />
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setTo(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!comment.trim() || change.isPending} onClick={submit}>
              {change.isPending ? 'Saving…' : `Set to ${target?.label}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
