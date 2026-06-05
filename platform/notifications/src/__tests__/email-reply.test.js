// email-reply lib — pure helpers: reply extraction, auto-reply detection,
// address parsing, plus-address parsing.
import { describe, it, expect } from 'vitest'
import {
  extractReply, detectAutoReply, headerValue, parseAddress, parsePlusAddress,
} from '../lib/email-reply.js'

describe('extractReply', () => {
  it('keeps the fresh text and drops quoted history (> lines)', () => {
    const text = 'Gracias, me va bien el martes.\n\n> El lun, 1 jun escribió:\n> hola'
    expect(extractReply(text)).toBe('Gracias, me va bien el martes.')
  })
  it('cuts at "On … wrote:" (Gmail en)', () => {
    expect(extractReply('Sure!\nOn Mon, Jun 1, 2026 at 9:00 AM Ana <a@x.com> wrote:\nold')).toBe('Sure!')
  })
  it('cuts at "El … escribió:" (Gmail es)', () => {
    expect(extractReply('Vale.\nEl lun, 1 jun 2026 a las 9:00, Ana (<a@x.com>) escribió:\nold')).toBe('Vale.')
  })
  it('cuts at the RFC 3676 signature separator', () => {
    expect(extractReply('Nos vemos.\n-- \nAna García\n600111222')).toBe('Nos vemos.')
  })
  it('cuts at Outlook original-message divider', () => {
    expect(extractReply('ok\n-----Original Message-----\nFrom: x')).toBe('ok')
  })
  it('handles CRLF and empty input', () => {
    expect(extractReply('hola\r\n> quoted')).toBe('hola')
    expect(extractReply('')).toBe('')
    expect(extractReply(null)).toBe('')
  })
})

describe('headerValue', () => {
  it('reads from an object map, case-insensitive', () => {
    expect(headerValue({ 'In-Reply-To': '<x@y>' }, 'in-reply-to')).toBe('<x@y>')
  })
  it('reads from an array of { name, value }', () => {
    expect(headerValue([{ name: 'Auto-Submitted', value: 'auto-replied' }], 'auto-submitted')).toBe('auto-replied')
  })
  it('null when missing', () => {
    expect(headerValue({}, 'x')).toBe(null)
    expect(headerValue(null, 'x')).toBe(null)
  })
})

describe('detectAutoReply', () => {
  it('Auto-Submitted: auto-replied → true; "no" → false', () => {
    expect(detectAutoReply({ headers: { 'auto-submitted': 'auto-replied' } })).toBe(true)
    expect(detectAutoReply({ headers: { 'auto-submitted': 'no' } })).toBe(false)
  })
  it('Precedence bulk/junk/list → true', () => {
    expect(detectAutoReply({ headers: { precedence: 'bulk' } })).toBe(true)
  })
  it('mailer-daemon / no-reply senders → true', () => {
    expect(detectAutoReply({ headers: {}, fromAddress: 'mailer-daemon@x.com' })).toBe(true)
    expect(detectAutoReply({ headers: {}, fromAddress: 'no-reply@x.com' })).toBe(true)
    expect(detectAutoReply({ headers: {}, fromAddress: 'ana@x.com' })).toBe(false)
  })
  it('out-of-office subjects → true', () => {
    expect(detectAutoReply({ headers: {}, subject: 'Out of office: back Monday' })).toBe(true)
    expect(detectAutoReply({ headers: {}, subject: 'Automatic reply: Re: hola' })).toBe(true)
    expect(detectAutoReply({ headers: {}, subject: 'Re: hola' })).toBe(false)
  })
  it('List-Unsubscribe (list automation) → true', () => {
    expect(detectAutoReply({ headers: { 'list-unsubscribe': '<mailto:u@x>' } })).toBe(true)
  })
})

describe('parseAddress', () => {
  it('display name form', () => {
    expect(parseAddress('"Ana García" <Ana@X.com>')).toEqual({ name: 'Ana García', address: 'ana@x.com' })
    expect(parseAddress('Ana <ana@x.com>')).toEqual({ name: 'Ana', address: 'ana@x.com' })
  })
  it('bare address (lowercased)', () => {
    expect(parseAddress('ANA@X.com')).toEqual({ name: null, address: 'ana@x.com' })
  })
  it('empty input', () => {
    expect(parseAddress(null)).toEqual({ name: null, address: null })
  })
})

describe('parsePlusAddress', () => {
  it('reply+token@domain (normalised to lowercase — tokens are hex)', () => {
    expect(parsePlusAddress('reply+a3f09b@Reply.Hulkstein.com'))
      .toEqual({ local: 'reply', token: 'a3f09b', domain: 'reply.hulkstein.com' })
  })
  it('no plus tag → null', () => {
    expect(parsePlusAddress('soporte@reply.hulkstein.com')).toBe(null)
    expect(parsePlusAddress('')).toBe(null)
  })
})
