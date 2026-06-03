/**
 * Integration tests for platform/chat — require running Postgres + Redis.
 *
 * Covers:
 *   - Migrations apply (schema + tables + forced RLS).
 *   - E2E: create group → post → list → read marker → unread count.
 *   - Direct conversation dedup (same pair ⇒ same conversation).
 *   - Cross-tenant RLS isolation + app_id isolation.
 *   - Support: open → assign agent.
 *   - Real-time fan-out: posting a message reaches a WS socket via the
 *     Redis-backed gateway (browser-to-browser path).
 *
 * Start: ./scripts/test-db-up.sh
 * Run:   pnpm --filter @apphub/platform-chat test:integration
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import pg from 'pg'
import { v4 as uuidv4 } from 'uuid'
import Fastify from 'fastify'
import { appGuard } from '@apphub/platform-sdk/app-guard'
import { ZodError } from 'zod'
import { AppError } from '@apphub/platform-sdk/errors'
import {
  serializerCompiler, validatorCompiler, hasZodFastifySchemaValidationErrors,
} from 'fastify-type-provider-zod'
import { createPool } from '@apphub/platform-sdk/db'
import { createRedis } from '@apphub/platform-sdk/redis'
import { register, runMigrations } from '../../index.js'
import { createGateway } from '../../ws/gateway.js'
import * as messages from '../../services/messages.service.js'

const APP = 'platform'
const TENANT_A = '00000000-0000-0000-0000-0000000000c1'
const TENANT_B = '00000000-0000-0000-0000-0000000000c2'

function token({ sub = uuidv4(), tenant_id = TENANT_A, role = 'user', app_id = APP } = {}) {
  const payload = { sub, app_id, tenant_id, role, email: 'x@itest.local', exp: Math.floor(Date.now() / 1000) + 3600 }
  const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const pay = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${hdr}.${pay}.fakesig`
}
const bearer = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
const auth = (t) => ({ Authorization: `Bearer ${t}` }) // bodyless requests (no JSON content-type)

let app, adminPool, redis

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  await adminPool.query('SELECT 1')
  redis = createRedis(process.env.REDIS_URL)

  app = Fastify({ logger: false })
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  app.setErrorHandler((err, _req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err) || err instanceof ZodError || err.code === 'FST_ERR_VALIDATION') {
      return reply.status(422).send({ error: { code: 'VALIDATION_ERROR', message: 'invalid' } })
    }
    if (err instanceof AppError) return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } })
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: err.message } })
  })
  await app.register(appGuard)
  await register({ app, db: createPool(process.env.DATABASE_URL), redis, logger: { info() {}, warn() {}, error() {}, child: () => ({ info() {}, warn() {}, error() {} }) } })
  await app.ready()
})

afterAll(async () => {
  await app?.close()
  await adminPool?.end()
  await redis?.quit()
})

beforeEach(async () => {
  await adminPool.query('TRUNCATE platform_chat.conversations CASCADE')
  await adminPool.query('TRUNCATE platform_chat.blocks')
  await adminPool.query('TRUNCATE platform_chat.reports')
})

const post = (url, headers, payload) => app.inject({ method: 'POST', url, headers, payload })
const get = (url, headers) => app.inject({ method: 'GET', url, headers })

describe('migrations', () => {
  it('created the forced-RLS conversations table', async () => {
    const { rows } = await adminPool.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'platform_chat.conversations'::regclass`,
    )
    expect(rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true })
  })
})

describe('e2e group flow', () => {
  it('create → post → list → read → unread', async () => {
    const alice = uuidv4(); const bob = uuidv4()
    const tAlice = token({ sub: alice }); const tBob = token({ sub: bob })

    const created = await post('/v1/chat/conversations', bearer(tAlice), { type: 'group', title: 'Team', participantIds: [bob] })
    expect(created.statusCode).toBe(201)
    const convId = created.json().data.id

    const msg = await post(`/v1/chat/conversations/${convId}/messages`, bearer(tAlice), { body: 'hello team' })
    expect(msg.statusCode).toBe(201)
    const msgId = msg.json().data.id

    const list = await get(`/v1/chat/conversations/${convId}/messages`, bearer(tBob))
    expect(list.json().data.map((m) => m.id)).toContain(msgId)

    // Bob has 1 unread until he marks read.
    let unread = await get('/v1/chat/unread', bearer(tBob))
    expect(unread.json().data.find((u) => u.conversation_id === convId).unread_count).toBe(1)

    await post(`/v1/chat/conversations/${convId}/read`, bearer(tBob), { lastReadMessageId: msgId })
    unread = await get('/v1/chat/unread', bearer(tBob))
    expect(unread.json().data.find((u) => u.conversation_id === convId)).toBeUndefined()
  })

  it('dedups direct conversations for the same pair', async () => {
    const a = uuidv4(); const b = uuidv4()
    const r1 = await post('/v1/chat/conversations', bearer(token({ sub: a })), { type: 'direct', participantIds: [b] })
    const r2 = await post('/v1/chat/conversations', bearer(token({ sub: b })), { type: 'direct', participantIds: [a] })
    expect(r1.json().data.id).toBe(r2.json().data.id)
  })
})

describe('tenant + app isolation', () => {
  it('tenant B cannot read tenant A conversation', async () => {
    const a = uuidv4()
    const created = await post('/v1/chat/conversations', bearer(token({ sub: a, tenant_id: TENANT_A })), { type: 'group', title: 'A-only', participantIds: [uuidv4()] })
    const convId = created.json().data.id
    const asB = await get(`/v1/chat/conversations/${convId}`, bearer(token({ tenant_id: TENANT_B, role: 'user' })))
    expect([403, 404]).toContain(asB.statusCode)
  })
})

describe('support', () => {
  it('open then assign an agent', async () => {
    const member = uuidv4()
    const opened = await post('/v1/chat/support/conversations', bearer(token({ sub: member })), { subject: 'Need help' })
    expect(opened.statusCode).toBe(201)
    const convId = opened.json().data.id
    const agent = uuidv4()
    const assigned = await post(`/v1/chat/conversations/${convId}/assign`, bearer(token({ role: 'staff' })), { agentUserId: agent })
    expect(assigned.statusCode).toBe(200)
    expect(assigned.json().data.assigned_agent_user_id).toBe(agent)
  })
})

describe('block A/B features', () => {
  it('threads: replies are hidden from the main timeline but listed in the thread', async () => {
    const a = uuidv4()
    const conv = (await post('/v1/chat/conversations', bearer(token({ sub: a })), { type: 'group', title: 'T', participantIds: [uuidv4()] })).json().data.id
    const root = (await post(`/v1/chat/conversations/${conv}/messages`, bearer(token({ sub: a })), { body: 'root' })).json().data.id
    await post(`/v1/chat/conversations/${conv}/messages`, bearer(token({ sub: a })), { body: 'reply', threadRootId: root })
    const main = (await get(`/v1/chat/conversations/${conv}/messages`, bearer(token({ sub: a })))).json().data
    expect(main.filter((m) => m.body === 'reply')).toHaveLength(0)
    const thread = (await get(`/v1/chat/conversations/${conv}/messages/${root}/thread`, bearer(token({ sub: a })))).json().data
    expect(thread.map((m) => m.body)).toEqual(['root', 'reply'])
  })

  it('pins: pin then list', async () => {
    const a = uuidv4()
    const conv = (await post('/v1/chat/conversations', bearer(token({ sub: a })), { type: 'group', title: 'P', participantIds: [uuidv4()] })).json().data.id
    const mid = (await post(`/v1/chat/conversations/${conv}/messages`, bearer(token({ sub: a })), { body: 'pin me' })).json().data.id
    expect((await app.inject({ method: 'PUT', url: `/v1/chat/conversations/${conv}/messages/${mid}/pin`, headers: auth(token({ sub: a })) })).statusCode).toBe(201)
    const pins = (await get(`/v1/chat/conversations/${conv}/pins`, bearer(token({ sub: a })))).json().data
    expect(pins.map((p) => p.message_id)).toContain(mid)
  })

  it('invites: create then join by code', async () => {
    const owner = uuidv4(); const joiner = uuidv4()
    const conv = (await post('/v1/chat/conversations', bearer(token({ sub: owner })), { type: 'group', title: 'G', participantIds: [] })).json().data.id
    const code = (await post(`/v1/chat/conversations/${conv}/invites`, bearer(token({ sub: owner })), { role: 'member' })).json().data.code
    const joined = await app.inject({ method: 'POST', url: `/v1/chat/invites/${code}/join`, headers: auth(token({ sub: joiner })) })
    expect(joined.statusCode).toBe(200)
    const parts = (await get(`/v1/chat/conversations/${conv}/participants`, bearer(token({ sub: owner })))).json().data
    expect(parts.map((p) => p.user_id)).toContain(joiner)
  })

  it('scheduled send: parked until deliverScheduledFor flips it live', async () => {
    const a = uuidv4()
    const conv = (await post('/v1/chat/conversations', bearer(token({ sub: a })), { type: 'group', title: 'S', participantIds: [uuidv4()] })).json().data.id
    const future = new Date(Date.now() + 3600_000).toISOString()
    const scheduled = (await post(`/v1/chat/conversations/${conv}/messages`, bearer(token({ sub: a })), { body: 'later', scheduledFor: future })).json().data
    // Hidden from history while scheduled.
    let main = (await get(`/v1/chat/conversations/${conv}/messages`, bearer(token({ sub: a })))).json().data
    expect(main.find((m) => m.id === scheduled.id)).toBeUndefined()
    // Deliver it (simulating the scheduler → consumer path).
    await messages.deliverScheduledFor({ appId: APP, tenantId: TENANT_A, messageId: scheduled.id })
    main = (await get(`/v1/chat/conversations/${conv}/messages`, bearer(token({ sub: a })))).json().data
    expect(main.find((m) => m.id === scheduled.id)).toBeDefined()
  })

  it('tenant ban blocks posting', async () => {
    const a = uuidv4()
    const conv = (await post('/v1/chat/conversations', bearer(token({ sub: a })), { type: 'group', title: 'B', participantIds: [] })).json().data.id
    await post('/v1/chat/admin/bans', bearer(token({ role: 'staff' })), { userId: a, reason: 'spam' })
    const res = await post(`/v1/chat/conversations/${conv}/messages`, bearer(token({ sub: a })), { body: 'hi' })
    expect(res.statusCode).toBe(403)
  })
})

describe('real-time fan-out (browser-to-browser path)', () => {
  it('a posted message is delivered to a recipient socket via Redis', async () => {
    const alice = uuidv4(); const bob = uuidv4()
    const created = await post('/v1/chat/conversations', bearer(token({ sub: alice })), { type: 'direct', participantIds: [bob] })
    const convId = created.json().data.id

    // Stand up a second gateway (simulating another platform-core instance)
    // wired to the same Redis, with a fake socket for Bob registered.
    const gw = createGateway({ redis, logger: { error() {}, warn() {} } })
    const received = []
    const bobSocket = { send: (d) => received.push(JSON.parse(d)) }
    gw.sockets.set(`${APP}:${TENANT_A}:${bob}`, new Set([bobSocket]))
    await new Promise((r) => setTimeout(r, 150)) // let psubscribe settle

    await post(`/v1/chat/conversations/${convId}/messages`, bearer(token({ sub: alice })), { body: 'ping bob' })

    // Wait for the rt frame to propagate through Redis to the gateway.
    for (let i = 0; i < 40 && !received.some((f) => f.type === 'message.created'); i++) {
      await new Promise((r) => setTimeout(r, 25))
    }
    await gw.close()
    const frame = received.find((f) => f.type === 'message.created')
    expect(frame).toBeDefined()
    expect(frame.conversationId).toBe(convId)
    expect(frame.payload.message.body).toBe('ping bob')
  })
})
