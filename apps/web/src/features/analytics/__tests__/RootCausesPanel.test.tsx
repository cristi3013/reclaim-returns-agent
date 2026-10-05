import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { RootCausesPanel } from '../RootCausesPanel'

function mount(api: MockApiClient) {
  const root = createRootRoute({ component: RootCausesPanel })
  const routes = ['/', '/cases/$id'].map((path) => createRoute({ getParentRoute: () => root, path }))
  const router = createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory({ initialEntries: ['/'] }) })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiProvider client={api}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

describe('RootCausesPanel', () => {
  it('lists the top repeat problems in one line each, with the details one click away', async () => {
    const api = new MockApiClient({ fast: true })
    await api.seedCases()
    await api.runCase('case-01')
    mount(api)
    fireEvent.click(await screen.findByRole('button', { name: /Find repeat problems/ }))
    expect(await screen.findByText((_, el) => el?.tagName === 'P' && /^\d+ problems caused .+ of credit notes since/.test(el.textContent ?? ''))).toBeInTheDocument()
    const rows = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    // Most credit value first: the leaking drums, getting worse, with case-01 open right now
    expect(rows[0]).toHaveTextContent(/Getting worse/)
    expect(rows[0]).toHaveTextContent(/1 open case now/)
    expect(screen.getByRole('button', { name: /Show \d+ more/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download report/ })).toBeInTheDocument()

    fireEvent.click(within(rows[0]!).getByRole('button'))
    const drawer = screen.getByRole('dialog')
    expect(drawer).toHaveTextContent(/Why it happens/)
    expect(drawer).toHaveTextContent(/Happening now: case-01 is open/)
    const links = within(drawer).getAllByRole('link', { name: 'case-01' })
    expect(links).toHaveLength(2)
    expect(links.every((a) => a.getAttribute('href') === '/cases/case-01')).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
