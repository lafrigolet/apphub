import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

vi.mock('../services/conversations.service.js', () => ({
  create: vi.fn(), list: vi.fn(), get: vi.fn(), update: vi.fn(), leave: vi.fn(),
  listParticipants: vi.fn(), addParticipants: vi.fn(), updateParticipant: vi.fn(), removeParticipant: vi.fn(),
  acceptRequest: vi.fn(), declineRequest: vi.fn(),
  createInvite: vi.fn(), listInvites: vi.fn(), revokeInvite: vi.fn(), joinByCode: vi.fn(),
  listPublic: vi.fn(), joinPublic: vi.fn(),
}))
vi.mock('../services/messages.service.js', () => ({
  listMessages: vi.fn(), postMessage: vi.fn(), editMessage: vi.fn(), deleteMessage: vi.fn(),
  markRead: vi.fn(), markDelivered: vi.fn(), unread: vi.fn(), addReaction: vi.fn(), removeReaction: vi.fn(),
  attach: vi.fn(), listAttachments: vi.fn(), detach: vi.fn(),
  forward: vi.fn(), listThread: vi.fn(), pin: vi.fn(), unpin: vi.fn(), listPins: vi.fn(),
  listScheduled: vi.fn(), rescheduleScheduled: vi.fn(), cancelScheduled: vi.fn(),
}))
vi.mock('../services/support.service.js', () => ({
  open: vi.fn(), queue: vi.fn(), assign: vi.fn(), updateSupport: vi.fn(), setQueue: vi.fn(),
  submitCsat: vi.fn(), getCsat: vi.fn(), listMacros: vi.fn(), createMacro: vi.fn(),
  updateMacro: vi.fn(), deleteMacro: vi.fn(),
}))
vi.mock('../services/moderation.service.js', () => ({
  block: vi.fn(), unblock: vi.fn(), listBlocks: vi.fn(), report: vi.fn(), listReports: vi.fn(), updateReport: vi.fn(),
  banUser: vi.fn(), unbanUser: vi.fn(), listBans: vi.fn(), listUserReports: vi.fn(), eraseUserData: vi.fn(),
}))
vi.mock('../services/search.service.js', () => ({ search: vi.fn() }))
vi.mock('../services/presence.service.js', () => ({ snapshot: vi.fn() }))
vi.mock('../services/settings.service.js', () => ({ getForTenant: vi.fn(), upsertForTenant: vi.fn() }))
vi.mock('../services/admin.service.js', () => ({ metrics: vi.fn(), exportConversation: vi.fn() }))

import { memberRoutes } from '../routes/conversations.routes.js'
import { supportRoutes } from '../routes/support.routes.js'
import { moderationRoutes } from '../routes/moderation.routes.js'
import { adminRoutes } from '../routes/admin.routes.js'
import * as convService from '../services/conversations.service.js'
import * as msgService from '../services/messages.service.js'
import * as supportService from '../services/support.service.js'
import * as moderationService from '../services/moderation.service.js'
import * as searchService from '../services/search.service.js'
import * as settingsService from '../services/settings.service.js'
import * as adminService from '../services/admin.service.js'

const C = '22222222-2222-2222-2222-222222222222'
const M = '33333333-3333-3333-3333-333333333333'
const U = '44444444-4444-4444-4444-444444444444'

let identity
async function buildApp() {
  const app = Fastify({ logger: false })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.decorateRequest('identity', null)
  app.addHook('onRequest', async (req) => { req.identity = identity })
  await app.register(async (scope) => {
    await memberRoutes(scope); await supportRoutes(scope); await moderationRoutes(scope)
  }, { prefix: '/v1/chat' })
  await app.register(adminRoutes, { prefix: '/v1/chat/admin' })
  app.setErrorHandler((err, req, reply) => {
    if (err.statusCode) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.ready()
  return app
}

let app
beforeEach(async () => {
  vi.clearAllMocks()
  identity = { appId: 'platform', tenantId: 't1', subTenantId: null, userId: 'u1', role: 'user' }
  app = await buildApp()
})
afterEach(async () => { await app.close() })

const json = (method, url, payload) => app.inject(
  payload === undefined
    ? { method, url }
    : { method, url, headers: { 'Content-Type': 'application/json' }, payload },
)

describe('conversations routes', () => {
  it('POST /conversations → 201', async () => {
    convService.create.mockResolvedValue({ id: C, type: 'direct' })
    const res = await json('POST', '/v1/chat/conversations', { type: 'direct', participantIds: [U] })
    expect(res.statusCode).toBe(201)
    expect(convService.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }), expect.objectContaining({ type: 'direct' }))
  })
  it('GET /conversations → list', async () => {
    convService.list.mockResolvedValue([{ id: C }])
    const res = await json('GET', '/v1/chat/conversations?type=group')
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toHaveLength(1)
  })
  it('GET /conversations/:id', async () => {
    convService.get.mockResolvedValue({ id: C })
    expect((await json('GET', `/v1/chat/conversations/${C}`)).statusCode).toBe(200)
  })
  it('PATCH /conversations/:id', async () => {
    convService.update.mockResolvedValue({ id: C, title: 'X' })
    const res = await json('PATCH', `/v1/chat/conversations/${C}`, { title: 'X' })
    expect(res.json().data.title).toBe('X')
  })
  it('POST /conversations/:id/leave', async () => {
    convService.leave.mockResolvedValue()
    expect((await json('POST', `/v1/chat/conversations/${C}/leave`)).json().data.ok).toBe(true)
  })
  it('participant add/patch/remove', async () => {
    convService.addParticipants.mockResolvedValue([{ user_id: U }])
    expect((await json('POST', `/v1/chat/conversations/${C}/participants`, { userIds: [U] })).statusCode).toBe(201)
    convService.updateParticipant.mockResolvedValue({ user_id: U, role: 'admin' })
    expect((await json('PATCH', `/v1/chat/conversations/${C}/participants/${U}`, { role: 'admin' })).statusCode).toBe(200)
    convService.removeParticipant.mockResolvedValue()
    expect((await json('DELETE', `/v1/chat/conversations/${C}/participants/${U}`)).json().data.ok).toBe(true)
  })
})

