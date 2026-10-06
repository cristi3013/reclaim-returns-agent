import { it, expect } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { invoiceConversation } from '@reclaim/shared'
import { ApiProvider } from '@/api'
import { MockApiClient } from '@/api/mock/MockApiClient'
import { conversationPeople } from '@/components/domain/Conversation'
import { ChatComposer, defaultTarget } from '../ChatComposer'

it('chats with anyone who wrote on the invoice, starting with the customer', async () => {
  const api = new MockApiClient({ fast: true })
  const eml = (from: string, id: string, text: string) =>
    `From: ${from}\nSubject: Invoice 90000355 ${id}\nMessage-ID: <${id}@test>\n\n${text}`
  const [a] = await api.ingest([
    new File(
      [eml('Quality <quality@cust-de-1.example>', 'a1', 'Invoice 90000355: only 18 of 20 KG.')],
      'a.eml',
    ),
  ])
  const [b] = await api.ingest([
    new File(
      [eml('Dock <dock@warehouse.example>', 'w1', 'Invoice 90000355: we loaded 20 KG.')],
      'w.eml',
    ),
  ])
  await api.runCase(a!.id)
  await api.runCase(b!.id)
  const cases = await Promise.all([api.getCase(a!.id), api.getCase(b!.id)])
  const messages = invoiceConversation(cases)
  const byId = new Map(cases.map((c) => [c.id, c]))
  const customer = messages.find((m) => m.from.includes('quality@'))!
  const dock = messages.find((m) => m.from.includes('dock@'))!
  expect(defaultTarget(messages, customer.from)).toBe(customer.id)

  let target = customer.id
  const view = (t: string) => (
    <QueryClientProvider client={new QueryClient()}>
      <ApiProvider client={api}>
        <ChatComposer
          messages={messages}
          cases={byId}
          people={conversationPeople(messages, customer.from)}
          target={t}
          onTarget={(id) => (target = id)}
          role="credit_manager"
          actor="Demo"
        />
      </ApiProvider>
    </QueryClientProvider>
  )
  const { rerender } = render(view(target))
  const box = screen.getByLabelText('Reply to Quality') as HTMLTextAreaElement
  await waitFor(() => expect(box.value).toMatch(/^Dear Quality,/))

  fireEvent.click(screen.getByRole('button', { name: /Dock/ }))
  expect(target).toBe(dock.id)
  rerender(view(target))
  const toDock = screen.getByLabelText('Reply to Dock') as HTMLTextAreaElement
  // Each sender is answered from their own complaint.
  await waitFor(() => expect(toDock.value).toMatch(/^Dear /))
})
