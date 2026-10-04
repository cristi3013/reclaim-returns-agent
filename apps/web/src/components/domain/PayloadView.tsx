import { useState } from 'react'
import { toast } from 'sonner'

/** The SAP payload as readable fields, with a raw JSON view. This is what gets sent after approval, unchanged. */
export function PayloadView({ payload, title }: { payload: Record<string, unknown>; title?: string }) {
  const [raw, setRaw] = useState(false)
  const json = JSON.stringify(payload, null, 2)
  const copy = () =>
    navigator.clipboard
      ?.writeText(json)
      .then(() => toast.success('Payload copied'))
      .catch(() => toast.error('Copy is not available here'))
  return (
    <div className="rounded-md border border-line bg-surface-2">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs text-muted">
        <span>{title ?? 'SAP payload (sent unchanged after approval)'}</span>
        <div className="flex gap-3">
          <button type="button" onClick={() => setRaw(!raw)} className="underline hover:text-fg">
            {raw ? 'Fields' : 'Raw JSON'}
          </button>
          <button type="button" onClick={copy} className="underline hover:text-fg">
            Copy
          </button>
        </div>
      </div>
      {raw ? (
        <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">{json}</pre>
      ) : (
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 p-3 font-mono text-xs">
          {Object.entries(payload).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="break-all whitespace-pre-wrap">
                {Array.isArray(v) ? v.map((x) => JSON.stringify(x)).join('\n') : String(v)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