describe('messages routes', () => {
  it('POST message → 201', async () => {
    msgService.postMessage.mockResolvedValue({ id: M })
    const res = await json('POST', `/v1/chat/conversations/${C}/messages`, { body: 'hi' })
    expect(res.statusCode).toBe(201)
  })
  it('GET messages, PATCH edit, DELETE', async () => {
    msgService.listMessages.mockResolvedValue([])
    expect((await json('GET', `/v1/chat/conversations/${C}/messages?limit=10`)).statusCode).toBe(200)
    msgService.editMessage.mockResolvedValue({ id: M, body: 'e' })
    expect((await json('PATCH', `/v1/chat/conversations/${C}/messages/${M}`, { body: 'e' })).statusCode).toBe(200)
    msgService.deleteMessage.mockResolvedValue({ id: M })
    expect((await json('DELETE', `/v1/chat/conversations/${C}/messages/${M}`)).statusCode).toBe(200)
  })
  it('read + unread', async () => {
    msgService.markRead.mockResolvedValue({ last_read_at: 'now' })
    expect((await json('POST', `/v1/chat/conversations/${C}/read`, { lastReadMessageId: M })).statusCode).toBe(200)
    msgService.unread.mockResolvedValue([])
    expect((await json('GET', '/v1/chat/unread')).statusCode).toBe(200)
  })
  it('reactions put/delete', async () => {
    msgService.addReaction.mockResolvedValue([])
    expect((await json('PUT', `/v1/chat/conversations/${C}/messages/${M}/reactions/%F0%9F%91%8D`)).statusCode).toBe(200)
    msgService.removeReaction.mockResolvedValue([])
    expect((await json('DELETE', `/v1/chat/conversations/${C}/messages/${M}/reactions/%F0%9F%91%8D`)).statusCode).toBe(200)
  })
  it('attachments post/get/delete', async () => {
    msgService.attach.mockResolvedValue({ id: 'a1' })
    expect((await json('POST', `/v1/chat/conversations/${C}/messages/${M}/attachments`, { objectId: U, kind: 'image' })).statusCode).toBe(201)
    msgService.listAttachments.mockResolvedValue([])
    expect((await json('GET', `/v1/chat/conversations/${C}/messages/${M}/attachments`)).statusCode).toBe(200)
    msgService.detach.mockResolvedValue()
    expect((await json('DELETE', `/v1/chat/conversations/${C}/messages/${M}/attachments/${U}`)).statusCode).toBe(200)
  })
})

describe('support / moderation / search / presence routes', () => {
  it('support open + queue + assign + patch', async () => {
    supportService.open.mockResolvedValue({ id: C })
    expect((await json('POST', '/v1/chat/support/conversations', { subject: 'h' })).statusCode).toBe(201)
    supportService.queue.mockResolvedValue([])
    expect((await json('GET', '/v1/chat/support/queue')).statusCode).toBe(200)
    supportService.assign.mockResolvedValue({ id: C })
    expect((await json('POST', `/v1/chat/conversations/${C}/assign`, { agentUserId: U })).statusCode).toBe(200)
    supportService.updateSupport.mockResolvedValue({ id: C })
    expect((await json('PATCH', `/v1/chat/conversations/${C}/support`, { supportStatus: 'resolved' })).statusCode).toBe(200)
  })
  it('blocks + reports + search + presence', async () => {
    moderationService.listBlocks.mockResolvedValue([])
    expect((await json('GET', '/v1/chat/blocks')).statusCode).toBe(200)
    moderationService.block.mockResolvedValue({ blocked_user_id: U })
    expect((await json('PUT', `/v1/chat/blocks/${U}`)).statusCode).toBe(201)
    moderationService.unblock.mockResolvedValue()
    expect((await json('DELETE', `/v1/chat/blocks/${U}`)).statusCode).toBe(200)
    moderationService.report.mockResolvedValue({ id: 'r1' })
    expect((await json('POST', '/v1/chat/reports', { targetType: 'message', targetId: M })).statusCode).toBe(201)
    searchService.search.mockResolvedValue([])
    expect((await json('GET', '/v1/chat/search?q=hi')).statusCode).toBe(200)
  })
})

