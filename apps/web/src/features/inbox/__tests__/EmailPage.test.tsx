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
import { EmailPage } from '../EmailPage'

it('an email from the Inbox shows only that email, and Go to case opens its case', async () => {
  const api = new MockApiClient({ fast: true })
  const eml =
    'From: Quality <quality@cust-de-1.example>\nSubject: Damaged drums\nMessage-ID: <d1@test>\n\nInvoice 90000355: two drums arrived damaged.'
  const [s] = await api.ingest([new File([eml], 'd.eml')])
  const root = createRootRoute({ component: () => <Outlet /> })
  const email = createRoute({
    getParentRoute: () => root,
    path: '/inbox/$id',
    component: EmailPage,
  })
  const caseRoute = createRoute({
    getParentRoute: () => root,
    path: '/cases/$id',
    component: () => <h1>The case</h1>,
  })
  const inbox = createRoute({ getParentRoute: () => root, path: '/inbox' })
  const router = createRouter({
    routeTree: root.addChildren([email, caseRoute, inbox]),
    history: createMemoryHistory({ initialEntries: [`/inbox/${s!.id}`] }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiProvider client={api}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  )

  expect(await screen.findByRole('heading', { name: 'Damaged drums' })).toBeTruthy()
  expect(screen.getByText(/two drums arrived damaged/)).toBeTruthy()
  // Only the email: no proposal, no decision, no reply box.
  expect(screen.queryByText('Proposal')).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: /Go to case/ }))
  expect(await screen.findByRole('heading', { name: 'The case' })).toBeTruthy()
})
