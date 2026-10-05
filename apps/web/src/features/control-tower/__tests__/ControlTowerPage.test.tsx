import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ControlTowerPage } from '../ControlTowerPage'

function mount() {
  const root = createRootRoute({ component: () => <TooltipProvider><ControlTowerPage /></TooltipProvider> })
  const routes = ['/', '/inbox', '/control-tower'].map((path) => createRoute({ getParentRoute: () => root, path }))
  const router = createRouter({ routeTree: root.addChildren(routes), history: createMemoryHistory({ initialEntries: ['/control-tower'] }) })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiProvider client={new MockApiClient({ fast: true })}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

describe('ControlTowerPage', () => {
  it('shows the verdict and the KPIs from the pack, and answers the Norway question with no data', async () => {
    mount()
    expect(await screen.findByText('not ready', {}, { timeout: 15000 })).toBeInTheDocument()
    expect(screen.getByText(/1 609 540 EUR \+ 474 910 RON/)).toBeInTheDocument()
    expect(screen.getByText(/368 598 EUR \+ 150 RON/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Why is DSO up for Norway?' }))
    const answer = await screen.findByRole('region', { name: 'Answer' })
    await waitFor(() => expect(answer).toHaveTextContent(/No data for the subject/))
    expect(answer).toHaveTextContent(/no customer in NO/)
  })
})
