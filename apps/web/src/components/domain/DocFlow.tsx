import type { Findings, SapDocument } from '@reclaim/shared'
import { ArrowRight } from 'lucide-react'

/** The SAP document chain: order → delivery → invoice → return or credit. What VF03 "Display Document Flow" shows. */
export function DocFlow({ findings, sapDocuments }: { findings: Findings; sapDocuments: SapDocument[] }) {
  const inv = findings.invoice ?? findings.candidateInvoices[0]
  if (!inv) return null
  const it = inv.items[0]!
  const nodes: { k: string; v: string; hi?: boolean; warn?: boolean }[] = [
    { k: 'Sales order', v: it.salesOrder },
    { k: 'Delivery', v: it.delivery },
    { k: 'Invoice', v: inv.number, hi: true },
    ...sapDocuments.map((d) => ({ k: d.type === 'YRE' ? 'Return (YRE)' : 'Credit memo req. (YCR)', v: d.number, hi: true })),
    ...findings.existingReturns.map((d) => ({ k: 'Existing return', v: d.number, warn: true })),
    ...findings.existingCredits.map((d) => ({ k: 'Existing credit', v: d.number, warn: true })),
  ]
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Document flow">
      {nodes.map((n, i) => (
        <li key={`${n.k}-${n.v}`} className="flex items-center gap-2">
          {i > 0 && <ArrowRight className="size-4 text-muted" aria-hidden />}
          <div
            className={`rounded-md border px-3 py-1.5 ${
              n.warn ? 'border-warn/50 bg-warn-soft' : n.hi ? 'border-accent bg-accent-soft' : 'border-line bg-surface'
            }`}
          >
            <div className="text-[10px] uppercase tracking-wider text-muted">{n.k}</div>
            <div className="font-mono text-sm">{n.v}</div>
          </div>
        </li>
      ))}
    </ol>
  )
}
