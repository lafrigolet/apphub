/**
 * Integration tests for platform/scheduler — require a running Postgres + Redis.
 *
 * Exercises:
 *  - the runs audit table created by 0001_init.sql,
 *  - advisory-lock helpers against a real Postgres connection,
 *  - end-to-end of the availability-hold-purge job (seed expired hold → run → row gone),
 *  - end-to-end of dispute-sla (seed open dispute >48h → run → sla_breached_at stamped + Redis event).
 *
 * Tests use APP_ID 'int-test-sch' so cleanup never touches real tenants.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import { tryAdvisoryLock, releaseAdvisoryLock } from '../../lib/lock.js'
import * as holdPurge   from '../../jobs/availability-hold-purge.job.js'
import * as disputeSla  from '../../jobs/dispute-sla.job.js'

const APP_ID    = 'int-test-sch'
const TENANT_ID = '00000000-0000-0000-0000-0000000099a1'

let adminPool
let scheduler            // pool bound to svc_platform_scheduler
let redis

beforeAll(async () => {
  await runMigrations(process.env.MIGRATION_DATABASE_URL)
  adminPool  = new pg.Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
  scheduler  = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  redis      = new Redis(process.env.REDIS_URL)
  await adminPool.query('SELECT 1')
  await scheduler.query('SELECT 1')
  await redis.ping()
})

afterAll(async () => {
  await adminPool.end()
  await scheduler.end()
  redis.disconnect()
})

afterEach(async () => {
  await adminPool.query(`DELETE FROM platform_availability.holds      WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_disputes.disputes       WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_scheduler.runs          WHERE job_name LIKE 'int-test-%'`)
})

const noop = () => {}
const mkLogger = () => ({ info: noop, debug: noop, warn: noop, error: noop })

// ── advisory-lock smoke ───────────────────────────────────────────────
describe('advisory locks', () => {
  it('first acquirer succeeds, second fails until released', async () => {
    const c1 = await scheduler.connect()
    const c2 = await scheduler.connect()
    try {
      expect(await tryAdvisoryLock(c1, 'int-test-lock')).toBe(true)
      expect(await tryAdvisoryLock(c2, 'int-test-lock')).toBe(false)
      await releaseAdvisoryLock(c1, 'int-test-lock')
      expect(await tryAdvisoryLock(c2, 'int-test-lock')).toBe(true)
      await releaseAdvisoryLock(c2, 'int-test-lock')
    } finally {
      c1.release(); c2.release()
    }
  })
})

// ── availability-hold-purge end-to-end ─────────────────────────────────
describe('availability-hold-purge', () => {
  it('deletes only expired holds for any tenant', async () => {
    // Seed via the superuser pool so RLS doesn't block insertion.
    await adminPool.query(
      `INSERT INTO platform_availability.holds
         (app_id, tenant_id, service_id, resource_id, starts_at, ends_at, expires_at)
       VALUES
         ($1, $2, gen_random_uuid(), gen_random_uuid(), now() + interval '1 hour', now() + interval '2 hours', now() - interval '1 minute'),
         ($1, $2, gen_random_uuid(), gen_random_uuid(), now() + interval '1 hour', now() + interval '2 hours', now() + interval '5 minutes')`,
      [APP_ID, TENANT_ID],
    )
    const r = await holdPurge.run({ db: scheduler, logger: mkLogger() })
    expect(r.rowsAffected).toBeGreaterThanOrEqual(1)

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS c FROM platform_availability.holds
       WHERE app_id = $1 AND expires_at <= now()`, [APP_ID],
    )
    expect(rows[0].c).toBe(0)

    const { rows: surviving } = await adminPool.query(
      `SELECT count(*)::int AS c FROM platform_availability.holds
       WHERE app_id = $1`, [APP_ID],
    )
    expect(surviving[0].c).toBe(1)
  })
})

// ── dispute-sla end-to-end with a real Redis listener ─────────────────
describe('dispute-sla', () => {
  it('stamps sla_breached_at and publishes dispute.sla_breached', async () => {
    // Seed an 'open' dispute opened > 48h ago, with no vendor message.
    const disputeId = uuidv4()
    const orderId   = uuidv4()
    await adminPool.query(
      `INSERT INTO platform_disputes.disputes
         (id, app_id, tenant_id, order_id, buyer_user_id, reason, status, created_at)
       VALUES ($1, $2, $3, $4, gen_random_uuid(), 'not_received', 'open', now() - interval '49 hours')`,
      [disputeId, APP_ID, TENANT_ID, orderId],
    )

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((r) => setTimeout(r, 50))

    try {
      const publish = async (event) => {
        // Mimic the SDK's publisher to platform.events.
        await new Promise((res) => setImmediate(res))
        const pub = new Redis(process.env.REDIS_URL)
        await pub.publish('platform.events', JSON.stringify(event))
        pub.disconnect()
      }
      const r = await disputeSla.run({ db: scheduler, publish, logger: mkLogger() })
      expect(r.rowsAffected).toBeGreaterThanOrEqual(1)

      // sla_breached_at should now be non-NULL.
      const { rows } = await adminPool.query(
        `SELECT sla_breached_at FROM platform_disputes.disputes WHERE id = $1`,
        [disputeId],
      )
      expect(rows[0].sla_breached_at).toBeTruthy()

      // Wait for the event to round-trip.
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'dispute.sla_breached' && e.payload.disputeId === disputeId)) {
        await new Promise((res) => setTimeout(res, 50))
      }
      const evt = events.find((e) => e.type === 'dispute.sla_breached' && e.payload.disputeId === disputeId)
      expect(evt).toBeTruthy()
      expect(evt.payload.slaHours).toBe(48)
    } finally {
      sub.disconnect()
    }
  })

  it('idempotent: second run does not re-emit', async () => {
    const disputeId = uuidv4()
    await adminPool.query(
      `INSERT INTO platform_disputes.disputes
         (id, app_id, tenant_id, order_id, buyer_user_id, reason, status, created_at)
       VALUES ($1, $2, $3, gen_random_uuid(), gen_random_uuid(), 'not_received', 'open', now() - interval '49 hours')`,
      [disputeId, APP_ID, TENANT_ID],
    )

    const publish = async () => {}
    const r1 = await disputeSla.run({ db: scheduler, publish, logger: mkLogger() })
    const r2 = await disputeSla.run({ db: scheduler, publish, logger: mkLogger() })
    expect(r1.rowsAffected).toBeGreaterThanOrEqual(1)
    expect(r2.rowsAffected).toBe(0)
  })
})
