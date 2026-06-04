// At-rest encryption codec for submission answers (use-case #1).
import { describe, it, expect } from 'vitest'

process.env.PLATFORM_CONFIG_ENCRYPTION_KEY = 'b'.repeat(64)

import { encodeAnswers, decodeSubmissionRow } from '../lib/answers-codec.js'
import { decryptSecret } from '@apphub/platform-sdk/crypto'

describe('encodeAnswers', () => {
  it('returns null for null/undefined', () => {
    expect(encodeAnswers(null)).toBeNull()
    expect(encodeAnswers(undefined)).toBeNull()
  })

  it('encrypts a JSON-serialisable object to a buffer', () => {
    const buf = encodeAnswers({ a: 1, b: ['x'] })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(JSON.parse(decryptSecret(buf))).toEqual({ a: 1, b: ['x'] })
  })

  it('encrypts an empty object (still a buffer)', () => {
    const buf = encodeAnswers({})
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(JSON.parse(decryptSecret(buf))).toEqual({})
  })
})

describe('decodeSubmissionRow', () => {
  it('passes through null/undefined', () => {
    expect(decodeSubmissionRow(null)).toBeNull()
    expect(decodeSubmissionRow(undefined)).toBeUndefined()
  })

  it('decrypts answers_encrypted and strips the column', () => {
    const row = {
      id: 's1', answers: {}, answers_encrypted: encodeAnswers({ secret: 'phi' }),
    }
    const out = decodeSubmissionRow(row)
    expect(out.answers).toEqual({ secret: 'phi' })
    expect(out).not.toHaveProperty('answers_encrypted')
  })

  it('falls back to plaintext answers for legacy rows (no ciphertext)', () => {
    const row = { id: 's1', answers: { legacy: true }, answers_encrypted: null }
    const out = decodeSubmissionRow(row)
    expect(out.answers).toEqual({ legacy: true })
    expect(out).not.toHaveProperty('answers_encrypted')
  })

  it('accepts a non-Buffer ciphertext (e.g. pg bytea as array)', () => {
    const buf = encodeAnswers({ k: 'v' })
    const row = { id: 's1', answers: {}, answers_encrypted: Uint8Array.from(buf) }
    expect(decodeSubmissionRow(row).answers).toEqual({ k: 'v' })
  })
})
