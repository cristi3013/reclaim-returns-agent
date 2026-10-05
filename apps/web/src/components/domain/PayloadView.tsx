import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check, Copy, FileText } from 'lucide-react'
import { BILLING_BLOCK, REASON_CODES } from '@reclaim/shared'
import { cn } from '@/lib/utils'

type Item = Record<string, unknown>

const DOC_TYPES: Record<string, string> = {
  YRE: 'Return order',
  YCR: 'Credit memo request',
}

/** Keys shown in the readable view; anything else lands under "Other fields" so nothing is hidden. */
const KNOWN = new Set([
  'CustomerReturnType',
  'CreditMemoRequestType',
  'SoldToParty',
  'ReferenceSDDocument',
  'SDDocumentReason',
  'HeaderBillingBlockReason',
  'SalesOrganization',
  'DistributionChannel',
  'OrganizationDivision',
  'PurchaseOrderByCustomer',
  'to_Item',
])

const str = (v: unknown) => (v == null || v === '' ? '' : String(v))

/** The SAP payload in plain words, with the raw JSON one click away. This is what gets sent after approval, unchanged. */
export function PayloadView({
  payload,
  title,
}: {
  payload: Record<string, unknown>
  title?: string
}) {
  const [raw, setRaw] = useState(false)
  const [copied, setCopied] = useState(false)
  const json = JSON.stringify(payload, null, 2)
  const copy = () =>
    navigator.clipboard
      ?.writeText(json)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
        toast.success('Payload copied')
      })
      .catch(() => toast.error('Copy is not available here'))

  const type = str(payload.CreditMemoRequestType ?? payload.CustomerReturnType)
  const items = Array.isArray(payload.to_Item) ? (payload.to_Item as Item[]) : []
  const invoice = str(payload.ReferenceSDDocument) || str(items[0]?.ReferenceSDDocument)
  const reason = str(payload.SDDocumentReason)
  const reasonLabel = (REASON_CODES as Record<string, string>)[reason]
  const block = str(payload.HeaderBillingBlockReason)
  const salesArea = [
    payload.SalesOrganization,
    payload.DistributionChannel,
    payload.OrganizationDivision,
  ]
    .map(str)
    .filter(Boolean)
  const other = Object.entries(payload).filter(([k]) => !KNOWN.has(k))

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <FileText className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="truncate font-medium">{title ?? 'What goes to SAP'}</span>
          {!title && (
            <span className="hidden truncate text-xs text-muted sm:inline">
              · sent exactly like this after approval
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div
            className="flex rounded-md border border-line p-0.5 text-xs"
            role="group"
            aria-label="Payload view"
          >
            <ViewTab on={!raw} onClick={() => setRaw(false)}>
              Readable
            </ViewTab>
            <ViewTab on={raw} onClick={() => setRaw(true)}>
              Raw JSON
            </ViewTab>
          </div>
          <button
            type="button"
            onClick={copy}
            aria-label="Copy payload"
            title="Copy JSON"
            className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </button>
        </div>
      </div>

      {raw ? (
        <pre className="max-h-80 overflow-auto bg-surface-2 p-3 font-mono text-xs leading-relaxed">
          {json}
        </pre>
      ) : (
        <div className="space-y-3 p-3">
          {type && (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-base font-semibold">{DOC_TYPES[type] ?? 'SAP document'}</span>
              <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                {type}
              </span>
              {(payload.SoldToParty != null || invoice) && (
                <span className="text-sm text-muted">
                  {payload.SoldToParty != null && (
                    <>
                      for customer <Mono>{str(payload.SoldToParty)}</Mono>
                    </>
                  )}
                  {invoice && (
                    <>
                      {' '}
                      against invoice <Mono>{invoice}</Mono>
                    </>
                  )}
                </span>
              )}
            </div>
          )}

          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {reason && (
              <Fact label="Reason">
                {reasonLabel ?? 'Order reason'} <Code>{reason}</Code>
              </Fact>
            )}
            {block && (
              <Fact label="Billing block">
                {block === BILLING_BLOCK ? 'Held until released' : 'Billing block'}{' '}
                <Code>{block}</Code>
              </Fact>
            )}
            {salesArea.length > 0 && (
              <Fact label="Sales area">
                <Mono>{salesArea.join(' / ')}</Mono>
              </Fact>
            )}
            {str(payload.PurchaseOrderByCustomer) && (
              <Fact label="Complaint reference">
                <Mono>{str(payload.PurchaseOrderByCustomer)}</Mono>
              </Fact>
            )}
            {other.map(([k, v]) => (
              <Fact key={k} label={humanize(k)}>
                <Mono>{typeof v === 'object' ? JSON.stringify(v) : str(v)}</Mono>
              </Fact>
            ))}
          </dl>

          {items.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-1.5 font-medium">Material</th>
                    <th className="px-3 py-1.5 text-right font-medium">Quantity</th>
                    <th className="px-3 py-1.5 font-medium">From invoice line</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="px-3 py-1.5">
                        <Mono>{str(it.Material) || '—'}</Mono>
                      </td>
                      <td className="tnum px-3 py-1.5 text-right">
                        {str(it.RequestedQuantity) || '—'}{' '}
                        <span className="text-muted">{str(it.RequestedQuantityUnit)}</span>
                      </td>
                      <td className="px-3 py-1.5 text-muted">
                        {it.ReferenceSDDocument ? (
                          <>
                            <Mono>{str(it.ReferenceSDDocument)}</Mono>
                            {it.ReferenceSDDocumentItem
                              ? ` · item ${str(it.ReferenceSDDocumentItem)}`
                              : ''}
                          </>
                        ) : invoice ? (
                          <Mono>{invoice}</Mono>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ViewTab({
  on,
  onClick,
  children,
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded px-2 py-0.5 transition-colors',
        on ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  )
}

const Mono = ({ children }: { children: ReactNode }) => (
  <span className="tnum font-mono text-[13px]">{children}</span>
)

const Code = ({ children }: { children: ReactNode }) => (
  <span className="ml-1 rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-muted">
    {children}
  </span>
)

/** "SomeSapField" → "Some sap field" */
function humanize(k: string) {
  const s = k.replace(/^to_/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}
