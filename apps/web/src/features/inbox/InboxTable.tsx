import { COMPLAINT_LABELS, ROLE_LABELS, type CaseSummary } from '@reclaim/shared'
import { StatusChip } from '@/components/domain/StatusChip'
import { RuleBadge } from '@/components/domain/RuleBadge'
import { DocTypeBadge } from '@/components/domain/DocTypeBadge'
import { formatDateTime, formatMoney, formatRelative } from '@/lib/format'

const th = 'px-3 py-2 text-left font-semibold'

export function InboxTable({ rows, onOpen }: { rows: CaseSummary[]; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
      <table className="w-full min-w-[1180px] text-sm">
        <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-muted">
          <tr>
            <th className={th}>Received</th>
            <th className={th}>Complaint</th>
            <th className={th}>Invoice</th>
            <th className={th}>Type</th>
            <th className={th}>Rule</th>
            <th className={th}>Proposed</th>
            <th className={`${th} text-right`}>Amount</th>
            <th className={th}>Approver</th>
            <th className={th}>Status</th>
            <th className={th}>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onOpen(r.id)}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(r.id)}
              className="cursor-pointer border-t border-line outline-none hover:bg-surface-2 focus:bg-surface-2"
            >
              <td className="whitespace-nowrap px-3 py-2 tnum text-muted">{formatDateTime(r.receivedAt)}</td>
              <td className="min-w-0 px-3 py-2">
                <div className="max-w-[22rem] truncate font-medium">{r.subject}</div>
                <div className="max-w-[22rem] truncate text-xs text-muted">{r.from}</div>
              </td>
              <td className="px-3 py-2 font-mono">{r.invoiceNumber ?? <span className="text-muted">none</span>}</td>
              <td className="whitespace-nowrap px-3 py-2">{COMPLAINT_LABELS[r.complaintType]}</td>
              <td className="px-3 py-2">
                <RuleBadge ruleId={r.ruleId} />
              </td>
              <td className="px-3 py-2">{r.ruleId ? <DocTypeBadge type={r.documentType} compact /> : <span className="text-muted">–</span>}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tnum">
                {r.amount != null && r.amount > 0 ? formatMoney(r.amount, r.currency) : '–'}
              </td>
              <td className="whitespace-nowrap px-3 py-2">{r.approverRole ? ROLE_LABELS[r.approverRole] : '–'}</td>
              <td className="px-3 py-2">
                <StatusChip status={r.status} />
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-muted">{formatRelative(r.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