describe('new member routes (block A)', () => {
  it('forward + thread + delivered', async () => {
    msgService.forward.mockResolvedValue({ id: M })
    expect((await json('POST', `/v1/chat/conversations/${C}/messages/${M}/forward`, { toConversationId: '55555555-5555-5555-5555-555555555555' })).statusCode).toBe(201)
    msgService.listThread.mockResolvedValue([])
    expect((await json('GET', `/v1/chat/conversations/${C}/messages/${M}/thread`)).statusCode).toBe(200)
    msgService.markDelivered.mockResolvedValue({ last_delivered_at: 'now' })
    expect((await json('POST', `/v1/chat/conversations/${C}/delivered`, { lastDeliveredMessageId: M })).statusCode).toBe(200)
  })
  it('pins put/delete/get', async () => {
    msgService.pin.mockResolvedValue()
    expect((await json('PUT', `/v1/chat/conversations/${C}/messages/${M}/pin`)).statusCode).toBe(201)
    msgService.unpin.mockResolvedValue()
    expect((await json('DELETE', `/v1/chat/conversations/${C}/messages/${M}/pin`)).statusCode).toBe(200)
    msgService.listPins.mockResolvedValue([])
    expect((await json('GET', `/v1/chat/conversations/${C}/pins`)).statusCode).toBe(200)
  })
  it('scheduled list/reschedule/cancel', async () => {
    const S = '66666666-6666-6666-6666-666666666666'
    msgService.listScheduled.mockResolvedValue([{ id: M }])
    expect((await json('GET', '/v1/chat/scheduled')).statusCode).toBe(200)
    msgService.rescheduleScheduled.mockResolvedValue({ id: M })
    expect((await json('PATCH', `/v1/chat/scheduled/${S}`, { scheduledFor: '2999-01-01T00:00:00Z' })).statusCode).toBe(200)
    msgService.cancelScheduled.mockResolvedValue({ id: M, status: 'cancelled' })
    expect((await json('DELETE', `/v1/chat/scheduled/${S}`)).statusCode).toBe(200)
  })
  it('accept/decline requests', async () => {
    convService.acceptRequest.mockResolvedValue({ id: C, is_request: false })
    expect((await json('POST', `/v1/chat/conversations/${C}/accept`)).statusCode).toBe(200)
    convService.declineRequest.mockResolvedValue()
    expect((await json('POST', `/v1/chat/conversations/${C}/decline`)).json().data.ok).toBe(true)
  })
  it('invites create/list/revoke/join', async () => {
    convService.createInvite.mockResolvedValue({ id: 'i1', code: 'abc' })
    expect((await json('POST', `/v1/chat/conversations/${C}/invites`, { role: 'member' })).statusCode).toBe(201)
    convService.listInvites.mockResolvedValue([])
    expect((await json('GET', `/v1/chat/conversations/${C}/invites`)).statusCode).toBe(200)
    convService.revokeInvite.mockResolvedValue({ id: 'i1' })
    expect((await json('DELETE', `/v1/chat/conversations/${C}/invites/i1`)).statusCode).toBe(200)
    convService.joinByCode.mockResolvedValue({ id: C })
    expect((await json('POST', '/v1/chat/invites/abc/join')).statusCode).toBe(200)
  })
  it('public list/join', async () => {
    convService.listPublic.mockResolvedValue([])
    expect((await json('GET', '/v1/chat/public/conversations')).statusCode).toBe(200)
    convService.joinPublic.mockResolvedValue({ id: C })
    expect((await json('POST', `/v1/chat/public/conversations/${C}/join`)).statusCode).toBe(200)
  })
})

