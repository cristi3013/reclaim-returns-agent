import { it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PayloadView } from '../PayloadView'

it('renders keys and toggles raw json', () => {
  render(<PayloadView payload={{ CreditMemoRequestType: 'YCR', HeaderBillingBlockReason: '08', to_Item: [{ Material: '54' }] }} />)
  expect(screen.getByText('CreditMemoRequestType')).toBeInTheDocument()
  expect(screen.getByText('YCR')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /raw json/i }))
  expect(screen.getByText(/"HeaderBillingBlockReason": "08"/)).toBeInTheDocument()
})
