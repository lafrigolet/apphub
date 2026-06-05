// inbound.service — the §24–§28 pipeline. All repos, the provider client, the
// attachment store and the config cache are mocked; we assert the FSM
// transitions, the gates, the routing precedence and the published events.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { release, connect } = vi.hoisted(() => ({ release: vi.fn(), connect: vi.fn() }))
vi.mock('../lib/db.js', () => ({ pool: { connect } }))

const redisMock = vi.hoisted(() => ({ incr: vi.fn(), expire: vi.fn() }))
const publishMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/redis.js', () => ({ redis: redisMock, publish: publishMock }))

const inboundRepo = vi.hoisted(() => ({
  upsertReceived: vi.fn(), markFetched: vi.fn(), markRouted: vi.fn(),
  markArchived: vi.fn(), markQuarantined: vi.fn(), markFailed: vi.fn(),
  resetForReprocess: vi.fn(), findById: vi.fn(), purgeOlderThan: vi.fn(),
}))
vi.mock('../repositories/inbound-emails.repository.js', () => inboundRepo)

const routesRepo = vi.hoisted(() => ({ findMatch: vi.fn() }))
vi.mock('../repositories/inbound-routes.repository.js', () => routesRepo)

const tokensRepo = vi.hoisted(() => ({ findValid: vi.fn(), recordUse: vi.fn(), purgeExpired: vi.fn() }))
vi.mock('../repositories/inbound-reply-tokens.repository.js', () => tokensRepo)

const sendLogRepo = vi.hoisted(() => ({ findByProviderMessageIds: vi.fn() }))
vi.mock('../repositories/send-log.repository.js', () => sendLogRepo)

const fetchReceivedEmail = vi.hoisted(() => vi.fn())
vi.mock('../services/resend-inbound.service.js', () => ({ fetchReceivedEmail }))

const attachmentsSvc = vi.hoisted(() => ({ storeAttachments: vi.fn(), deleteStoredObjects: vi.fn() }))
vi.mock('../services/inbound-attachments.service.js', () => attachmentsSvc)

const getInboundConfig = vi.hoisted(() => vi.fn())
vi.mock('../services/inbound-config.service.js', () => ({ getInboundConfig }))

import * as svc from '../services/inbound.service.js'

const ROW = {
  id: 'e1', provider_email_id: 're_abc', from_address: 'ana@x.com', from_name: 'Ana',
  to_addresses: ['soporte@reply.h.com'], subject: 'Hola', status: 'received',
  received_at: '2026-06-05T10:00:00Z', inserted: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  connect.mockResolvedValue({ release })
  getInboundConfig.mockResolvedValue({}) // defaults: no blocklist, no domain pin
  redisMock.incr.mockResolvedValue(1)
  inboundRepo.upsertReceived.mockResolvedValue(ROW)
  inboundRepo.markFetched.mockImplementation(async (_c, _id, c) => ({
    ...ROW, status: 'fetched', body_text: c.bodyText, in_reply_to: c.inReplyTo,
  }))
  fetchReceivedEmail.mockResolvedValue(null) // stub mode by default
  attachmentsSvc.storeAttachments.mockResolvedValue([])
  tokensRepo.findValid.mockResolvedValue(null)
  routesRepo.findMatch.mockResolvedValue(null)
  sendLogRepo.findByProviderMessageIds.mockResolvedValue(null)
})

describe('handleInboundReceived (webhook entry)', () => {
  it('persists the metadata row and runs the pipeline → unrouted fallback', async () => {
    const r = await svc.handleInboundReceived({
      email_id: 're_abc', from: 'Ana <ana@x.com>', to: ['soporte@reply.h.com'], subject: 'Hola',
    })
    expect(r.handled).toBe(true)
    expect(inboundRepo.upsertReceived).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      providerEmailId: 're_abc', fromAddress: 'ana@x.com', fromName: 'Ana',
    }))
    // No token, no rule → fallback archive → status 'unrouted'.
    expect(inboundRepo.markArchived).toHaveBeenCalledWith(expect.anything(), 'e1', 'unrouted')
    // Generic audit event always published.
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'email.inbound.received' }))
  })

  it('ignores events without email_id or from', async () => {
    expect(await svc.handleInboundReceived({})).toMatchObject({ ignored: true })
    expect(await svc.handleInboundReceived({ email_id: 'x' })).toMatchObject({ ignored: true })
  })

  it('redelivered webhook for an already-processed row → duplicate no-op', async () => {
    inboundRepo.upsertReceived.mockResolvedValue({ ...ROW, inserted: false, status: 'routed' })
    const r = await svc.handleInboundReceived({ email_id: 're_abc', from: 'ana@x.com', to: [] })
    expect(r).toMatchObject({ duplicate: true })
    expect(inboundRepo.markFetched).not.toHaveBeenCalled()
  })
})