describe('new support routes (CSAT / macros / queue)', () => {
  it('csat submit + staff read', async () => {
    supportService.submitCsat.mockResolvedValue({ id: 'cs1', rating: 5 })
    expect((await json('POST', `/v1/chat/conversations/${C}/csat`, { rating: 5 })).statusCode).toBe(201)
    supportService.getCsat.mockResolvedValue([])
    expect((await json('GET', `/v1/chat/conversations/${C}/csat`)).statusCode).toBe(200)
  })
  it('macros list/create/delete + queue', async () => {
    supportService.listMacros.mockResolvedValue([])
    expect((await json('GET', '/v1/chat/support/macros')).statusCode).toBe(200)
    supportService.createMacro.mockResolvedValue({ id: 'mm1' })
    expect((await json('POST', '/v1/chat/support/macros', { title: 'T', body: 'B' })).statusCode).toBe(201)
    supportService.updateMacro.mockResolvedValue({ id: 'mm1', title: 'T2' })
    expect((await json('PATCH', '/v1/chat/support/macros/mm1', { title: 'T2' })).statusCode).toBe(200)
    expect((await json('PATCH', '/v1/chat/support/macros/mm1', {})).statusCode).toBe(400)
    supportService.deleteMacro.mockResolvedValue({ ok: true })
    expect((await json('DELETE', '/v1/chat/support/macros/mm1')).statusCode).toBe(200)
    supportService.setQueue.mockResolvedValue({ id: C, queue: 'billing' })
    expect((await json('PATCH', `/v1/chat/conversations/${C}/queue`, { queue: 'billing' })).statusCode).toBe(200)
  })
})

describe('admin routes — role gate', () => {
  it('user is forbidden', async () => {
    expect((await json('GET', '/v1/chat/admin/settings')).statusCode).toBe(403)
  })
  it('staff can read/write settings + reports + bans + metrics + export', async () => {
    identity = { appId: 'platform', tenantId: 't1', subTenantId: null, userId: 's1', role: 'staff' }
    app = await buildApp()
    settingsService.getForTenant.mockResolvedValue({ allow_groups: true })
    expect((await json('GET', '/v1/chat/admin/settings')).statusCode).toBe(200)
    settingsService.upsertForTenant.mockResolvedValue({ allow_groups: false })
    expect((await json('PUT', '/v1/chat/admin/settings', { allowGroups: false })).statusCode).toBe(200)
    moderationService.listReports.mockResolvedValue([])
    expect((await json('GET', '/v1/chat/admin/reports')).statusCode).toBe(200)
    moderationService.updateReport.mockResolvedValue({ id: 'r1', status: 'reviewed' })
    expect((await json('PATCH', '/v1/chat/admin/reports/r1', { status: 'reviewed' })).statusCode).toBe(200)
    moderationService.listBans.mockResolvedValue([])
    expect((await json('GET', '/v1/chat/admin/bans')).statusCode).toBe(200)
    moderationService.banUser.mockResolvedValue({ user_id: U })
    expect((await json('POST', '/v1/chat/admin/bans', { userId: U, reason: 'spam', bannedUntil: '2999-01-01T00:00:00Z' })).statusCode).toBe(201)
    expect(moderationService.banUser).toHaveBeenCalledWith(expect.any(Object), U, 'spam', '2999-01-01T00:00:00Z')
    moderationService.unbanUser.mockResolvedValue()
    expect((await json('DELETE', `/v1/chat/admin/bans/${U}`)).statusCode).toBe(200)
    adminService.metrics.mockResolvedValue({ direct_count: 1 })
    expect((await json('GET', '/v1/chat/admin/metrics')).statusCode).toBe(200)
    adminService.exportConversation.mockResolvedValue({ conversation: {}, messages: [] })
    expect((await json('GET', `/v1/chat/admin/conversations/${C}/export`)).statusCode).toBe(200)
  })
  it('staff can read per-user report history + GDPR-erase a user', async () => {
    identity = { appId: 'platform', tenantId: 't1', subTenantId: null, userId: 's1', role: 'staff' }
    app = await buildApp()
    moderationService.listUserReports.mockResolvedValue({ total: 2, open: 1, reports: [] })
    const r1 = await json('GET', `/v1/chat/admin/users/${U}/reports?limit=10`)
    expect(r1.statusCode).toBe(200)
    expect(r1.json().data.total).toBe(2)
    expect(moderationService.listUserReports).toHaveBeenCalledWith(expect.any(Object), U, { limit: 10 })
    moderationService.eraseUserData.mockResolvedValue({ userId: U, messagesAnonymized: 3, conversationsLeft: 1 })
    const r2 = await json('DELETE', `/v1/chat/admin/users/${U}/data`)
    expect(r2.statusCode).toBe(200)
    expect(r2.json().data.messagesAnonymized).toBe(3)
    expect(moderationService.eraseUserData).toHaveBeenCalledWith(expect.any(Object), U)
  })
  it('GDPR-erase is forbidden for a plain user', async () => {
    expect((await json('DELETE', `/v1/chat/admin/users/${U}/data`)).statusCode).toBe(403)
  })
})
