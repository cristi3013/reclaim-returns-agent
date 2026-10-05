import { it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PayloadView } from '../PayloadView'

it('reads the payload in plain words and toggles raw json', () => {
  render(
    <PayloadView
      payload={{
        CreditMemoRequestType: 'YCR',
        SoldToParty: '10021',
        ReferenceSDDocument: '90000373',
        SDDocumentReason: '101',
        HeaderBillingBlockReason: '08',
        to_Item: [{ Material: '54', RequestedQuantity: '5', RequestedQuantityUnit: 'KG' }],
      }}
    />,
  )
  expect(screen.getByText('Credit memo request')).toBeInTheDocument()
  expect(screen.getByText(/Poor quality/)).toBeInTheDocument()
  expect(screen.getByText(/Held until released/)).toBeInTheDocument()
  expect(screen.getByText('54')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /raw json/i }))
  expect(screen.getByText(/"HeaderBillingBlockReason": "08"/)).toBeInTheDocument()
})
