import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { TopBar } from '../layout/TopBar'
import { AuthProvider, fakeAuth } from '@/auth'

const dana = { id: 'u1', email: 'dana@acme.example', name: 'Dana Credit', role: 'credit_manager' as const }

describe('TopBar', () => {
  it('shows the current modes, who is signed in, and the mode switches behind one button', async () => {
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
    expect(await screen.findByText(/SAP DS4/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /demo controls/i }))
    expect(await screen.findByLabelText('AI')).toBeInTheDocument()
    expect(screen.getByLabelText('AI')).toBeInTheDocument()
    expect(screen.queryByLabelText('SAP')).not.toBeInTheDocument()
    expect(await screen.findByText('Dana Credit')).toBeInTheDocument()
    expect(screen.getByText('Credit manager')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})
