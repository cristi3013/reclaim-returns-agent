import { describe, it, expect } from 'vitest'
import { emailAddress, isReplySubject, stripQuoted, threadSubject } from '../thread'

describe('email threads', () => {
  it('compares subjects without reply prefixes', () => {
    expect(threadSubject('Re: AW: Fwd:  Damaged   drums')).toBe('damaged drums')
    expect(threadSubject('RE[2]: Damaged drums')).toBe('damaged drums')
    expect(isReplySubject('AW: Damaged drums')).toBe(true)
    expect(isReplySubject('Fwd: Damaged drums')).toBe(false)
    expect(isReplySubject('Damaged drums')).toBe(false)
  })

  it('compares senders by address', () => {
    expect(emailAddress('Jane Doe <Jane@Acme.com>')).toBe('jane@acme.com')
    expect(emailAddress(' jane@acme.com ')).toBe('jane@acme.com')
  })

  it('keeps only the new part of a reply', () => {
    expect(
      stripQuoted('Invoice 90000355.\n\nOn Mon, 5 Oct 2026, Reclaim wrote:\n> Which invoice?'),
    ).toBe('Invoice 90000355.')
    expect(
      stripQuoted('Rechnung 90000355.\n\nAm 05.10.2026 schrieb Reclaim <r@x>:\n> Welche?'),
    ).toBe('Rechnung 90000355.')
    expect(
      stripQuoted('It was 2 KG.\n\nFrom: Reclaim <r@x>\nSent: Monday\nSubject: Re: Damaged drums'),
    ).toBe('It was 2 KG.')
    expect(stripQuoted('> only quoted')).toBe('> only quoted')
  })
})
