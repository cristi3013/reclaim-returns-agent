import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { stubViewport } from '@/test/viewport'
import { BottomTabs } from '../layout/BottomTabs'
import { TopBar } from '../layout/TopBar'

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
      <ApiProvider client={new MockApiClient({ fast: true })}>{ui}</ApiProvider>
    </QueryClientProvider>,
  )

describe('BottomTabs', () => {
  it('shows the four sections and marks the current one', async () => {
    wrap(routed(<BottomTabs />, '/approvals'))
    const nav = await screen.findByRole('navigation', { name: /primary/i })
    const links = nav.querySelectorAll('a')
    expect([...links].map((a) => a.textContent)).toEqual(['Dashboard', 'Inbox', 'Approvals', 'Analytics', 'Evaluation'])
    expect(nav.querySelector('a[aria-current="page"]')?.textContent).toBe('Approvals')
  })
})

describe('TopBar on a phone', () => {
  beforeEach(() => stubViewport('phone'))
  it('keeps the role selector and hides the demo switches behind a menu', async () => {
    wrap(<TopBar />)
    expect(await screen.findByLabelText('Role')).toBeInTheDocument()
    expect(screen.queryByLabelText('SAP')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /demo controls/i }))
    expect(await screen.findByLabelText('SAP')).toBeInTheDocument()
    expect(screen.getByLabelText('AI')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reset demo/i })).toBeInTheDocument()
  })
})
