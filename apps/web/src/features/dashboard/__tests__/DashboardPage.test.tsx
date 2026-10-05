import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useUi } from '@/store/ui'
import { DashboardPage } from '../DashboardPage'

function mount(api: MockApiClient) {
  const root = createRootRoute({ component: () => <TooltipProvider><DashboardPage /></TooltipProvider> })
  const routes = ['/', '/inbox', '/approvals', '/analytics', '/cases/$id'].map((path) => createRoute({ getParentRoute: () => root, path }))
  const router = createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory({ initialEntries: ['/'] }) })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiProvider client={api}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

describe('DashboardPage', () => {
  it('shows what needs a person: the approval for the current role, unprocessed cases, and the numbers', async () => {
    localStorage.clear()
    useUi.getState().setRole('credit_manager')
    const api = new MockApiClient({ fast: true })
    await api.seedCases()
    await api.runCase('case-01') // damaged drums: a return awaiting the credit manager
    mount(api)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText(/1 complaint waiting for a decision/)).toBeInTheDocument())
    const approvals = screen.getByRole('region', { name: 'Your approvals' })
    expect(approvals).toHaveTextContent(/Complaint on invoice 90000353/)
    expect(within(approvals).getByRole('link', { name: /Complaint on invoice 90000353/ }).getAttribute('href')).toBe('/approvals?case=case-01')
    const attention = screen.getByRole('region', { name: 'Needs attention' })
    expect(attention).toHaveTextContent(/not investigated yet/)
    expect(screen.getByRole('button', { name: /Run 7 unprocessed/ })).toBeInTheDocument()
    expect(screen.getAllByText('Awaiting approval')[0]!.closest('a')?.getAttribute('href')).toBe('/approvals')
  })

  it('tells a lower role that the case waits for someone else', async () => {
    localStorage.clear()
    useUi.getState().setRole('customer_service_lead')
    const api = new MockApiClient({ fast: true })
    await api.seedCases()
    await api.runCase('case-01')
    mount(api)
    const approvals = await screen.findByRole('region', { name: 'Your approvals' })
    await waitFor(() => expect(approvals).toHaveTextContent(/1 waiting for Credit manager/))
  })
})
