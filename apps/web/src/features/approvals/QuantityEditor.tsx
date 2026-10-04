import { useState } from 'react'
import { formatMoney } from '@/lib/format'

/** Lets the approver reduce the quantity. Never above the invoiced quantity, never zero. The amount follows. */
export function QuantityEditor({
  value,
  max,
  unit,
  unitPrice,
  currency,
  onChange,
}: {
  value: number
  max: number
  unit: string | null
  unitPrice: number
  currency: string
  onChange: (r: { quantity: number; valid: boolean }) => void
}) {
  const [v, setV] = useState(String(value))
  const n = Number(v)
  const valid = Number.isFinite(n) && n > 0 && n <= max
  return (
    <div className="text-sm">
      <label className="flex items-center gap-2">
        <span>Quantity</span>
        <input
          aria-label="Quantity"
          aria-invalid={!valid}
          aria-describedby={valid ? undefined : 'qty-error'}
          type="number"
          min={0}
          max={max}
          step="0.001"
          value={v}
          onChange={(e) => {
            setV(e.target.value)
            const q = Number(e.target.value)
            onChange({ quantity: q, valid: Number.isFinite(q) && q > 0 && q <= max })
          }}
          className={`h-8 w-24 rounded-md border bg-surface px-2 tnum ${valid ? 'border-line' : 'border-bad'}`}
        />
        <span className="text-muted">
          {unit} · {max} {unit} invoiced
        </span>
      </label>
      {!valid && (
        <div id="qty-error" className="mt-1 text-xs text-bad">
          Quantity cannot exceed {max} {unit} and must be above 0.
        </div>
      )}
      <div className="mt-1 text-muted">
        Amount: <span className="font-mono tnum text-fg">{valid ? formatMoney(n * unitPrice, currency) : '–'}</span>
      </div>
    </div>
  )
}