describe('security gates (§28)', () => {
  it('blocked sender (exact + domain) → quarantined, nothing published', async () => {
    getInboundConfig.mockResolvedValue({ inbound_blocked_senders: 'spam.com, otro@y.com' })
    const r = await svc.processInbound({ ...ROW, from_address: 'evil@spam.com' })
    expect(r).toEqual({ quarantined: 'blocked_sender' })
    expect(inboundRepo.markQuarantined).toHaveBeenCalledWith(expect.anything(), 'e1', 'blocked_sender')
    expect(publishMock).not.toHaveBeenCalled()
  })
  it('allowlist configured and sender not on it → quarantined', async () => {
    getInboundConfig.mockResolvedValue({ inbound_allowed_senders: 'cliente.com' })
    const r = await svc.processInbound(ROW)
    expect(r).toEqual({ quarantined: 'sender_not_allowed' })
  })
  it('our own sender address → self_loop quarantine', async () => {
    getInboundConfig.mockResolvedValue({ sender_email: 'Ana@x.com' })
    const r = await svc.processInbound(ROW)
    expect(r).toEqual({ quarantined: 'self_loop' })
  })
  it('per-sender rate limit exceeded → rate_limited', async () => {
    redisMock.incr.mockResolvedValue(31)
    const r = await svc.processInbound(ROW)
    expect(r).toEqual({ quarantined: 'rate_limited' })
  })
  it('rate-limit check fails open on Redis error', async () => {
    redisMock.incr.mockRejectedValue(new Error('redis down'))
    const r = await svc.processInbound(ROW)
    expect(r).not.toHaveProperty('quarantined')
  })
})

describe('fetch + auto-reply (§24, §28)', () => {
  it('fetches content via the Receiving API and stamps it', async () => {
    fetchReceivedEmail.mockResolvedValue({
      text: 'Gracias!', html: '<p>Gracias!</p>',
      headers: { 'message-id': '<m1@r>', 'in-reply-to': '<orig@r>' },
      attachments: [],
    })
    getInboundConfig.mockResolvedValue({ resend_api_key: 're_k' })
    await svc.processInbound(ROW)
    expect(fetchReceivedEmail).toHaveBeenCalledWith({ apiKey: 're_k', emailId: 're_abc' })
    expect(inboundRepo.markFetched).toHaveBeenCalledWith(expect.anything(), 'e1', expect.objectContaining({
      bodyText: 'Gracias!', inReplyTo: '<orig@r>',
    }))
  })
  it('auto-reply → archived, no domain routing, audit event flags it', async () => {
    fetchReceivedEmail.mockResolvedValue({
      text: 'OOO', headers: { 'auto-submitted': 'auto-replied' }, attachments: [],
    })
    getInboundConfig.mockResolvedValue({ resend_api_key: 're_k' })
    const r = await svc.processInbound(ROW)
    expect(r).toEqual({ archived: 'auto_reply' })
    expect(inboundRepo.markArchived).toHaveBeenCalledWith(expect.anything(), 'e1', 'archived')
    expect(routesRepo.findMatch).not.toHaveBeenCalled()
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'email.inbound.received',
      payload: expect.objectContaining({ autoReply: true }),
    }))
  })
  it('pipeline failure → markFailed, returns failed', async () => {
    fetchReceivedEmail.mockRejectedValue(new Error('api 500'))
    getInboundConfig.mockResolvedValue({ resend_api_key: 're_k' })
    const r = await svc.processInbound(ROW)
    expect(r).toEqual({ failed: true })
    expect(inboundRepo.markFailed).toHaveBeenCalledWith(expect.anything(), 'e1', 'api 500')
  })
})

