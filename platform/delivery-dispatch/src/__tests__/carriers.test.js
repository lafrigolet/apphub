import { describe, it, expect } from 'vitest'
import crypto from 'node:crypto'
import {
  PROVIDERS, isProvider, mapCarrierStatus, verifyWebhookSignature,
  webhookSecretKey, enabledKey,
} from '../services/carriers.js'

describe('carriers helpers', () => {
  it('lists the three supported providers', () => {
    expect(PROVIDERS).toEqual(['uber', 'glovo', 'stuart'])
    expect(isProvider('uber')).toBe(true)
    expect(isProvider('fedex')).toBe(false)
  })

  it('maps provider keys to settings keys', () => {
    expect(webhookSecretKey('glovo')).toBe('glovo_webhook_secret')
    expect(enabledKey('stuart')).toBe('stuart_enabled')
    expect(webhookSecretKey('nope')).toBeNull()
  })

  it('maps provider statuses to internal FSM (case-insensitive)', () => {
    expect(mapCarrierStatus('uber', 'delivered')).toBe('delivered')
    expect(mapCarrierStatus('glovo', 'PICKED_UP')).toBe('picked_up')
    expect(mapCarrierStatus('stuart', 'CANCELLED')).toBe('cancelled')
    expect(mapCarrierStatus('uber', 'unknown_status')).toBeNull()
    expect(mapCarrierStatus('nope', 'delivered')).toBeNull()
  })
})

describe('verifyWebhookSignature', () => {
  const secret = 's3cr3t'
  const body = JSON.stringify({ a: 1 })
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')

  it('accepts a valid signature', () => {
    expect(verifyWebhookSignature(secret, body, sig)).toBe(true)
  })
  it('accepts a sha256= prefixed signature', () => {
    expect(verifyWebhookSignature(secret, body, `sha256=${sig}`)).toBe(true)
  })
  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(secret, body + 'x', sig)).toBe(false)
  })
  it('rejects when secret or signature missing', () => {
    expect(verifyWebhookSignature(null, body, sig)).toBe(false)
    expect(verifyWebhookSignature(secret, body, null)).toBe(false)
  })
  it('rejects malformed hex signatures gracefully', () => {
    expect(verifyWebhookSignature(secret, body, 'zzzz')).toBe(false)
  })
})
