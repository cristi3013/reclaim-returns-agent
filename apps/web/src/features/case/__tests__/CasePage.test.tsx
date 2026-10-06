import { it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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

it('a complaint with no invoice waits for the customer, and the case page asks them for it', async () => {
  localStorage.clear()
  useUi.getState().setRole('customer_service_lead')
  const api = new MockApiClient({ fast: true })
  const eml =
    'From: Someone <someone@example.com>\nSubject: Not happy\n\nThe last delivery was not good.'
  const [s] = await api.ingest([new File([eml], 'not-happy.eml')])
  await api.runCase(s!.id)
  expect((await api.getCase(s!.id)).status).toBe('needs_customer_input')

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

  // No invoice: only the emails and the reply, no proposal, no SAP lookup, nothing to approve.
  expect(await screen.findByText(/No invoice number yet: there is nothing to approve/)).toBeTruthy()
  expect(screen.getByRole('list', { name: 'Emails in this case' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Proposal' })).toBeNull()
  expect(screen.queryByText('No invoice to look up')).toBeNull()
  expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
  expect(screen.getByText('More information needed')).toBeTruthy()
  const reply = screen.getByLabelText('Reply to the customer') as HTMLTextAreaElement
  expect(reply.value).toContain('reply with the correct invoice number')
})

it('a customer reply in the same thread joins the case and shows as a conversation', async () => {
  localStorage.clear()
  useUi.getState().setRole('customer_service_lead')
  const api = new MockApiClient({ fast: true })
  const first =
    'From: Someone <someone@example.com>\nSubject: Damaged drums\nMessage-ID: <a1@example.com>\n\nTwo drums arrived damaged.'
  const reply =
    'From: someone@example.com\nSubject: Re: Damaged drums\nIn-Reply-To: <a1@example.com>\n\nIt was invoice 90000355.\n\nOn Mon, Reclaim wrote:\n> Which invoice?'
  const [s] = await api.ingest([new File([first], 'first.eml')])
  const [r] = await api.ingest([new File([reply], 'reply.eml')])
  expect(r!.id).toBe(s!.id)
  expect(await api.listCases()).toHaveLength(1)

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

  expect(await screen.findByRole('heading', { name: 'Conversation · 2 emails' })).toBeTruthy()
  const emails = screen.getByRole('list', { name: 'Emails in this case' })
  expect(emails.textContent).toContain('Two drums arrived damaged.')
  expect(emails.textContent).toContain('It was invoice 90000355.')
  expect(emails.textContent).not.toContain('Which invoice?')
})
