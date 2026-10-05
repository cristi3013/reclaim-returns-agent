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
  it('generates a briefing: groups ranked by credit value, figures from code, live cases linked', async () => {
    const api = new MockApiClient({ fast: true })
    await api.seedCases()
    await api.runCase('case-01')
    mount(api)
    fireEvent.click(await screen.findByRole('button', { name: /Generate briefing/ }))
    const groups = await screen.findAllByRole('article')
    expect(groups.length).toBeGreaterThanOrEqual(4)
    expect(groups[0]).toHaveTextContent(/Rising/)
    expect(groups[0]).toHaveTextContent(/Template wording/)
    expect(screen.getByText(/from the archive \(sample data\)/)).toBeInTheDocument()
    // case-01 is open and fits the leaking-drum pattern: called out, and listed among the members
    expect(groups[0]).toHaveTextContent(/Happening now: case-01 is open/)
    fireEvent.click(within(groups[0]!).getByRole('button', { name: /Show \d+ complaints/ }))
    const links = within(groups[0]!).getAllByRole('link', { name: 'case-01' })
    expect(links).toHaveLength(2)
    expect(links.every((a) => a.getAttribute('href') === '/cases/case-01')).toBe(true)
    expect(screen.getByRole('button', { name: /Refresh briefing/ })).toBeInTheDocument()
  })
})