describe('routing precedence (§26)', () => {
  it('reply token beats route rules and stamps tenant from the token', async () => {
    inboundRepo.markFetched.mockResolvedValue({
      ...ROW, status: 'fetched', body_text: 'Vale, gracias\n> historia',
      to_addresses: ['reply+a3f09b@reply.h.com'],
    })
    tokensRepo.findValid.mockResolvedValue({
      token: 'a3f09b', target_event: 'inquiry.reply.received',
      context: { inquiryId: 'i1' }, app_id: 'aikikan', tenant_id: 't1',
    })
    const r = await svc.processInbound(ROW)
    expect(r.result ?? r).toMatchObject({ routed: 'inquiry.reply.received', via: 'reply_token' })
    expect(tokensRepo.recordUse).toHaveBeenCalledWith(expect.anything(), 'a3f09b')
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'inquiry.reply.received',
      payload: expect.objectContaining({
        appId: 'aikikan', tenantId: 't1',
        context: { inquiryId: 'i1' },
        text: 'Vale, gracias', // cleaned reply
      }),
    }))
    expect(inboundRepo.markRouted).toHaveBeenCalledWith(expect.anything(), 'e1', expect.objectContaining({
      routedEvent: 'inquiry.reply.received', appId: 'aikikan', tenantId: 't1',
    }))
  })

  it('plus address on a different domain than inbound_domain is ignored', async () => {
    getInboundConfig.mockResolvedValue({ inbound_domain: 'reply.h.com' })
    inboundRepo.markFetched.mockResolvedValue({
      ...ROW, status: 'fetched', to_addresses: ['reply+a3f09b@otra.com'],
    })
    await svc.processInbound(ROW)
    expect(tokensRepo.findValid).not.toHaveBeenCalled()
  })

  it('route rule match → publishes target event with rule attribution', async () => {
    routesRepo.findMatch.mockResolvedValue({
      id: 'r1', target_event: 'lead.email.received', app_id: null, tenant_id: null,
    })
    const r = await svc.processInbound(ROW)
    expect(r.result ?? r).toMatchObject({ routed: 'lead.email.received', via: 'route' })
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      type: 'lead.email.received',
      payload: expect.objectContaining({ matchedAddress: 'soporte@reply.h.com' }),
    }))
  })

  it('fallback discard → archived', async () => {
    getInboundConfig.mockResolvedValue({ inbound_fallback_action: 'discard' })
    await svc.processInbound(ROW)
    expect(inboundRepo.markArchived).toHaveBeenCalledWith(expect.anything(), 'e1', 'archived')
  })
})

describe('correlation (§27)', () => {
  it('matches In-Reply-To msg-ids against send_log provider ids', async () => {
    fetchReceivedEmail.mockResolvedValue({
      text: 'ok', headers: { 'in-reply-to': '<re_xyz@mail.resend.com>' }, attachments: [],
    })
    getInboundConfig.mockResolvedValue({ resend_api_key: 're_k' })
    sendLogRepo.findByProviderMessageIds.mockResolvedValue({ id: 'sl1', template: 'inquiry.user_thank_you', user_id: null })
    await svc.processInbound(ROW)
    expect(sendLogRepo.findByProviderMessageIds).toHaveBeenCalledWith(
      expect.anything(), expect.arrayContaining(['re_xyz@mail.resend.com', 're_xyz']),
    )
    expect(publishMock).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        correlation: expect.objectContaining({ sendLogId: 'sl1' }),
      }),
    }))
  })
})

describe('injectInbound (dev-stub §23) + reprocess + purge (§29)', () => {
  it('inject runs the pipeline on a synthetic email without the provider', async () => {
    const r = await svc.injectInbound({ from: 'Ana <ana@x.com>', to: ['leads@reply.h.com'], text: 'Quiero info' })
    expect(r.id).toBe('e1')
    expect(fetchReceivedEmail).not.toHaveBeenCalled()
    expect(inboundRepo.upsertReceived).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      providerEmailId: expect.stringMatching(/^inject_/),
    }))
  })
  it('reprocess resets the row and re-runs; null when not found', async () => {
    inboundRepo.resetForReprocess.mockResolvedValue(ROW)
    const r = await svc.reprocess('e1')
    expect(r).toBeTruthy()
    inboundRepo.resetForReprocess.mockResolvedValue(null)
    expect(await svc.reprocess('nope')).toBe(null)
  })
  it('purgeInbound deletes rows, S3 objects and expired tokens', async () => {
    inboundRepo.purgeOlderThan.mockResolvedValue({ deleted: 3, objectKeys: [{ bucket: 'b', object_key: 'k' }] })
    tokensRepo.purgeExpired.mockResolvedValue(2)
    attachmentsSvc.deleteStoredObjects.mockResolvedValue(1)
    const r = await svc.purgeInbound(180)
    expect(inboundRepo.purgeOlderThan).toHaveBeenCalledWith(expect.anything(), '180')
    expect(attachmentsSvc.deleteStoredObjects).toHaveBeenCalledWith([{ bucket: 'b', object_key: 'k' }])
    expect(r).toEqual({ deleted: 3, objectsDeleted: 1, tokensPurged: 2 })
  })
  it('purgeInbound rejects nonsense retention', async () => {
    expect(await svc.purgeInbound(0)).toMatchObject({ skipped: expect.any(String) })
    expect(await svc.purgeInbound('x')).toMatchObject({ skipped: expect.any(String) })
  })
})
