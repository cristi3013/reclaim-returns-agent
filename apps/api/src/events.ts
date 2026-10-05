import type { Case, CaseEvent, EventKind, L4Step } from '@reclaim/shared'

let seq = 0
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`

/** Append one audit event to a case. Every lookup, rule, model call, approval and SAP call goes through here. */
export function ev(
  c: Case,
  kind: EventKind,
  title: string,
  detail: Record<string, unknown> = {},
  l4Step: L4Step | null = null,
  durationMs: number | null = null,
): CaseEvent {
  const e: CaseEvent = { id: uid('ev'), caseId: c.id, at: new Date().toISOString(), l4Step, kind, title, detail, durationMs }
  c.events.push(e)
  return e
}

export type LiveEvent = { type: 'case_changed'; id: string } | { type: 'status_changed' }

/** Fan-out for Server-Sent Events: the frontend subscribes to /api/events and invalidates its queries. */
export class EventHub {
  private listeners = new Set<(e: LiveEvent) => void>()
  subscribe(l: (e: LiveEvent) => void) {
    this.listeners.add(l)
    return () => {
      this.listeners.delete(l)
    }
  }
  emit(e: LiveEvent) {
    this.listeners.forEach((l) => l(e))
  }
}
