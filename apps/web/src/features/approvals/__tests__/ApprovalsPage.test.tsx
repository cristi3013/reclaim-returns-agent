import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useUi } from '@/store/ui'
import { stubViewport } from '@/test/viewport'
import { ApprovalsPage } from '../ApprovalsPage'

async function clientWithOneCaseAwaitingApproval() {
  localStorage.clear()
  const api = new MockApiClient({ fast: true })
  await api.seedCases()
  await api.runCase('case-01') // damaged drums, R1: a YRE return awaiting approval
  return api
}

function mount(api: MockApiClient) {
  const root = createRootRoute({
    component: () => (
      <TooltipProvider>
        <ApprovalsPage />
      </TooltipProvider>
    ),
  })
  const approvals = createRoute({ getParentRoute: () => root, path: '/approvals' })
  const caseRoute = createRoute({ getParentRoute: () => root, path: '/cases/$id' })
  const router = createRouter({
    routeTree: root.addChildren([approvals, caseRoute]),
    history: createMemoryHistory({ initialEntries: ['/approvals'] }),
  })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiProvider client={api}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => useUi.setState({ role: 'finance_director' }))

describe('ApprovalsPage on a phone', () => {
  beforeEach(() => stubViewport('phone'))

  it('shows the queue first, opens the case on tap, and goes back to the queue', async () => {
    mount(await clientWithOneCaseAwaitingApproval())
    const row = await screen.findByRole('button', { name: /90000353/ })
    expect(screen.queryByRole('button', { name: /approve and create/i })).not.toBeInTheDocument()

    fireEvent.click(row)
    expect(await screen.findByRole('button', { name: /approve and create/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /90000353/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /back to queue/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /90000353/ })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /approve and create/i })).not.toBeInTheDocument()
  })
})

describe('ApprovalsPage on a desktop', () => {
  beforeEach(() => stubViewport('desktop'))

  it('shows the queue and the selected case side by side', async () => {
    mount(await clientWithOneCaseAwaitingApproval())
    expect(await screen.findByRole('button', { name: /90000353/ })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /approve and create/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /back to queue/i })).not.toBeInTheDocument()
  })
})
