import { it, expect } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
import { conversation } from '@reclaim/shared'
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
  expect(reply.value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a reply' }))
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

it('two options: both are shown on the case, the decision is in To approve', async () => {
  localStorage.clear()
  useUi.getState().setRole('credit_manager')
  const api = new MockApiClient({ fast: true })
  await api.seedCases()
  await api.runCase('case-01')

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
  const others = ['/', '/approvals', '/invoices', '/invoices/$invoice'].map((path) =>
    createRoute({ getParentRoute: () => root, path }),
  )
  const router = createRouter({
    routeTree: root.addChildren([caseRoute, ...others]),
    history: createMemoryHistory({ initialEntries: ['/cases/case-01'] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiProvider client={api}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  )

  // Both options are shown here, read only; picking one and deciding happen in To approve.
  expect(await screen.findByRole('article', { name: 'Option A' })).toBeTruthy()
  expect(screen.getByRole('article', { name: 'Option B' })).toBeTruthy()
  expect(screen.queryByRole('radio')).toBeNull()
  expect(screen.queryByRole('button', { name: /Approve/ })).toBeNull()
  const link = screen.getByRole('link', { name: /Decide in To approve/ })
  expect(link.getAttribute('href')).toBe('/approvals?case=case-01')
})

it('one case per invoice: a later email shows the switcher and every email on the invoice', async () => {
  localStorage.clear()
  useUi.getState().setRole('credit_manager')
  const api = new MockApiClient({ fast: true })
  await api.seedCases()
  await api.runCase('case-01')
  await api.runCase('case-06')

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
  const others = ['/', '/approvals', '/invoices', '/invoices/$invoice'].map((path) =>
    createRoute({ getParentRoute: () => root, path }),
  )
  const router = createRouter({
    routeTree: root.addChildren([caseRoute, ...others]),
    history: createMemoryHistory({ initialEntries: ['/cases/case-06'] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiProvider client={api}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  )

  const nav = await screen.findByRole('navigation', { name: 'Complaints on this invoice' })
  expect(nav.querySelectorAll('a')).toHaveLength(2)
  expect(nav.querySelector('[aria-current="page"]')?.textContent).toMatch(/^2 ·/)
  const a = await api.getCase('case-01')
  const b = await api.getCase('case-06')
  expect(await screen.findByText(/New complaint on this invoice|case reopened/)).toBeTruthy()
  expect(
    screen.getByRole('heading', {
      name: `Conversation · ${conversation(a).length + conversation(b).length} emails`,
    }),
  ).toBeTruthy()
})
