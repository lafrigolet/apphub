// availability.repository — SQL-shape de platform_availability (holds) +
// lecturas cross-schema (services/resources/bookings). Verifica tablas,
// scoping (app_id/tenant_id), y params.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as repo from '../repositories/availability.repository.js'

function mockClient(rows = [], rowCount = rows.length) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount }) }
}

const APP = 'yoga'
const TENANT = 't1'
const SVC = 'svc1'
const RES = 'res1'
const FROM = '2026-06-01T00:00:00.000Z'
const TO = '2026-06-02T00:00:00.000Z'

beforeEach(() => vi.clearAllMocks())

describe('getServiceById', () => {
  it('SELECT desde platform_services.services; row + null', async () => {
    const c = mockClient([{ id: SVC }])
    const r = await repo.getServiceById(c, APP, TENANT, SVC)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_services\.services/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, SVC])
    expect(r).toEqual({ id: SVC })
    const c2 = mockClient([])
    expect(await repo.getServiceById(c2, APP, TENANT, SVC)).toBeNull()
  })
})

describe('getResourcesForService', () => {
  it('JOIN resource_services; is_active=TRUE; ORDER BY display_name', async () => {
    const c = mockClient([{ id: RES }])
    const r = await repo.getResourcesForService(c, APP, TENANT, SVC)
    expect(c.query.mock.calls[0][0]).toMatch(/JOIN platform_resources\.resource_services/)
    expect(c.query.mock.calls[0][0]).toMatch(/r\.is_active = TRUE/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, SVC])
    expect(r).toEqual([{ id: RES }])
  })
})

describe('getWorkHours', () => {
  it('SELECT desde work_hours scoped por resource', async () => {
    const c = mockClient([{ day_of_week: 1 }])
    const r = await repo.getWorkHours(c, APP, TENANT, RES)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_resources\.work_hours/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, RES])
    expect(r).toEqual([{ day_of_week: 1 }])
  })
})

describe('getExceptions', () => {
  it('rango ends_at>$4 AND starts_at<$5', async () => {
    const c = mockClient([])
    await repo.getExceptions(c, APP, TENANT, RES, FROM, TO)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_resources\.exceptions/)
    expect(c.query.mock.calls[0][0]).toMatch(/ends_at > \$4\s+AND starts_at < \$5/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, RES, FROM, TO])
  })
})

describe('getBusyBookings', () => {
  it('JOIN booking_resources; excluye estados terminales', async () => {
    const c = mockClient([{ starts_at: FROM }])
    const r = await repo.getBusyBookings(c, APP, TENANT, RES, FROM, TO)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_bookings\.bookings b/)
    expect(c.query.mock.calls[0][0]).toMatch(/NOT IN \('cancelled','no_show','rescheduled','completed'\)/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, RES, FROM, TO])
    expect(r).toEqual([{ starts_at: FROM }])
  })
})

describe('getActiveHolds', () => {
  it('holds con expires_at>now() y solapamiento de rango', async () => {
    const c = mockClient([])
    await repo.getActiveHolds(c, APP, TENANT, RES, FROM, TO)
    expect(c.query.mock.calls[0][0]).toMatch(/FROM platform_availability\.holds/)
    expect(c.query.mock.calls[0][0]).toMatch(/expires_at > now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, RES, FROM, TO])
  })
})

describe('insertHoldAtomic', () => {
  const hold = {
    resourceId: RES, startsAt: FROM, endsAt: TO, serviceId: SVC,
    clientUserId: 'u1', ttlSeconds: 600,
  }

  it('toma advisory lock por (resource_id, starts_at|ends_at) antes del INSERT', async () => {
    const c = mockClient([{ id: 'hold1' }])
    await repo.insertHoldAtomic(c, APP, TENANT, hold)
    // Primera query: el advisory lock transaccional (recomendación #6).
    const [lockSql, lockParams] = c.query.mock.calls[0]
    expect(lockSql).toMatch(/pg_advisory_xact_lock/)
    expect(lockParams).toEqual([RES, FROM, TO])
  })

  it('CTE overlapping_holds + overlapping_bookings; INSERT condicional; row', async () => {
    const c = mockClient([{ id: 'hold1' }])
    const r = await repo.insertHoldAtomic(c, APP, TENANT, hold)
    // El INSERT es la segunda query (la primera es el advisory lock).
    const [sql, params] = c.query.mock.calls[1]
    expect(sql).toMatch(/WITH overlapping_holds AS/)
    expect(sql).toMatch(/INSERT INTO platform_availability\.holds/)
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM overlapping_holds\)/)
    expect(params).toEqual([APP, TENANT, RES, FROM, TO, SVC, 'u1', '600'])
    expect(r).toEqual({ id: 'hold1' })
  })

  it('overlap → null; defaults clientUserId null + ttl 300', async () => {
    const c = mockClient([])
    const r = await repo.insertHoldAtomic(c, APP, TENANT, {
      resourceId: RES, startsAt: FROM, endsAt: TO, serviceId: SVC,
    })
    expect(r).toBeNull()
    expect(c.query.mock.calls[1][1]).toEqual([APP, TENANT, RES, FROM, TO, SVC, null, '300'])
  })
})

describe('deleteHold', () => {
  it('DELETE scoped; rowCount>0 → true/false', async () => {
    const c = mockClient([], 1)
    expect(await repo.deleteHold(c, APP, TENANT, 'h1')).toBe(true)
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_availability\.holds/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT, 'h1'])
    const c2 = mockClient([], 0)
    expect(await repo.deleteHold(c2, APP, TENANT, 'h1')).toBe(false)
  })
})

describe('purgeExpiredHolds', () => {
  it('DELETE WHERE expires_at <= now()', async () => {
    const c = mockClient([])
    await repo.purgeExpiredHolds(c, APP, TENANT)
    expect(c.query.mock.calls[0][0]).toMatch(/expires_at <= now\(\)/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TENANT])
  })
})
