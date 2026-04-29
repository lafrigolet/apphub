/**
 * Integration tests for platform/disputes — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-disputes test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  openDispute, getDispute, listDisputes, postMessage, uploadEvidence, resolve, handleEvent,
} from '../../services/disputes.service.js'
import { ConflictError, ForbiddenError, NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-dis'
const TENANT_ID = '00000000-0000-0000-0000-0000000001f1'

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
  await adminPool.query(`DELETE FROM platform_disputes.dispute_evidence WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_disputes.dispute_messages WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_disputes.disputes         WHERE app_id = $1`, [APP_ID])
})

const buyerId  = '11111111-1111-1111-1111-111111111111'
const vendorId = '22222222-2222-2222-2222-222222222222'
const staffId  = '33333333-3333-3333-3333-333333333333'
const baseCtx  = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null }
const buyer  = { ...baseCtx, userId: buyerId,  role: 'buyer' }
const vendor = { ...baseCtx, userId: vendorId, role: 'vendor' }
const staff  = { ...baseCtx, userId: staffId,  role: 'staff' }

describe('openDispute', () => {
  it('persists, scopes, publishes dispute.opened', async () => {
    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      const orderId = uuidv4()
      const d = await openDispute(buyer, { orderId, reason: 'not_received', description: 'never arrived' })
      expect(d.status).toBe('open')
      expect(d.app_id).toBe(APP_ID)

      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'dispute.opened')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      expect(events.find((e) => e.type === 'dispute.opened' && e.payload.disputeId === d.id)).toBeTruthy()
    } finally {
      sub.disconnect()
    }
  })

  it('rejects when dispute already exists for order', async () => {
    const orderId = uuidv4()
    await openDispute(buyer, { orderId, reason: 'not_received' })
    await expect(openDispute(buyer, { orderId, reason: 'duplicate' })).rejects.toThrow(ConflictError)
  })
})

describe('messages and evidence', () => {
  it('postMessage sets senderRole correctly per actor', async () => {
    const orderId = uuidv4()
    const d = await openDispute(buyer, { orderId, reason: 'not_received' })

    const buyerMsg  = await postMessage(buyer,  d.id, 'where is it?')
    const vendorMsg = await postMessage(vendor, d.id, 'shipped on Tue')
    const staffMsg  = await postMessage(staff,  d.id, 'investigating')

    expect(buyerMsg.sender_role).toBe('buyer')
    expect(vendorMsg.sender_role).toBe('vendor')
    expect(staffMsg.sender_role).toBe('staff')

    const full = await getDispute(buyer, d.id)
    expect(full.messages).toHaveLength(3)
  })

  it('uploadEvidence persists evidence on dispute', async () => {
    const orderId = uuidv4()
    const d = await openDispute(buyer, { orderId, reason: 'not_received' })
    await uploadEvidence(buyer, d.id, 'note', { text: 'tracking link broken' })
    const full = await getDispute(buyer, d.id)
    expect(full.evidence).toHaveLength(1)
    expect(full.evidence[0].kind).toBe('note')
  })

  it('postMessage / uploadEvidence throw NotFoundError on unknown dispute', async () => {
    await expect(postMessage(buyer, uuidv4(), 'x')).rejects.toThrow(NotFoundError)
    await expect(uploadEvidence(buyer, uuidv4(), 'note', {})).rejects.toThrow(NotFoundError)
  })
})

describe('resolve — staff-only + audit', () => {
  it('rejects non-staff attempts', async () => {
    const orderId = uuidv4()
    const d = await openDispute(buyer, { orderId, reason: 'not_received' })
    await expect(resolve(buyer, d.id, { status: 'resolved_buyer' })).rejects.toThrow(ForbiddenError)
  })

  it('staff can resolve and event is published with resolution amount', async () => {
    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      const orderId = uuidv4()
      const d = await openDispute(buyer, { orderId, reason: 'not_received' })
      const updated = await resolve(staff, d.id, { status: 'resolved_buyer', resolutionAmountCents: 1500, resolutionNotes: 'refund' })
      expect(updated.status).toBe('resolved_buyer')
      expect(Number(updated.resolution_amount_cents)).toBe(1500)
      expect(updated.resolved_at).toBeTruthy()
      expect(updated.resolved_by_user_id).toBe(staffId)

      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'dispute.resolved')) {
        await new Promise((r) => setTimeout(r, 50))
      }
      const evt = events.find((e) => e.type === 'dispute.resolved' && e.payload.disputeId === d.id)
      expect(evt).toBeTruthy()
      expect(Number(evt.payload.resolutionAmountCents)).toBe(1500)
    } finally {
      sub.disconnect()
    }
  })

  it('throws NotFoundError on unknown dispute', async () => {
    await expect(resolve(staff, uuidv4(), { status: 'resolved_buyer' })).rejects.toThrow(NotFoundError)
  })
})

describe('handleEvent — splitpay.chargeback escalates', () => {
  it('escalates an existing dispute when matching chargeback arrives', async () => {
    const orderId = uuidv4()
    const d = await openDispute(buyer, { orderId, reason: 'not_received' })
    await handleEvent({
      type: 'splitpay.chargeback.created',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId },
    })
    const updated = await getDispute(buyer, d.id)
    expect(updated.status).toBe('escalated_chargeback')
  })

  it('no-ops when no matching dispute exists', async () => {
    const orderId = uuidv4()
    await handleEvent({
      type: 'splitpay.chargeback.created',
      payload: { appId: APP_ID, tenantId: TENANT_ID, orderId },
    })
    const list = await listDisputes(buyer, {})
    expect(list).toHaveLength(0)
  })
})

describe('tenant isolation', () => {
  it('disputes from another tenant are not visible', async () => {
    const T2 = '00000000-0000-0000-0000-0000000001f2'
    await openDispute(buyer, { orderId: uuidv4(), reason: 'not_received' })
    await openDispute({ ...buyer, tenantId: T2 }, { orderId: uuidv4(), reason: 'not_received' })
    const list = await listDisputes(buyer, {})
    expect(list.every((d) => d.tenant_id === TENANT_ID)).toBe(true)
    await adminPool.query(`DELETE FROM platform_disputes.disputes WHERE app_id=$1 AND tenant_id=$2`, [APP_ID, T2])
  })
})
