import { it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusChip } from '../StatusChip'

it('labels and tones statuses', () => {
  render(<StatusChip status="awaiting_approval" />)
  expect(screen.getByText('Awaiting approval')).toHaveAttribute('data-tone', 'warn')
  render(<StatusChip status="written_to_sap" />)
  expect(screen.getByText('Written to SAP')).toHaveAttribute('data-tone', 'ok')
  render(<StatusChip status="sap_write_failed" />)
  expect(screen.getByText('SAP write failed')).toHaveAttribute('data-tone', 'bad')
})
