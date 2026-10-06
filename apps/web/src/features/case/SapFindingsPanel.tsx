import type { ReactNode } from 'react'
import type { Case } from '@reclaim/shared'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileQuestion,
  Info,
  SearchX,
} from 'lucide-react'
import { DocFlow } from '@/components/domain/DocFlow'
import { formatDate, formatMoney, formatQty } from '@/lib/format'

/** A pass, a warning or a plain fact: one line of the SAP check. */
function Check({ tone, children }: { tone: 'ok' | 'warn' | 'info'; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'warn' ? AlertTriangle : Info
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-muted'
  return (
    <li className="flex gap-2">
      <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden />
      <span className="min-w-0">{children}</span>
    </li>
  )
}

/**
 * What the agent read in SAP, at a glance for the sidebar: the invoice line and the checks that matter for the
 * decision (existing documents, agreed price, intercompany). The document flow and the technical details fold away.
 */
export function SapFindingsPanel({ c }: { c: Case }) {
  const f = c.findings
  if (!f) {
    return (
      <section className="rounded-lg border border-line bg-surface p-4 text-sm text-muted shadow-card">
        <h2 className="text-sm font-semibold text-fg">What we found in SAP</h2>
        <p className="mt-1">
          Not investigated yet. Run the agent to look up the invoice, its history and any existing
          credits.
        </p>
      </section>
    )
  }
  const inv = f.invoice ?? f.candidateInvoices[0]
  const it = inv?.items[0]
  const priceMatches = f.agreedUnitPrice != null && it != null && f.agreedUnitPrice === it.unitPrice
  const ic = !!f.plantCompanyCode && !!inv && f.plantCompanyCode !== inv.companyCode
  const existing = [...f.existingReturns, ...f.existingCredits]
  const lookups = f.lookups.length
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">What we found in SAP</h2>
        <span className="text-[11px] text-muted">read only</span>
      </div>
      {!f.invoice && f.candidateInvoices.length > 0 && (
        <p className="mt-2 rounded bg-warn-soft px-2.5 py-1.5 text-xs text-warn">
          No invoice number in the email. {f.candidateInvoices.length} candidate
          {f.candidateInvoices.length > 1 ? 's' : ''} for material {c.facts?.material}: the
          customer must confirm before anything is created.
        </p>
      )}
      {!inv && <NothingInSap invoiceNumber={c.facts?.invoiceNumber ?? null} />}
      {inv && it && (
        <>
          <div className="mt-2">
            <div className="font-mono text-sm font-medium">
              {inv.number}{' '}
              <span className="font-sans text-xs font-normal text-muted">
                · {formatDate(inv.date)}
              </span>
            </div>
            <div className="text-xs text-muted">
              {inv.customerName} ({inv.customer})
            </div>
          </div>
          <div className="mt-2 rounded-md bg-surface-2 px-2.5 py-2 text-xs">
            <div className="truncate font-medium text-fg" title={it.description}>
              {it.description}
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-2 text-muted">
              <span className="tnum">
                {formatQty(it.quantity, it.unit)} × {formatMoney(it.unitPrice, inv.currency)}
              </span>
              <span className="font-mono tnum text-fg">
                {formatMoney(it.netAmount, inv.currency)}
              </span>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5 text-xs" aria-label="SAP checks">
            {existing.length === 0 ? (
              <Check tone="ok">No return or credit yet for this invoice</Check>
            ) : (
              <Check tone="warn">
                Already in SAP:{' '}
                {existing.map((d) => (
                  <span key={d.number} className="mr-1 font-mono">
                    {d.type} {d.number}
                  </span>
                ))}
              </Check>
            )}
            {f.agreedUnitPrice != null && (
              <Check tone={priceMatches ? 'ok' : 'warn'}>
                Agreed price {formatMoney(f.agreedUnitPrice, inv.currency)} per {it.unit}
                {priceMatches
                  ? ': matches the invoice, no credit due'
                  : `: invoiced ${formatMoney(it.unitPrice, inv.currency)}`}
              </Check>
            )}
            {ic && (
              <Check tone="warn">
                Intercompany: sold by {inv.companyCode}, shipped from a {f.plantCompanyCode} plant.
                Flagged for finance.
              </Check>
            )}
          </ul>
          <details className="group mt-3 border-t border-line pt-2 text-xs">
            <summary className="flex cursor-pointer select-none items-center gap-1 text-muted hover:text-fg">
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
              Document flow and details
            </summary>
            <div className="mt-2 space-y-3">
              <DocFlow findings={f} sapDocuments={c.sapDocuments} />
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted">Sales area</dt>
                <dd className="font-mono">
                  {inv.salesOrg}/{inv.distributionChannel}/{inv.division}
                </dd>
                <dt className="text-muted">Company</dt>
                <dd className="font-mono">{inv.companyCode}</dd>
                <dt className="text-muted">Item</dt>
                <dd>
                  {it.item} · material <span className="font-mono">{it.material}</span> · plant{' '}
                  <span className="font-mono">{it.plant}</span>
                </dd>
                <dt className="text-muted">Version stamp</dt>
                <dd className="break-all font-mono text-muted">{inv.etag}</dd>
              </dl>
            </div>
          </details>
        </>
      )}
      <div className="mt-2 text-[11px] text-muted">
        {lookups === 0
          ? 'No SAP lookups were needed.'
          : `${lookups} SAP lookup${lookups > 1 ? 's' : ''} via the gateway · ${f.lookups.reduce((s, l) => s + l.durationMs, 0)} ms`}
      </div>
    </section>
  )
}

/** No invoice to show: say why in plain words and what the person can do about it. */
function NothingInSap({ invoiceNumber }: { invoiceNumber: string | null }) {
  const Icon = invoiceNumber ? SearchX : FileQuestion
  return (
    <div className="mt-2 flex gap-2.5 rounded-md border border-dashed border-line bg-surface-2 p-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-muted" aria-hidden />
      <div className="text-sm">
        <div className="font-medium">
          {invoiceNumber ? (
            <>
              Invoice <span className="font-mono">{invoiceNumber}</span> isn't in SAP
            </>
          ) : (
            'No invoice to look up'
          )}
        </div>
        <p className="mt-0.5 text-muted">
          {invoiceNumber
            ? 'The number may be mistyped, or belong to another system. Nothing can be credited against it.'
            : "The email doesn't mention an invoice number, and there was no customer and material to search with."}
        </p>
        <p className="mt-2 text-muted">
          <span className="font-medium text-fg">Next:</span> decide above, then ask the customer for the correct
          invoice number in your reply.
        </p>
      </div>
    </div>
  )
}
