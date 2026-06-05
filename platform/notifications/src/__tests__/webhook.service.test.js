// webhook.service — Resend + Twilio delivery webhooks → suppression + delivery
// status. The DB pool and downstream repos/services are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { release, connect } = vi.hoisted(() => ({ release: vi.fn(), connect: vi.fn() }))
vi.mock('../lib/db.js', () => ({ pool: { connect } }))

const configRepo = vi.hoisted(() => ({ getValue: vi.fn() }))
vi.mock('../repositories/config.repository.js', () => configRepo)

const sendLogRepo = vi.hoisted(() => ({ updateDeliveryStatus: vi.fn() }))
vi.mock('../repositories/send-log.repository.js', () => sendLogRepo)

const suppression = vi.hoisted(() => ({ suppress: vi.fn() }))
vi.mock('../services/suppression.service.js', () => suppression)

import * as svc from '../services/webhook.service.js'

beforeEach(() => {
  vi.clearAllMocks()
  connect.mockResolvedValue({ release })
  sendLogRepo.updateDeliveryStatus.mockResolvedValue(1)
})

describe('verifyResendSecret', () => {
  it('accepts when no secret configured (dev-stub)', async () => {
    configRepo.getValue.mockResolvedValue(null)
    expect(await svc.verifyResendSecret('whatever')).toBe(true)
  })
  it('rejects when secret configured but header missing', async () => {
    configRepo.getValue.mockResolvedValue('s3cr3t')
    expect(await svc.verifyResendSecret(undefined)).toBe(false)
  })
  it('matches the configured secret (constant-time)', async () => {
    configRepo.getValue.mockResolvedValue('s3cr3t')
    expect(await svc.verifyResendSecret('s3cr3t')).toBe(true)
    expect(await svc.verifyResendSecret('nope')).toBe(false)
  })
})

describe('handleResendEvent', () => {
  it('bounce → suppress(email,bounce) + delivery_status', async () => {
    await svc.handleResendEvent({ type: 'email.bounced', data: { email_id: 'm1', to: ['a@x'], bounce: { subType: 'hard' } } })
    expect(suppression.suppress).toHaveBeenCalledWith({ channel: 'email', recipient: 'a@x', reason: 'bounce', detail: 'hard' })
    expect(sendLogRepo.updateDeliveryStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerMessageId: 'm1', deliveryStatus: 'bounced' }))
  })
  it('complaint → suppress(email,complaint)', async () => {
    await svc.handleResendEvent({ type: 'email.complained', data: { email_id: 'm2', to: 'b@x' } })
    expect(suppression.suppress).toHaveBeenCalledWith(expect.objectContaining({ reason: 'complaint', recipient: 'b@x' }))
  })
  it('delivered → only stamps delivery_status', async () => {
    await svc.handleResendEvent({ type: 'email.delivered', data: { email_id: 'm3', to: ['c@x'] } })
    expect(suppression.suppress).not.toHaveBeenCalled()
    expect(sendLogRepo.updateDeliveryStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ deliveryStatus: 'delivered' }))
  })
  it('unknown/typeless events are ignored', async () => {
    expect(await svc.handleResendEvent({})).toEqual({ ignored: true })
    const r = await svc.handleResendEvent({ type: 'email.opened', data: { email_id: 'm' } })
    expect(r.handled).toBe(true)
    expect(sendLogRepo.updateDeliveryStatus).not.toHaveBeenCalled()
  })
})

describe('computeTwilioSignature / verifyTwilioSignature', () => {
  const url = 'https://x.test/v1/notifications/webhooks/twilio'
  const params = { MessageSid: 'SM1', MessageStatus: 'delivered', To: '+34' }

  it('signature matches Twilio algorithm', async () => {
    configRepo.getValue.mockResolvedValue('tok')
    const sig = svc.computeTwilioSignature('tok', url, params)
    // recompute independently
    let data = url
    for (const k of Object.keys(params).sort()) data += k + params[k]
    const expected = crypto.createHmac('sha1', 'tok').update(Buffer.from(data, 'utf-8')).digest('base64')
    expect(sig).toBe(expected)
    expect(await svc.verifyTwilioSignature({ signature: sig, url, params })).toBe(true)
    expect(await svc.verifyTwilioSignature({ signature: 'bad', url, params })).toBe(false)
  })
  it('accepts when no auth token configured (dev-stub)', async () => {
    configRepo.getValue.mockResolvedValue(null)
    expect(await svc.verifyTwilioSignature({ signature: 'x', url, params })).toBe(true)
  })
  it('rejects when configured but signature missing', async () => {
    configRepo.getValue.mockResolvedValue('tok')
    expect(await svc.verifyTwilioSignature({ signature: undefined, url, params })).toBe(false)
  })
})

