/**
 * Integration tests for platform/messaging — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-messaging test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createThread, listThreads, getThread, postMessage, listMessages, markRead,
} from '../../services/messaging.service.js'
import { ForbiddenError, NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-msg'
const TENANT_ID = '00000000-0000-0000-0000-0000000001d1'

let adminPool, redis

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  redis = new Redis(process.env.REDIS_URL)
  await adminPool.query('SELECT 1')
  await redis.ping()
})

afterAll(async () => {
  await adminPool.end()
  redis.disconnect()
})

afterEach(async () => {
  await adminPool.query(`DELETE FROM platform_messaging.messages WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_messaging.threads  WHERE app_id = $1`, [APP_ID])
})

const buyerId  = '11111111-1111-1111-1111-111111111111'
const vendorId = '22222222-2222-2222-2222-222222222222'
const otherId  = '99999999-9999-9999-9999-999999999999'
const baseCtx  = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null }
const buyer  = { ...baseCtx, userId: buyerId,  role: 'buyer' }
const vendor = { ...baseCtx, userId: vendorId, role: 'vendor' }
const staff  = { ...baseCtx, userId: 'staff1', role: 'staff' }
const other  = { ...baseCtx, userId: otherId,  role: 'buyer' }

describe('thread creation + listing', () => {
  it('creates a thread between buyer and vendor', async () => {
    const t = await createThread(buyer, { buyerUserId: buyerId, vendorUserId: vendorId, orderId: uuidv4(), subject: 'Issue' })
    expect(t.app_id).toBe(APP_ID)
    expect(t.buyer_user_id).toBe(buyerId)
    expect(t.vendor_user_id).toBe(vendorId)
  })

  it('listThreads(buyer) returns buyer threads only', async () => {
    await createThread(buyer, { buyerUserId: buyerId,  vendorUserId: vendorId })
    await createThread(buyer, { buyerUserId: otherId,  vendorUserId: vendorId })
    const buyerThreads = await listThreads(buyer, 'buyer')
    expect(buyerThreads.every((t) => t.buyer_user_id === buyerId)).toBe(true)
  })

  it('listThreads(vendor) lists vendor threads', async () => {
    await createThread(buyer, { buyerUserId: buyerId, vendorUserId: vendorId })
    const vendorThreads = await listThreads(vendor, 'vendor')
    expect(vendorThreads.every((t) => t.vendor_user_id === vendorId)).toBe(true)
  })
})

describe('access control', () => {
  it('buyer/vendor can read; staff can read; outsider cannot', async () => {
    const t = await createThread(buyer, { buyerUserId: buyerId, vendorUserId: vendorId })
    await expect(getThread(buyer,  t.id)).resolves.toBeTruthy()
    await expect(getThread(vendor, t.id)).resolves.toBeTruthy()
    await expect(getThread(staff,  t.id)).resolves.toBeTruthy()
    await expect(getThread(other,  t.id)).rejects.toThrow(ForbiddenError)
  })

  it('getThread on unknown id throws NotFoundError', async () => {
    await expect(getThread(buyer, uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('postMessage / listMessages / markRead', () => {
  it('persists message and bumps thread last_message_at', async () => {
    const t = await createThread(buyer, { buyerUserId: buyerId, vendorUserId: vendorId })
    const m = await postMessage(buyer, t.id, 'hi', [])
    expect(m.body).toBe('hi')

    const list = await listMessages(buyer, t.id, {})
    expect(list).toHaveLength(1)

    const { rows } = await adminPool.query(
      `SELECT last_message_at FROM platform_messaging.threads WHERE id=$1`, [t.id],
    )
    expect(rows[0].last_message_at).toBeTruthy()
  })

  it('publishes message.created with correct recipient', async () => {
    const t = await createThread(buyer, { buyerUserId: buyerId, vendorUserId: vendorId, orderId: uuidv4() })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      await postMessage(buyer, t.id, 'hi vendor')
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'message.created')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      const evt = events.find((e) => e.type === 'message.created' && e.payload.threadId === t.id)
      expect(evt).toBeTruthy()
      expect(evt.payload.senderUserId).toBe(buyerId)
      expect(evt.payload.recipientUserId).toBe(vendorId)
    } finally {
      sub.disconnect()
    }
  })

  it('rejects post / list from non-participant', async () => {
    const t = await createThread(buyer, { buyerUserId: buyerId, vendorUserId: vendorId })
    await expect(postMessage(other, t.id, 'sneaky')).rejects.toThrow(ForbiddenError)
    await expect(listMessages(other, t.id, {})).rejects.toThrow(ForbiddenError)
  })

  it('markRead persists read_at; subsequent list shows read message', async () => {
    const t = await createThread(buyer, { buyerUserId: buyerId, vendorUserId: vendorId })
    const m = await postMessage(buyer, t.id, 'hi')
    await markRead(vendor, t.id, m.id)

    const list = await listMessages(vendor, t.id, {})
    expect(list[0].read_at).toBeTruthy()
  })

  it('markRead on unknown message throws NotFoundError', async () => {
    const t = await createThread(buyer, { buyerUserId: buyerId, vendorUserId: vendorId })
    await expect(markRead(buyer, t.id, uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('tenant isolation', () => {
  it('threads from another tenant are not visible', async () => {
    const T2 = '00000000-0000-0000-0000-0000000001d2'
    await createThread(buyer, { buyerUserId: buyerId, vendorUserId: vendorId })
    await createThread({ ...buyer, tenantId: T2 }, { buyerUserId: buyerId, vendorUserId: vendorId })
    const own = await listThreads(buyer, 'buyer')
    expect(own.every((t) => t.tenant_id === TENANT_ID)).toBe(true)
    await adminPool.query(`DELETE FROM platform_messaging.messages WHERE app_id=$1 AND tenant_id=$2`, [APP_ID, T2])
    await adminPool.query(`DELETE FROM platform_messaging.threads  WHERE app_id=$1 AND tenant_id=$2`, [APP_ID, T2])
  })
})
