/**
 * Integration tests for platform/resources — require Postgres + Redis.
 * Start dependencies:  docker compose up postgres redis -d
 * Run:                 pnpm --filter @apphub/platform-resources test:integration
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import pg from 'pg'
import Redis from 'ioredis'
import { v4 as uuidv4 } from 'uuid'

import { runMigrations } from '../../lib/migrate.js'
import {
  createResource, getResource, listResources, listResourcesForService,
  attachService, detachService,
  setWorkHour, listWorkHours, deleteWorkHour,
  createException, listExceptions,
} from '../../services/resources.service.js'
import { NotFoundError } from '../../utils/errors.js'

const APP_ID    = 'int-test-res'
const TENANT_ID = '00000000-0000-0000-0000-0000000002b1'

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
  await adminPool.query(`DELETE FROM platform_resources.exceptions        WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_resources.work_hours        WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_resources.resource_services WHERE app_id = $1`, [APP_ID])
  await adminPool.query(`DELETE FROM platform_resources.resources         WHERE app_id = $1`, [APP_ID])
})

const ctx = (overrides = {}) => ({
  appId: APP_ID, tenantId: TENANT_ID, subTenantId: null,
  userId: '11111111-1111-1111-1111-111111111111', role: 'admin', ...overrides,
})

describe('resources', () => {
  it('creates and lists resources', async () => {
    const a = await createResource(ctx(), { kind: 'practitioner', displayName: 'Dr. Ana' })
    await createResource(ctx(), { kind: 'room', displayName: 'Sala 1' })
    const list = await listResources(ctx(), {})
    expect(list.find((r) => r.id === a.id)).toBeTruthy()
    const onlyPract = await listResources(ctx(), { kind: 'practitioner' })
    expect(onlyPract.every((r) => r.kind === 'practitioner')).toBe(true)
  })

  it('getResource returns services + workHours', async () => {
    const r = await createResource(ctx(), { kind: 'practitioner', displayName: 'Dr. X' })
    const sid = uuidv4()
    await attachService(ctx(), r.id, sid)
    await setWorkHour(ctx(), { resourceId: r.id, dayOfWeek: 1, startMinute: 540, endMinute: 1080 })
    const full = await getResource(ctx(), r.id)
    expect(full.services).toContain(sid)
    expect(full.workHours).toHaveLength(1)
  })

  it('getResource throws NotFoundError', async () => {
    await expect(getResource(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('attach / detach service', () => {
  it('listResourcesForService returns only resources offering that service', async () => {
    const r1 = await createResource(ctx(), { kind: 'practitioner', displayName: 'A' })
    const r2 = await createResource(ctx(), { kind: 'practitioner', displayName: 'B' })
    const sid = uuidv4()
    await attachService(ctx(), r1.id, sid)
    const list = await listResourcesForService(ctx(), sid)
    expect(list.map((r) => r.id)).toContain(r1.id)
    expect(list.map((r) => r.id)).not.toContain(r2.id)
  })

  it('attach is idempotent (no error on duplicate)', async () => {
    const r = await createResource(ctx(), { kind: 'practitioner', displayName: 'A' })
    const sid = uuidv4()
    await attachService(ctx(), r.id, sid)
    await expect(attachService(ctx(), r.id, sid)).resolves.toBeUndefined()
  })

  it('detach removes the link', async () => {
    const r = await createResource(ctx(), { kind: 'practitioner', displayName: 'A' })
    const sid = uuidv4()
    await attachService(ctx(), r.id, sid)
    await detachService(ctx(), r.id, sid)
    const list = await listResourcesForService(ctx(), sid)
    expect(list.find((x) => x.id === r.id)).toBeFalsy()
  })
})

describe('work hours', () => {
  it('inserts, lists, deletes', async () => {
    const r = await createResource(ctx(), { kind: 'practitioner', displayName: 'A' })
    const w1 = await setWorkHour(ctx(), { resourceId: r.id, dayOfWeek: 1, startMinute: 540, endMinute: 720 })
    await setWorkHour(ctx(), { resourceId: r.id, dayOfWeek: 1, startMinute: 900, endMinute: 1080 })
    const all = await listWorkHours(ctx(), r.id)
    expect(all).toHaveLength(2)
    await deleteWorkHour(ctx(), w1.id)
    const after = await listWorkHours(ctx(), r.id)
    expect(after).toHaveLength(1)
  })

  it('deleteWorkHour throws NotFoundError when missing', async () => {
    await expect(deleteWorkHour(ctx(), uuidv4())).rejects.toThrow(NotFoundError)
  })
})

describe('exceptions', () => {
  it('persists and emits resource.unavailable', async () => {
    const r = await createResource(ctx(), { kind: 'practitioner', displayName: 'A' })

    const sub = new Redis(process.env.REDIS_URL)
    const events = []
    await sub.subscribe('platform.events')
    sub.on('message', (_c, raw) => { try { events.push(JSON.parse(raw)) } catch {} })
    await new Promise((rs) => setTimeout(rs, 50))

    try {
      await createException(ctx(), {
        resourceId: r.id,
        startsAt: '2026-05-01T08:00:00Z',
        endsAt:   '2026-05-08T08:00:00Z',
        kind: 'vacation',
      })
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && !events.some((e) => e.type === 'resource.unavailable')) {
        await new Promise((rs) => setTimeout(rs, 50))
      }
      const evt = events.find((e) => e.type === 'resource.unavailable' && e.payload.resourceId === r.id)
      expect(evt).toBeTruthy()
      expect(evt.payload.kind).toBe('vacation')
    } finally {
      sub.disconnect()
    }
  })

  it('listExceptions filters by from/to window', async () => {
    const r = await createResource(ctx(), { kind: 'practitioner', displayName: 'A' })
    await createException(ctx(), { resourceId: r.id, startsAt: '2026-05-01T00:00:00Z', endsAt: '2026-05-02T00:00:00Z', kind: 'vacation' })
    await createException(ctx(), { resourceId: r.id, startsAt: '2026-06-01T00:00:00Z', endsAt: '2026-06-02T00:00:00Z', kind: 'vacation' })
    const may = await listExceptions(ctx(), r.id, { from: '2026-05-01T00:00:00Z', to: '2026-05-31T00:00:00Z' })
    expect(may).toHaveLength(1)
  })
})

describe('tenant isolation', () => {
  it('listResources only returns rows for the calling tenant', async () => {
    const T2 = '00000000-0000-0000-0000-0000000002b2'
    await createResource(ctx(), { kind: 'practitioner', displayName: 'mine' })
    await createResource(ctx({ tenantId: T2 }), { kind: 'practitioner', displayName: 'other' })
    const own = await listResources(ctx(), {})
    expect(own.every((r) => r.tenant_id === TENANT_ID)).toBe(true)
    await adminPool.query(`DELETE FROM platform_resources.resources WHERE app_id=$1 AND tenant_id=$2`, [APP_ID, T2])
  })
})