describe('handleTwilioStatus', () => {
  it('delivered → stamps delivery_status', async () => {
    await svc.handleTwilioStatus({ MessageSid: 'SM1', MessageStatus: 'delivered' })
    expect(sendLogRepo.updateDeliveryStatus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ providerMessageId: 'SM1', deliveryStatus: 'delivered' }))
  })
  it('opt-out (21610) → suppress sms number', async () => {
    await svc.handleTwilioStatus({ MessageSid: 'SM2', MessageStatus: 'undelivered', ErrorCode: '21610', To: '+34600' })
    expect(suppression.suppress).toHaveBeenCalledWith(expect.objectContaining({ channel: 'sms', recipient: '+34600', reason: 'opt_out' }))
  })
  it('non-delivery status without sid → no stamp', async () => {
    await svc.handleTwilioStatus({ MessageStatus: 'accepted' })
    expect(sendLogRepo.updateDeliveryStatus).not.toHaveBeenCalled()
  })
  it('updateDelivery swallows DB errors', async () => {
    sendLogRepo.updateDeliveryStatus.mockRejectedValue(new Error('db'))
    await expect(svc.handleTwilioStatus({ MessageSid: 'SM3', MessageStatus: 'sent' })).resolves.toMatchObject({ handled: true })
  })
})

describe('Svix verification (verifySvixSignature / verifyResendWebhook)', () => {
  // Build a real signature with the same algorithm Svix documents.
  const secretBytes = Buffer.from('super-secret-signing-key')
  const secret = `whsec_${secretBytes.toString('base64')}`
  const rawBody = '{"type":"email.received","data":{"email_id":"e1"}}'
  const id = 'msg_123'
  const now = Date.now()
  const timestamp = String(Math.floor(now / 1000))
  const sig = crypto.createHmac('sha256', secretBytes)
    .update(`${id}.${timestamp}.${rawBody}`, 'utf-8').digest('base64')

  it('accepts a valid v1 signature within tolerance', () => {
    expect(svc.verifySvixSignature(secret, { id, timestamp, signature: `v1,${sig}`, rawBody }, now)).toBe(true)
  })
  it('accepts when the valid sig is one of several space-delimited entries', () => {
    expect(svc.verifySvixSignature(secret, { id, timestamp, signature: `v1,AAAA v1,${sig}`, rawBody }, now)).toBe(true)
  })
  it('rejects a tampered body', () => {
    expect(svc.verifySvixSignature(secret, { id, timestamp, signature: `v1,${sig}`, rawBody: rawBody + ' ' }, now)).toBe(false)
  })
  it('rejects a stale timestamp (replay protection)', () => {
    const staleTs = String(Math.floor(now / 1000) - 600)
    const staleSig = crypto.createHmac('sha256', secretBytes)
      .update(`${id}.${staleTs}.${rawBody}`, 'utf-8').digest('base64')
    expect(svc.verifySvixSignature(secret, { id, timestamp: staleTs, signature: `v1,${staleSig}`, rawBody }, now)).toBe(false)
  })
  it('rejects when svix headers are missing', () => {
    expect(svc.verifySvixSignature(secret, { id: undefined, timestamp, signature: `v1,${sig}`, rawBody }, now)).toBe(false)
  })

  it('verifyResendWebhook: whsec_ secret → Svix path', async () => {
    configRepo.getValue.mockResolvedValue(secret)
    const headers = { 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': `v1,${sig}` }
    expect(await svc.verifyResendWebhook({ rawBody, headers })).toBe(true)
    expect(await svc.verifyResendWebhook({ rawBody: '{}', headers })).toBe(false)
  })
  it('verifyResendWebhook: legacy plain secret → x-webhook-secret compare', async () => {
    configRepo.getValue.mockResolvedValue('s3cr3t')
    expect(await svc.verifyResendWebhook({ rawBody, headers: { 'x-webhook-secret': 's3cr3t' } })).toBe(true)
    expect(await svc.verifyResendWebhook({ rawBody, headers: { 'x-webhook-secret': 'wrong!' } })).toBe(false)
    expect(await svc.verifyResendWebhook({ rawBody, headers: {} })).toBe(false)
  })
  it('verifyResendWebhook: no secret configured → accept (dev-stub)', async () => {
    configRepo.getValue.mockResolvedValue(null)
    expect(await svc.verifyResendWebhook({ rawBody, headers: {} })).toBe(true)
  })
})

describe('handleResendEvent → email.received dispatch (inbound §24)', () => {
  it('delegates to the inbound pipeline', async () => {
    vi.doMock('../services/inbound.service.js', () => ({
      handleInboundReceived: vi.fn().mockResolvedValue({ handled: true, id: 'e1' }),
    }))
    const { handleInboundReceived } = await import('../services/inbound.service.js')
    const r = await svc.handleResendEvent({ type: 'email.received', data: { email_id: 're_1', from: 'a@x.com', to: ['b@y.com'] } })
    expect(handleInboundReceived).toHaveBeenCalledWith(expect.objectContaining({ email_id: 're_1' }))
    expect(r).toMatchObject({ handled: true, id: 'e1' })
    // No suppression/delivery side-effects for inbound events.
    expect(suppression.suppress).not.toHaveBeenCalled()
    expect(sendLogRepo.updateDeliveryStatus).not.toHaveBeenCalled()
    vi.doUnmock('../services/inbound.service.js')
  })
})
