import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Play, Upload, Database, MailPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useIngest, useRunAll, useSeed } from '@/api'
import { NewComplaintDialog } from './NewComplaintDialog'
import { SORT_OPTIONS, type InboxSort } from './view'

export function InboxToolbar({
  query,
  onQuery,
  sort,
  onSort,
  intercompany,
  onIntercompany,
  hasCases,
}: {
  query: string
  onQuery: (q: string) => void
  sort: InboxSort
  onSort: (s: InboxSort) => void
  intercompany: boolean
  onIntercompany: (v: boolean) => void
  hasCases: boolean
}) {
  const seed = useSeed()
  const runAll = useRunAll()
  const ingest = useIngest()
  const file = useRef<HTMLInputElement>(null)
  const [compose, setCompose] = useState(false)
  const search = useRef<HTMLInputElement>(null)
  // "/" jumps to the search box, as in Gmail and GitHub; not while typing somewhere else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key !== '/' || t?.closest('input, textarea, select, [contenteditable]')) return
      e.preventDefault()
      search.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const sortValue = `${sort.key}:${sort.dir}`
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <NewComplaintDialog open={compose} onClose={() => setCompose(false)} />
      <input
        ref={search}
        aria-label="Search cases"
        placeholder="Search subject, invoice, sender  ( / )"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onQuery('')
            e.currentTarget.blur()
          }
        }}
        className="h-9 w-full rounded-md border border-line bg-surface px-3 text-sm sm:w-72"
      />
      <select
        aria-label="Sort cases"
        value={sortValue}
        onChange={(e) => {
          const o = SORT_OPTIONS.find((x) => x.value === e.target.value)
          if (o) onSort(o.sort)
        }}
        className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
      >
        {!SORT_OPTIONS.some((o) => o.value === sortValue) && (
          <option value={sortValue}>Custom order</option>
        )}
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            Sort: {o.label}
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
            if (fs.length)
              ingest.mutate(fs, {
                onSuccess: (r) => toast.success(`${r.length} email(s) added to the inbox`),
              })
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
          onClick={() =>
            seed.mutate(undefined, {
              onSuccess: () => toast.success('Eight demo complaints loaded'),
            })
          }
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
