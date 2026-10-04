import { toast } from 'sonner'
import type { Case } from '@reclaim/shared'
import { Timeline } from '@/components/domain/Timeline'
import { Button } from '@/components/ui/button'

export function AuditTimeline({ c }: { c: Case }) {
  const exportJson = () =>
    navigator.clipboard
      ?.writeText(
        JSON.stringify(
          { case: c.id, exportedAt: new Date().toISOString(), events: c.events, approvals: c.approvals, sapDocuments: c.sapDocuments },
          null,
          2,
        ),
      )
      .then(() => toast.success('Audit trail copied as JSON'))
      .catch(() => toast.error('Copy is not available here'))
  const sapCalls = c.events.filter((e) => e.kind === 'lookup' || e.kind === 'sap_write' || e.kind === 'sap_release').length
  const modelCalls = c.events.filter((e) => e.kind === 'model').length
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="text-sm text-muted">
          {c.events.length} events · {sapCalls} SAP calls · {modelCalls} model calls · every step carries its L4 process step
        </div>
        <Button variant="outline" size="sm" onClick={exportJson}>
          Export JSON
        </Button>
      </div>
      {c.events.length ? <Timeline events={c.events} /> : <div className="text-sm text-muted">No events yet.</div>}
    </div>
  )
}
