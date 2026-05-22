// messaging.service — attach/detach/list de attachments backed por platform/storage.
// Contrato:
//   - ensureMessageAccess: thread access check + message existe en ese thread.
//     · thread no existe → 404 ('thread').
//     · message no existe → 404 ('message').
//     · message.thread_id !== threadId → 404 ('message') — anti cross-thread leak.
//     · non-participant non-staff → 403 (vía ensureThreadAccess).
//   - attachToMessage: requiere acceso al message; persiste attachment.
//   - listMessageAttachments: requiere acceso; lista.
//   - detachFromMessage:
//       · solo el original sender (o staff) puede borrar (else 403).
//       · attachment no existe → 404.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/messaging.repository.js')

import {
  attachToMessage, listMessageAttachments, detachFromMessage,
} from '../services/messaging.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/messaging.repository.js'

const ctx = (overrides = {}) => ({
  appId: 'shop', tenantId: 't1', subTenantId: null,
  userId: 'buyer-1', role: 'user',
  ...overrides,
})
const THREAD = 'th-1'
const MSG    = 'msg-1'
const ATTACH = 'att-1'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── Acceso al thread + message ──────────────────────────────────────

describe('ensureMessageAccess (vía endpoints)', () => {
  it('thread no existe → NotFoundError "thread"', async () => {
    repo.findThreadById.mockResolvedValue(null)
    await expect(attachToMessage(ctx(), THREAD, MSG, { objectId: 'obj-1' }))
      .rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining('thread') })
  })

  it('message no existe (en thread existente) → NotFoundError "message"', async () => {
    repo.findThreadById.mockResolvedValue({ id: THREAD, buyer_user_id: 'buyer-1', vendor_user_id: 'vendor-1' })
    repo.findMessageById.mockResolvedValue(null)
    await expect(attachToMessage(ctx(), THREAD, MSG, { objectId: 'obj-1' }))
      .rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining('message') })
  })

  it('message.thread_id != threadId param → NotFoundError (anti cross-thread leak)', async () => {
    repo.findThreadById.mockResolvedValue({ id: THREAD, buyer_user_id: 'buyer-1', vendor_user_id: 'v1' })
    repo.findMessageById.mockResolvedValue({ id: MSG, thread_id: 'OTHER-THREAD', sender_user_id: 'buyer-1' })
    await expect(attachToMessage(ctx(), THREAD, MSG, { objectId: 'obj-1' }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('non-participant non-staff → 403 (vía ensureThreadAccess)', async () => {
    repo.findThreadById.mockResolvedValue({ id: THREAD, buyer_user_id: 'buyer-1', vendor_user_id: 'vendor-1' })
    await expect(attachToMessage(ctx({ userId: 'stranger', role: 'user' }), THREAD, MSG, { objectId: 'o' }))
      .rejects.toMatchObject({ statusCode: 403, message: expect.stringContaining('not a participant') })
  })

  it('staff puede acceder aunque no sea party', async () => {
    repo.findThreadById.mockResolvedValue({ id: THREAD, buyer_user_id: 'b', vendor_user_id: 'v' })
    repo.findMessageById.mockResolvedValue({ id: MSG, thread_id: THREAD, sender_user_id: 'b' })
    repo.insertAttachment.mockResolvedValue({ id: ATTACH })
    await attachToMessage(ctx({ userId: 'staff-1', role: 'staff' }), THREAD, MSG, { objectId: 'obj-1' })
    expect(repo.insertAttachment).toHaveBeenCalled()
  })
})

// ── attachToMessage ─────────────────────────────────────────────────

describe('attachToMessage', () => {
  it('happy: buyer adjunta a su mensaje', async () => {
    repo.findThreadById.mockResolvedValue({ id: THREAD, buyer_user_id: 'buyer-1', vendor_user_id: 'v1' })
    repo.findMessageById.mockResolvedValue({ id: MSG, thread_id: THREAD, sender_user_id: 'buyer-1' })
    repo.insertAttachment.mockResolvedValue({ id: ATTACH, object_id: 'obj-1' })
    const r = await attachToMessage(ctx(), THREAD, MSG, { objectId: 'obj-1', fileName: 'rcpt.pdf' })
    expect(repo.insertAttachment).toHaveBeenCalledWith(
      expect.anything(), ctx().appId, ctx().tenantId, MSG, { objectId: 'obj-1', fileName: 'rcpt.pdf' },
    )
    expect(r.id).toBe(ATTACH)
  })
})

// ── listMessageAttachments ──────────────────────────────────────────

describe('listMessageAttachments', () => {
  it('happy: vendor lista attachments de un mensaje del buyer', async () => {
    repo.findThreadById.mockResolvedValue({ id: THREAD, buyer_user_id: 'b1', vendor_user_id: 'vendor-1' })
    repo.findMessageById.mockResolvedValue({ id: MSG, thread_id: THREAD, sender_user_id: 'b1' })
    repo.listAttachments.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }])
    const r = await listMessageAttachments(ctx({ userId: 'vendor-1' }), THREAD, MSG)
    expect(r).toHaveLength(2)
  })

  it('non-participant non-staff → 403', async () => {
    repo.findThreadById.mockResolvedValue({ id: THREAD, buyer_user_id: 'b', vendor_user_id: 'v' })
    await expect(listMessageAttachments(ctx({ userId: 'x' }), THREAD, MSG))
      .rejects.toMatchObject({ statusCode: 403 })
  })
})

