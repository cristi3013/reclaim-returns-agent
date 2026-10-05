import { useState } from 'react'
import { computeValue, DEFAULT_VALUE_INPUT, type ValueInput } from './value'
import { KpiTile } from '@/components/domain/KpiTile'
import { formatMoney } from '@/lib/format'

type Field = { key: keyof ValueInput; label: string; hint?: string; percent?: boolean; unit?: string }

const FIELDS: Field[] = [
  { key: 'casesPerMonth', label: 'Complaints per month' },
  { key: 'minutesToday', label: 'Minutes per complaint today', hint: 'find invoice, decide, create documents, follow up' },
  { key: 'minutesWithAgent', label: 'Minutes per complaint with the agent', hint: 'review and approve' },
  { key: 'costPerHour', label: 'Loaded cost per hour', unit: 'EUR' },
  { key: 'errorRateToday', label: 'Complaints handled wrongly today', hint: 'credit too high, wrong reason, intercompany forgotten', percent: true },
  { key: 'sharePrevented', label: 'Share the agent prevents', percent: true },
  { key: 'lossPerError', label: 'Average loss per wrong handling', unit: 'EUR' },
  { key: 'valuePerCase', label: 'Average credit value per case', unit: 'EUR' },
  { key: 'daysFaster', label: 'Days faster to credit' },
  { key: 'costOfCapital', label: 'Cost of capital', percent: true },
]

export interface Measured {
  agentSeconds: number | null
  minutesToDecision: number | null
  cases: number
  casesLast24h: number
  duplicatesPrevented: number
  intercompanyFlagged: number
}

export function ValueCalculator({ measured }: { measured?: Measured }) {
  const [input, setInput] = useState<ValueInput>(DEFAULT_VALUE_INPUT)
  const r = computeValue(input)
  const set = (k: keyof ValueInput, raw: string, percent?: boolean) => {
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    setInput({ ...input, [k]: percent ? n / 100 : n })
  }
  return (
    <section className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold">What is this agent worth?</h2>
        <button type="button" onClick={() => setInput(DEFAULT_VALUE_INPUT)} className="text-xs text-muted underline hover:text-fg">
          Reset assumptions
        </button>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Every value is an editable assumption for a mid-sized business unit, not a measurement. Replace them with the numbers of the business you pitch to. The calculation is the one from the hackathon guide, so anyone can check it.
      </p>
      {measured && measured.cases > 0 && (
        <p className="mt-2 max-w-3xl rounded-md border-l-2 border-accent bg-accent-soft/50 px-3 py-2 text-sm">
          <span className="font-semibold">Measured in this system:</span> the agent needs{' '}
          <span className="tnum font-mono">{measured.agentSeconds == null ? '–' : `${Math.round(measured.agentSeconds)} s`}</span> per complaint; a person decided after{' '}
          <span className="tnum font-mono">{measured.minutesToDecision == null ? '–' : `${Math.round(measured.minutesToDecision)} min`}</span> (median);{' '}
          {measured.duplicatesPrevented} duplicate credit(s) and {measured.intercompanyFlagged} intercompany case(s) caught in {measured.cases} complaint(s). Compare with the assumptions below.
        </p>
      )}
      <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 text-sm">
              <span>
                {f.label}
                {f.hint && <span className="block text-xs text-muted">{f.hint}</span>}
              </span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  inputMode="decimal"
                  aria-label={f.label}
                  value={f.percent ? Math.round(input[f.key] * 100) : input[f.key]}
                  onChange={(e) => set(f.key, e.target.value, f.percent)}
                  className="h-8 w-full rounded-md border border-line bg-surface px-2 text-right tnum"
                />
                <span className="w-7 text-xs text-muted">{f.percent ? '%' : (f.unit ?? '')}</span>
              </span>
            </label>
          ))}
        </div>
        <div>
          <div className="rounded-lg border border-accent bg-accent-soft p-4 sm:p-5">
            <div className="text-xs font-medium text-muted">Value per year</div>
            <div className="mt-1 break-words text-3xl font-semibold tnum sm:text-4xl">{formatMoney(Math.round(r.valuePerYear), 'EUR')}</div>
            <div className="mt-1 text-xs text-muted">labour value + financing gain + errors avoided</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <KpiTile label="Hours saved / year" value={Math.round(r.hoursSavedPerYear).toLocaleString('en-GB').replace(/,/g, ' ')} />
            <KpiTile label="Labour value / year" value={formatMoney(Math.round(r.labourValuePerYear), 'EUR')} />
            <KpiTile label="People freed (FTE)" value={r.fteFreed.toFixed(1)} />
            <KpiTile label="Cash released once" value={formatMoney(Math.round(r.cashReleased), 'EUR')} />
            <KpiTile label="Financing gain / year" value={formatMoney(Math.round(r.financingGainPerYear), 'EUR')} />
            <KpiTile label="Errors avoided / year" value={formatMoney(Math.round(r.errorsAvoidedPerYear), 'EUR')} />
          </div>
          <p className="mt-3 text-xs text-muted">
            Not priced here: one written policy applied the same way to every complaint, no forgotten intercompany credits, faster credits so fewer payment disputes, every credit traceable to an invoice and a reason.
          </p>
        </div>
      </div>
    </section>
  )
}
