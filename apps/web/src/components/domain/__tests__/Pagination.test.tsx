import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react'
import { Pagination, usePagination } from '../Pagination'

describe('usePagination', () => {
  it('slices pages, clamps the page and goes back to page 1 when the rows change', () => {
    const rows = Array.from({ length: 53 }, (_, i) => i + 1)
    const { result, rerender } = renderHook(({ r }: { r: number[] }) => usePagination(r, 25), { initialProps: { r: rows } })
    expect(result.current.pages).toBe(3)
    expect(result.current.pageRows).toEqual(rows.slice(0, 25))
    act(() => result.current.setPage(3))
    expect(result.current.pageRows).toEqual([51, 52, 53])
    rerender({ r: rows.slice(0, 30) })
    expect(result.current.page).toBe(1)
    act(() => result.current.setPageSize(10))
    expect(result.current.pages).toBe(3)
    expect(result.current.pageRows).toHaveLength(10)
  })
})

describe('Pagination', () => {
  it('shows the range, pages and disables the edges', () => {
    let page = 1
    const { rerender } = render(<Pagination page={page} pages={3} pageSize={25} total={53} onPage={(p) => (page = p)} onPageSize={() => {}} noun="findings" />)
    expect(screen.getByText('Showing 1–25 of 53 findings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(page).toBe(2)
    rerender(<Pagination page={3} pages={3} pageSize={25} total={53} onPage={() => {}} onPageSize={() => {}} noun="findings" />)
    expect(screen.getByText('Showing 51–53 of 53 findings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
  })
  it('renders nothing for an empty list and no page size for a short one', () => {
    const { container } = render(<Pagination page={1} pages={1} pageSize={25} total={0} onPage={() => {}} onPageSize={() => {}} />)
    expect(container).toBeEmptyDOMElement()
    render(<Pagination page={1} pages={1} pageSize={25} total={8} onPage={() => {}} onPageSize={() => {}} />)
    expect(screen.queryByLabelText('Rows per page')).not.toBeInTheDocument()
  })
})
