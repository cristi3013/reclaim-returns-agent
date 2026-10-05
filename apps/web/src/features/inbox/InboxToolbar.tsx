import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Play, Upload, Database, MailPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useIngest, useRunAll, useSeed } from '@/api'
import { CASE_STATUSES, STATUS_LABELS } from '@reclaim/shared'
import { NewComplaintDialog } from './NewComplaintDialog'

export function InboxToolbar({
  query,
  onQuery,
  status,
  onStatus,
  intercompany,
  onIntercompany,
  hasCases,
}: {
  query: string
  onQuery: (q: string) => void
  status: string
  onStatus: (s: string) => void
  intercompany: boolean
  onIntercompany: (v: boolean) => void
  hasCases: boolean
}) {
  const seed = useSeed()
  const runAll = useRunAll()
  const ingest = useIngest()
  const file = useRef<HTMLInputElement>(null)
  const [compose, setCompose] = useState(false)
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <NewComplaintDialog open={compose} onClose={() => setCompose(false)} />
      <input
        aria-label="Search cases"
        placeholder="Search subject, invoice, sender"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm sm:w-72"
      />
      <select
        aria-label="Filter by status"
        value={status}
        onChange={(e) => onStatus(e.target.value)}
        className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
      >
        <option value="">All statuses</option>
        {CASE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-pressed={intercompany}
        onClick={() => onIntercompany(!intercompany)}
        title="Only credits where the shipping plant belongs to another company (step 5.2.2, for finance)"
        className={`h-9 rounded-md border px-3 text-sm ${intercompany ? 'border-warn bg-warn-soft text-warn' : 'border-line bg-surface text-muted hover:text-fg'}`}
      >
        Intercompany
      </button>
      <div className="flex flex-wrap gap-2 sm:ml-auto">
        <input
          ref={file}
          type="file"
          accept=".eml,message/rfc822"
          multiple
          hidden
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? [])
            if (fs.length) ingest.mutate(fs, { onSuccess: (r) => toast.success(`${r.length} email(s) added to the inbox`) })
            e.target.value = ''
          }}
        />
        <Button variant="outline" size="sm" onClick={() => setCompose(true)}>
          <MailPlus className="size-4" /> New complaint
        </Button>
        <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
          <Upload className="size-4" /> Upload .eml
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={seed.isPending}
          onClick={() => seed.mutate(undefined, { onSuccess: () => toast.success('Eight demo complaints loaded') })}
        >
          <Database className="size-4" /> Seed demo cases
        </Button>
        <Button
          size="sm"
          disabled={runAll.isPending || !hasCases}
          onClick={() =>
            runAll.mutate(undefined, {
              onSuccess: () => toast.success('All cases processed'),
              onError: (e) => toast.error(e instanceof Error ? e.message : 'Run failed'),
            })
          }
        >
          <Play className="size-4" /> {runAll.isPending ? 'Running…' : 'Run all'}
        </Button>
      </div>
    </div>
  )
}
