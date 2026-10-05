import { FlaskConical, ShieldCheck } from 'lucide-react'
import { useEval, useRunEval } from '@/api'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/domain/PageHeader'
import { EmptyState } from '@/components/domain/EmptyState'

const COLS = ['rule', 'document', 'reason', 'quantity', 'amount', 'approver', 'option A']

export function EvaluationPage() {
  const q = useEval()
  const run = useRunEval()
  const res = q.data
  const passed = res?.filter((r) => r.pass).length ?? 0
  return (
    <div>
      <PageHeader
        title="Quality check"
        description="Does the agent decide correctly? The eight demo complaints are checked against the organizers' expected results, field by field: rule, document, reason, quantity, amount and approver. The wording is not scored, so the result is the same every run."
        actions={<div className="flex items-center gap-3">
          {res && (
            <span className={`text-lg font-semibold tnum ${passed === res.length ? 'text-ok' : 'text-bad'}`}>
              {passed} of {res.length} passing
            </span>
          )}
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            <FlaskConical className="size-4" /> {run.isPending ? 'Checking…' : 'Run the check'}
          </Button>
        </div>}
      />
      {run.error && (
        <div role="alert" className="mb-3 rounded-md border border-bad bg-bad-soft p-3 text-sm text-bad">
          {run.error instanceof Error ? run.error.message : String(run.error)}
        </div>
      )}
      {!res ? (
        <EmptyState
          icon={ShieldCheck}
          title="Not checked yet"
          description="Investigates every demo complaint that has no proposal yet, then compares each decision with the expected results."
          action={
            <Button onClick={() => run.mutate()} disabled={run.isPending}>
              Run the check
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs font-medium text-muted">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Case</th>
                {COLS.map((c) => (
                  <th key={c} className="px-3 py-2 text-left font-semibold">
                    {c}
                  </th>
                ))}
                <th className="px-3 py-2 text-left font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {res.map((r) => (
                <tr key={r.caseId} className="border-t border-line">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.caseId}</div>
                    <div className="font-mono text-xs text-muted">{r.emailFile}</div>
                  </td>
                  {COLS.map((c) => {
                    const f = r.fields.find((x) => x.name === c)
                    return (
                      <td key={c} className="px-3 py-2">
                        {f ? (
                          <span
                            title={`expected ${f.expected || '—'} · actual ${f.actual || '—'}`}
                            className={`inline-block rounded px-1.5 py-0.5 font-mono text-xs ${f.pass ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'}`}
                          >
                            {f.actual || '—'}
                            {!f.pass && <span className="ml-1 text-muted">≠ {f.expected || '—'}</span>}
                          </span>
                        ) : (
                          <span className="text-muted">–</span>
                        )}
                      </td>
                    )
                  })}
                  <td className={`px-3 py-2 font-semibold ${r.pass ? 'text-ok' : 'text-bad'}`}>{r.pass ? 'PASS' : 'FAIL'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">
        The same comparison runs in CI against the mock, and the backend team runs it against the real API: the acceptance test travels with the product.
      </p>
    </div>
  )
}
