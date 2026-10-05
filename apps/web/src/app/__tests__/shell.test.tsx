import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { TopBar } from '../layout/TopBar'
import { AuthProvider, fakeAuth } from '@/auth'

const dana = { id: 'u1', email: 'dana@acme.example', name: 'Dana Credit', role: 'credit_manager' as const }

describe('TopBar', () => {
  it('shows product name, who is signed in, and mode switches', async () => {
    const qc = new QueryClient()
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider client={fakeAuth(dana)}>
          <ApiProvider client={new MockApiClient({ fast: true })}>
            <TopBar />
          </ApiProvider>
        </AuthProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByText(/Returns & Credit Note agent/)).toBeInTheDocument()
    expect(await screen.findByLabelText('SAP')).toBeInTheDocument()
    expect(screen.getByLabelText('AI')).toBeInTheDocument()
    expect(screen.getByLabelText('Conflict')).toBeInTheDocument()
    expect(await screen.findByText('Dana Credit')).toBeInTheDocument()
    expect(screen.getByText('Credit manager')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
