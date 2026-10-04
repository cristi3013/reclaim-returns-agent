import type { Case, CaseEvent, EventKind, L4Step } from '@reclaim/shared'

let seq = 0
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`

/** Append an audit event to a case. Every lookup, rule, model call, approval and SAP call goes through here. */
export function ev(
  c: Case,
  kind: EventKind,
  title: string,
  detail: Record<string, unknown> = {},
  l4Step: L4Step | null = null,
  durationMs: number | null = null,
): CaseEvent {
  const e: CaseEvent = {
    id: uid('ev'),
    caseId: c.id,
    at: new Date().toISOString(),
    l4Step,
    kind,
    title,
    detail,
    durationMs,
  }
  c.events.push(e)
  return e
}
