import { it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QuantityEditor } from '../QuantityEditor'

it('clamps above invoiced and reports invalid', () => {
  const on = vi.fn()
  render(<QuantityEditor value={2} max={20} unit="KG" unitPrice={270} currency="EUR" onChange={on} />)
  const input = screen.getByLabelText(/quantity/i)
  fireEvent.change(input, { target: { value: '99' } })
  expect(screen.getByText(/cannot exceed 20 KG/i)).toBeInTheDocument()
  expect(on).toHaveBeenLastCalledWith({ quantity: 99, valid: false })
  fireEvent.change(input, { target: { value: '3' } })
  expect(screen.getByText('810.00 EUR')).toBeInTheDocument()
  expect(on).toHaveBeenLastCalledWith({ quantity: 3, valid: true })
})
