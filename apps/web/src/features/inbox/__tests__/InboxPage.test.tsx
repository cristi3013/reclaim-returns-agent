import { it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { TooltipProvider } from '@/components/ui/tooltip'
import { InboxView } from '../InboxPage'

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiProvider client={new MockApiClient({ fast: true })}>
        <TooltipProvider>{ui}</TooltipProvider>
      </ApiProvider>
    </QueryClientProvider>,
  )

it('shows the empty state, seeds, lists eight rows', async () => {
  localStorage.clear()
  wrap(<InboxView onOpen={() => {}} />)
  const seedButtons = await screen.findAllByRole('button', { name: /seed demo cases/i })
  fireEvent.click(seedButtons[seedButtons.length - 1]!)
  await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(9))
  expect(screen.getAllByText(/Complaint on invoice 90000353/)).toHaveLength(2)
})
