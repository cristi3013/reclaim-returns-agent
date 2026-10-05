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
  hasCases,
}: {
  query: string
  onQuery: (q: string) => void
  sort: InboxSort
  onSort: (s: InboxSort) => void
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
        aria-label="Search complaints"
        placeholder="Search by subject, invoice or sender   /"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onQuery('')
            e.currentTarget.blur()
          }
        }}
        className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm shadow-card sm:w-80"
      />
      <select
        aria-label="Sort complaints"
        value={sortValue}
        onChange={(e) => {
          const o = SORT_OPTIONS.find((x) => x.value === e.target.value)
          if (o) onSort(o.sort)
        }}
        className="h-9 rounded-lg border border-line bg-surface px-2 text-sm"
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
                onSuccess: (r) => toast.success(`${r.length} email(s) added`),
              })
            e.target.value = ''
          }}
        />
        <Button variant="outline" size="sm" onClick={() => setCompose(true)}>
          <MailPlus className="size-4" /> New complaint
        </Button>
        <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
          <Upload className="size-4" /> Upload email
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
          <Database className="size-4" /> Load demo complaints
        </Button>
        <Button
          size="sm"
          disabled={runAll.isPending || !hasCases}
          onClick={() =>
            runAll.mutate(undefined, {
              onSuccess: () => toast.success('All complaints investigated'),
              onError: (e) => toast.error(e instanceof Error ? e.message : 'Run failed'),
            })
          }
        >
          <Play className="size-4" /> {runAll.isPending ? 'Investigating…' : 'Investigate all'}
        </Button>
      </div>
    </div>
  )
}