// ── detachFromMessage — ownership ───────────────────────────────────

describe('detachFromMessage — solo sender o staff', () => {
  it('participant que NO es sender ni staff → ForbiddenError', async () => {
    repo.findThreadById.mockResolvedValue({ id: THREAD, buyer_user_id: 'buyer-1', vendor_user_id: 'vendor-1' })
    // El mensaje lo envió el vendor; el buyer intenta borrarle el attachment.
    repo.findMessageById.mockResolvedValue({ id: MSG, thread_id: THREAD, sender_user_id: 'vendor-1' })
    await expect(detachFromMessage(ctx({ userId: 'buyer-1' }), THREAD, MSG, ATTACH))
      .rejects.toMatchObject({
        statusCode: 403,
        message: expect.stringContaining('only the message sender'),
      })
    expect(repo.deleteAttachment).not.toHaveBeenCalled()
  })

  it('original sender → puede borrar', async () => {
    repo.findThreadById.mockResolvedValue({ id: THREAD, buyer_user_id: 'buyer-1', vendor_user_id: 'v1' })
    repo.findMessageById.mockResolvedValue({ id: MSG, thread_id: THREAD, sender_user_id: 'buyer-1' })
    repo.deleteAttachment.mockResolvedValue(true)
    await detachFromMessage(ctx({ userId: 'buyer-1' }), THREAD, MSG, ATTACH)
    expect(repo.deleteAttachment).toHaveBeenCalledWith(expect.anything(), ctx().appId, ctx().tenantId, ATTACH)
  })

  it('staff (sin ser sender) → puede borrar (moderación)', async () => {
    repo.findThreadById.mockResolvedValue({ id: THREAD, buyer_user_id: 'b', vendor_user_id: 'v' })
    repo.findMessageById.mockResolvedValue({ id: MSG, thread_id: THREAD, sender_user_id: 'b' })
    repo.deleteAttachment.mockResolvedValue(true)
    await detachFromMessage(ctx({ userId: 'staff-1', role: 'staff' }), THREAD, MSG, ATTACH)
    expect(repo.deleteAttachment).toHaveBeenCalled()
  })

  it('attachment no existe → NotFoundError 404', async () => {
    repo.findThreadById.mockResolvedValue({ id: THREAD, buyer_user_id: 'buyer-1', vendor_user_id: 'v1' })
    repo.findMessageById.mockResolvedValue({ id: MSG, thread_id: THREAD, sender_user_id: 'buyer-1' })
    repo.deleteAttachment.mockResolvedValue(false)
    await expect(detachFromMessage(ctx(), THREAD, MSG, 'ghost'))
      .rejects.toMatchObject({ statusCode: 404, message: expect.stringContaining('attachment') })
  })
})
