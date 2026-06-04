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
