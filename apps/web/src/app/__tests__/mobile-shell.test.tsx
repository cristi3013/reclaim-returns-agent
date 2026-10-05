import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { stubViewport } from '@/test/viewport'
import { BottomTabs } from '../layout/BottomTabs'
import { TopBar } from '../layout/TopBar'
import { AuthProvider, fakeAuth } from '@/auth'

const dana = { id: 'u1', email: 'dana@acme.example', name: 'Dana Credit', role: 'credit_manager' as const }

function routed(ui: React.ReactNode, path: string) {
  const root = createRootRoute({ component: () => ui })
  const page = createRoute({ getParentRoute: () => root, path: '/' })
  const approvals = createRoute({ getParentRoute: () => root, path: '/approvals' })
  const router = createRouter({
    routeTree: root.addChildren([page, approvals]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return <RouterProvider router={router} />
}

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider client={fakeAuth(dana)}>
        <ApiProvider client={new MockApiClient({ fast: true })}>{ui}</ApiProvider>
      </AuthProvider>
    </QueryClientProvider>,
  )

describe('BottomTabs', () => {
  it('shows the five sections and marks the current one', async () => {
    wrap(routed(<BottomTabs />, '/approvals'))
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const links = nav.querySelectorAll('a')
    expect([...links].map((a) => a.textContent)).toEqual(['Home', 'Complaints', 'Approve', 'Insights', 'Quality'])
    expect(nav.querySelector('a[aria-current="page"]')?.textContent).toBe('Approve')
  })
})

describe('TopBar on a phone', () => {
  beforeEach(() => stubViewport('phone'))
  it('keeps who is signed in and hides the demo switches behind a menu', async () => {
    wrap(<TopBar />)
    expect(await screen.findByText('Dana Credit')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByLabelText('SAP')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /demo controls/i }))
    expect(await screen.findByLabelText('SAP')).toBeInTheDocument()
    expect(screen.getByLabelText('AI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reset demo/i })).toBeInTheDocument()
  })
})
