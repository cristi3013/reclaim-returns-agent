import type { Case } from '@reclaim/shared'
import { FileQuestion, SearchX } from 'lucide-react'
import { DocFlow } from '@/components/domain/DocFlow'
import { formatDate, formatMoney, formatQty } from '@/lib/format'

export function SapFindingsPanel({ c }: { c: Case }) {
  const f = c.findings
  if (!f) {
    return (
      <section className="rounded-lg border border-line bg-surface p-4 text-sm text-muted shadow-card">
        <h2 className="text-base font-semibold text-fg">What we found in SAP</h2>
        <p className="mt-2">Not investigated yet. Run the agent to look up the invoice, its history and any existing credits.</p>
      </section>
    )
  }
  const inv = f.invoice ?? f.candidateInvoices[0]
  const it = inv?.items[0]
  const priceMatches = f.agreedUnitPrice != null && it != null && f.agreedUnitPrice === it.unitPrice
  const ic = !!f.plantCompanyCode && !!inv && f.plantCompanyCode !== inv.companyCode
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-card">
      <h2 className="text-base font-semibold text-fg">What we found in SAP</h2>
      {!f.invoice && f.candidateInvoices.length > 0 && (
        <p className="mt-2 rounded bg-warn-soft px-3 py-2 text-sm text-warn">
          No invoice number in the email. Searched the customer's invoices for material {c.facts?.material} and found{' '}
          {f.candidateInvoices.length} candidate{f.candidateInvoices.length > 1 ? 's' : ''}. The customer must confirm before anything is created.
        </p>
      )}
      {!inv && <NothingInSap invoiceNumber={c.facts?.invoiceNumber ?? null} />}
      {inv && it && (
        <>
          <div className="mt-3">
            <DocFlow findings={f} sapDocuments={c.sapDocuments} />
          </div>
          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted">Invoice</dt>
            <dd className="font-mono">
              {inv.number} · {formatDate(inv.date)} · type YF2
            </dd>
            <dt className="text-muted">Customer</dt>
            <dd>
              {inv.customerName} ({inv.customer})
            </dd>
            <dt className="text-muted">Sales area</dt>
            <dd className="font-mono">
              {inv.salesOrg}/{inv.distributionChannel}/{inv.division} · company {inv.companyCode}
            </dd>
            <dt className="text-muted">Item {it.item}</dt>
            <dd>
              {it.description} · material <span className="font-mono">{it.material}</span> · {formatQty(it.quantity, it.unit)} ×{' '}
              {formatMoney(it.unitPrice, inv.currency)} = <span className="font-mono tnum">{formatMoney(it.netAmount, inv.currency)}</span> · plant{' '}
              <span className="font-mono">{it.plant}</span>
            </dd>
            {f.agreedUnitPrice != null && (
              <>
                <dt className="text-muted">Agreed price (PR00)</dt>
                <dd className={`tnum ${priceMatches ? 'text-ok' : 'text-warn'}`}>
                  {formatMoney(f.agreedUnitPrice, inv.currency)} per {it.unit} · invoiced {formatMoney(it.unitPrice, inv.currency)}{' '}
                  {priceMatches ? '· matches, no credit due' : '· differs'}
                </dd>
              </>
            )}
            <dt className="text-muted">Existing documents</dt>
            <dd>
              {f.existingReturns.length + f.existingCredits.length === 0 ? (
                <span className="text-ok">none for this invoice</span>
              ) : (
                [...f.existingReturns, ...f.existingCredits].map((d) => (
                  <span key={d.number} className="mr-2 font-mono text-warn">
                    {d.type} {d.number} (block {d.billingBlock || 'released'})
                  </span>
                ))
              )}
            </dd>
            {ic && (
              <>
                <dt className="text-muted">Intercompany</dt>
                <dd className="text-warn">
                  Sold by {inv.companyCode}, shipped from a {f.plantCompanyCode} plant. A matching intercompany credit is flagged for finance (step 5.2.2).
                </dd>
              </>
            )}
            <dt className="text-muted">Version stamp</dt>
            <dd className="font-mono text-xs text-muted">{inv.etag}</dd>
          </dl>
        </>
      )}
      <div className="mt-3 text-xs text-muted">
        {f.lookups.length === 0
          ? 'No SAP lookups were needed.'
          : `${f.lookups.length} SAP lookup${f.lookups.length > 1 ? 's' : ''} via the gateway · ${f.lookups.reduce((s, l) => s + l.durationMs, 0)} ms · read only`}
      </div>
    </section>
  )
}

/** No invoice to show: say why in plain words and what the person can do about it. */
function NothingInSap({ invoiceNumber }: { invoiceNumber: string | null }) {
  const Icon = invoiceNumber ? SearchX : FileQuestion
  return (
    <div className="mt-3 flex gap-3 rounded-md border border-dashed border-line bg-surface-2 p-4">
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
