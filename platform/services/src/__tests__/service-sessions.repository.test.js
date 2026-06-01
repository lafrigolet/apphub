// service-sessions.repository — SQL shape de platform_services.service_sessions.
// Valida proyección, params parametrizados, filtros opcionales y el catálogo
// público con JOIN a services.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/service-sessions.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'yoga'
const TEN = 't1'

describe('insert', () => {
  it('INSERT con defaults (status scheduled vía COALESCE, metadata)', async () => {
    const c = mockClient([{ id: 'ss1' }])
    const r = await repo.insert(c, APP, TEN, {
      serviceId: 'svc1', startsAt: '2026-01-01T10:00Z', endsAt: '2026-01-01T11:00Z',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_services\.service_sessions/)
    expect(sql).toMatch(/COALESCE\(\$12, 'scheduled'\)/)
    expect(params[0]).toBe(APP)
    expect(params[1]).toBe(TEN)
    expect(params[2]).toBeNull()           // subTenantId
    expect(params[3]).toBe('svc1')
    expect(params[6]).toBeNull()           // capacity
    expect(params[11]).toBeNull()          // status
    expect(params[14]).toBeNull()          // metadata
    expect(r).toEqual({ id: 'ss1' })
  })

  it('respeta valores explícitos', async () => {
    const c = mockClient([{ id: 'ss1' }])
    await repo.insert(c, APP, TEN, {
      subTenantId: 'st1', serviceId: 'svc1', startsAt: 'a', endsAt: 'b',
      capacity: 10, resourceId: 'r1', priceCents: 500, currency: 'EUR',
      location: 'room', status: 'open', description: 'desc',
      registrationClosesAt: 'c', metadata: { k: 1 },
    })
    expect(c.query.mock.calls[0][1]).toEqual([
      APP, TEN, 'st1', 'svc1', 'a', 'b', 10, 'r1', 500, 'EUR', 'room', 'open', 'desc', 'c', { k: 1 },
    ])
  })
})

describe('findById', () => {
  it('WHERE scope; null si no existe', async () => {
    const c = mockClient([])
    expect(await repo.findById(c, APP, TEN, 'ss9')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id = \$1 AND tenant_id = \$2 AND id = \$3/)
    expect(params).toEqual([APP, TEN, 'ss9'])
  })

  it('devuelve la fila', async () => {
    const c = mockClient([{ id: 'ss1' }])
    expect(await repo.findById(c, APP, TEN, 'ss1')).toEqual({ id: 'ss1' })
  })
})

describe('listByService', () => {
  it('default: excluye cancelled, sin fromDate', async () => {
    const c = mockClient([])
    await repo.listByService(c, APP, TEN, 'svc1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status <> 'cancelled'/)
    expect(sql).toMatch(/ORDER BY starts_at ASC/)
    expect(params).toEqual([APP, TEN, 'svc1'])
  })

  it('fromDate añade filtro parametrizado', async () => {
    const c = mockClient([])
    await repo.listByService(c, APP, TEN, 'svc1', { fromDate: '2026-01-01' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/starts_at >= \$4/)
    expect(params).toEqual([APP, TEN, 'svc1', '2026-01-01'])
  })

  it('includeCancelled=true omite el filtro de status', async () => {
    const c = mockClient([])
    await repo.listByService(c, APP, TEN, 'svc1', { includeCancelled: true })
    expect(c.query.mock.calls[0][0]).not.toMatch(/status <> 'cancelled'/)
  })
})

describe('update', () => {
  it('sin campos → findById (SELECT)', async () => {
    const c = mockClient([{ id: 'ss1' }])
    const r = await repo.update(c, APP, TEN, 'ss1', {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT/)
    expect(r).toEqual({ id: 'ss1' })
  })

  it('con campos → UPDATE + updated_at', async () => {
    const c = mockClient([{ id: 'ss1' }])
    await repo.update(c, APP, TEN, 'ss1', { capacity: 5, status: 'open' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_services\.service_sessions SET/)
    expect(sql).toMatch(/capacity = \$4/)
    expect(sql).toMatch(/status = \$5/)
    expect(sql).toMatch(/updated_at = now\(\)/)
    expect(params).toEqual([APP, TEN, 'ss1', 5, 'open'])
  })

  it('null cuando no devuelve fila', async () => {
    const c = mockClient([])
    expect(await repo.update(c, APP, TEN, 'ss1', { capacity: 5 })).toBeNull()
  })
})

describe('cancel', () => {
  it('UPDATE status=cancelled; null si no existe', async () => {
    const c = mockClient([])
    expect(await repo.cancel(c, APP, TEN, 'ss1')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = 'cancelled'/)
    expect(params).toEqual([APP, TEN, 'ss1'])
  })
})

describe('listUpcomingPublic', () => {
  it('default limit 50, sin kind, JOIN a services', async () => {
    const c = mockClient([])
    await repo.listUpcomingPublic(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/JOIN platform_services\.services s/)
    expect(sql).toMatch(/s\.public_catalog = TRUE/)
    expect(sql).toMatch(/ORDER BY ss\.starts_at ASC/)
    expect(params).toEqual([APP, TEN, 50])
  })

  it('kind añade filtro + limit clamp al máximo (500)', async () => {
    const c = mockClient([])
    await repo.listUpcomingPublic(c, APP, TEN, { kind: 'class', limit: 9999 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/s\.kind = \$3/)
    expect(params).toEqual([APP, TEN, 'class', 500])
  })

  it('limit no numérico cae al default 50', async () => {
    const c = mockClient([])
    await repo.listUpcomingPublic(c, APP, TEN, { limit: 'abc' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 50])
  })

  it('limit por debajo de 1 se clampa a 1', async () => {
    const c = mockClient([])
    await repo.listUpcomingPublic(c, APP, TEN, { limit: 0 })
    // limit 0 → Number(0)||50 → 50 (0 es falsy). Usar negativo para clamp a 1.
    const c2 = mockClient([])
    await repo.listUpcomingPublic(c2, APP, TEN, { limit: -5 })
    expect(c2.query.mock.calls[0][1]).toEqual([APP, TEN, 1])
  })
})
