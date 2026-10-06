import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const PAGE_SIZES = [10, 25, 50, 100] as const

/**
 * Client-side paging for a list that is already filtered and sorted. The page goes back to 1 whenever the list
 * changes shape (a filter, a sort, a refresh), so a person never lands on an empty page.
 */
export function usePagination<T>(rows: T[], initialPageSize = 25, resetKey = '') {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  useEffect(() => {
    setPage(1)
  }, [rows.length, pageSize, resetKey])
  const safePage = Math.min(page, pages)
  const pageRows = useMemo(() => rows.slice((safePage - 1) * pageSize, safePage * pageSize), [rows, safePage, pageSize])
  return { page: safePage, pages, pageSize, pageRows, total: rows.length, setPage, setPageSize }
}

export function Pagination({
  page,
  pages,
  pageSize,
  total,
  onPage,
  onPageSize,
  noun = 'rows',
}: {
  page: number
  pages: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  onPageSize: (n: number) => void
  noun?: string
}) {
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav aria-label="Pagination" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
      <span className="tnum">
        Showing {from}–{to} of {total} {noun}
      </span>
      {total > PAGE_SIZES[0] && (
        <label className="flex items-center gap-1">
          per page
          <select aria-label="Rows per page" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="h-7 rounded-md border border-line bg-surface px-1.5 text-xs text-fg">
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
      {pages > 1 && (
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded-md border border-line bg-surface p-1 text-fg disabled:opacity-40">
            <ChevronLeft className="size-4" />
          </button>
          <span className="tnum px-1 text-fg">
            page {page} of {pages}
          </span>
          <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className="rounded-md border border-line bg-surface p-1 text-fg disabled:opacity-40">
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </nav>
  )
}
