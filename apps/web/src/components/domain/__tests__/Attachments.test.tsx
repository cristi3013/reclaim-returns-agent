import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { Attachments } from '../Attachments'

const LIST = [
  { name: 'drum.png', mimeType: 'image/png', url: '/uploads/drum.png' },
  { name: 'Lieferschein.pdf', mimeType: 'application/pdf', url: '/uploads/Lieferschein.pdf' },
  { name: 'notes.docx', mimeType: 'application/octet-stream', url: '/uploads/notes.docx' },
]

describe('Attachments', () => {
  it('lets the desk open every file: photos full size, PDFs in a new tab, the rest as downloads', () => {
    render(<Attachments list={LIST} />)
    const items = within(screen.getByRole('list', { name: 'Attachments' })).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[1]).toHaveTextContent(/PDF · read by the model as evidence/)
    expect(items[2]).toHaveTextContent(/File · kept with the case, not read by the model/)
    expect(within(items[1]!).getByRole('link', { name: /Open$/ })).toHaveAttribute(
      'target',
      '_blank',
    )
    expect(within(items[2]!).queryByRole('link', { name: /Open$/ })).toBeNull()
    expect(within(items[2]!).getByRole('link', { name: /Download/ })).toHaveAttribute(
      'download',
      'notes.docx',
    )

    fireEvent.click(screen.getByRole('button', { name: 'View drum.png full size' }))
    const viewer = screen.getByRole('dialog', { name: 'drum.png' })
    expect(within(viewer).getByRole('img')).toHaveAttribute('src', '/uploads/drum.png')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows a one-line strip for a long conversation', () => {
    render(<Attachments list={LIST} compact />)
    expect(screen.getByText(/3 attachments:/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Lieferschein.pdf' })).toHaveAttribute(
      'href',
      '/uploads/Lieferschein.pdf',
    )
    fireEvent.click(screen.getByRole('button', { name: 'View drum.png' }))
    expect(screen.getByRole('dialog', { name: 'drum.png' })).toBeInTheDocument()
  })

  it('says a photo is missing instead of showing a broken image', () => {
    render(<Attachments list={LIST.slice(0, 1)} />)
    fireEvent.error(screen.getByRole('img', { name: 'drum.png' }))
    expect(screen.getByText(/The photo could not be loaded/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Download/ })).toBeInTheDocument()
  })
})
