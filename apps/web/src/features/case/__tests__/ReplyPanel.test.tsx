import { it, expect } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { ReplyPanel } from '../ReplyPanel'

it('a case under review has an empty message box, with a suggestion from every email about the invoice on request', async () => {
  const api = new MockApiClient({ fast: true })
  const eml = (id: string, text: string) =>
    `From: Quality <quality@cust-de-1.example>\nSubject: Invoice 90000355 ${id}\nMessage-ID: <${id}@cust-de-1.example>\n\n${text}`
  const [a] = await api.ingest([
    new File([eml('a1', 'Invoice 90000355: only 18 of 20 KG of material 54 arrived.')], 'a.eml'),
  ])
  const [b] = await api.ingest([
    new File([eml('b1', 'Invoice 90000355: the pallet was wet too.')], 'b.eml'),
  ])
  await api.runCase(a!.id)
  await api.runCase(b!.id)
  const c = await api.getCase(a!.id)
  expect(c.status).toBe('awaiting_approval')

  render(
    <QueryClientProvider client={new QueryClient()}>
      <ApiProvider client={api}>
        <ReplyPanel c={c} role="credit_manager" actor="Demo" />
      </ApiProvider>
    </QueryClientProvider>,
  )
  expect(screen.getByText('Message to the customer')).toBeTruthy()
  const box = screen.getByLabelText('Reply to the customer') as HTMLTextAreaElement
  // Empty until a person asks for a suggestion.
  expect(box.value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: 'Suggest a reply' }))
  expect(box.value).toMatch(/^Dear Quality,/)
  expect(box.value).toMatch(/reviewing it/)
  expect(box.value).not.toMatch(/credit/i)
  expect(
    await screen.findByText(/Suggested from 2 emails with this customer about invoice 90000355/),
  ).toBeTruthy()
  // The second email is acknowledged: more than one from the customer.
  await waitFor(() => expect(box.value).toMatch(/information you have sent us so far/))

  fireEvent.change(box, { target: { value: 'My own words.' } })
  expect(screen.getByRole('button', { name: 'Use the suggestion' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Use the suggestion' }))
  await waitFor(() => expect(box.value).toMatch(/^Dear Quality,/))
})
