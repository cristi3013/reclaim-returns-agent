import { it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useUi } from '@/store/ui'
import { CasePage } from '../CasePage'

it('a complaint with no invoice can be decided and answered from the case page', async () => {
  localStorage.clear()
  useUi.getState().setRole('customer_service_lead')
  const api = new MockApiClient({ fast: true })
  const eml =
    'From: Someone <someone@example.com>\nSubject: Not happy\n\nThe last delivery was not good.'
  const [s] = await api.ingest([new File([eml], 'not-happy.eml')])
  await api.runCase(s!.id)
  expect((await api.getCase(s!.id)).status).toBe('awaiting_approval')

  const root = createRootRoute({
    component: () => (
      <TooltipProvider>
        <Outlet />
      </TooltipProvider>
    ),
  })
  const caseRoute = createRoute({
    getParentRoute: () => root,
    path: '/cases/$id',
    component: CasePage,
  })
  const others = ['/', '/approvals'].map((path) =>
    createRoute({ getParentRoute: () => root, path }),
  )
  const router = createRouter({
    routeTree: root.addChildren([caseRoute, ...others]),
    history: createMemoryHistory({ initialEntries: [`/cases/${s!.id}`] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiProvider client={api}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  )

  expect(await screen.findByText('No invoice to look up')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Your decision' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Reject' })).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('button', { name: 'Approve reply' }))
  const reply = (await screen.findByLabelText('Reply to the customer')) as HTMLTextAreaElement
  expect(reply.value).toContain('reply with the correct invoice number')
  await waitFor(async () => expect((await api.getCase(s!.id)).status).toBe('closed'))

  fireEvent.click(await screen.findByRole('button', { name: /change status/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: /pending/i }))
  const confirm = screen.getByRole('button', { name: 'Set to Pending' })
  expect(confirm).toHaveProperty('disabled', true)
  fireEvent.change(screen.getByLabelText(/why\?/i), {
    target: { value: 'Asked the customer for the invoice' },
  })
  fireEvent.click(confirm)
  await waitFor(async () => expect((await api.getCase(s!.id)).status).toBe('needs_customer_input'))
  expect(await screen.findByText('More information needed')).toBeTruthy()
})
