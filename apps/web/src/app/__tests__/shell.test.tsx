import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { TopBar } from '../layout/TopBar'

describe('TopBar', () => {
  it('shows product name, role switch and mode switches', async () => {
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <ApiProvider client={new MockApiClient({ fast: true })}>
          <TopBar />
        </ApiProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByText(/Returns & Credit Note agent/)).toBeInTheDocument()
    expect(await screen.findByLabelText('SAP')).toBeInTheDocument()
    expect(screen.getByLabelText('AI')).toBeInTheDocument()
    expect(screen.getByLabelText('Conflict')).toBeInTheDocument()
    expect(screen.getByLabelText('Role')).toBeInTheDocument()
  })
})
