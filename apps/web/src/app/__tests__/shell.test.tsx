import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { TopBar } from '../layout/TopBar'

describe('TopBar', () => {
  it('shows the current modes, the role switch, and the mode switches behind one button', async () => {
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <ApiProvider client={new MockApiClient({ fast: true })}>
          <TopBar />
        </ApiProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/SAP Mock/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /demo controls/i }))
    expect(await screen.findByLabelText('SAP')).toBeInTheDocument()
    expect(screen.getByLabelText('AI')).toBeInTheDocument()
    expect(screen.getByLabelText('Conflict')).toBeInTheDocument()
    expect(screen.getByLabelText('Role')).toBeInTheDocument()
  })
})
