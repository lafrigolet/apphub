// delivery-dispatch.repository — SQL shape de platform_delivery_dispatch.*.
// Valida scoping (app_id + tenant_id), defaults COALESCE, filtros opcionales,
// serialización JSON de polígonos/direcciones y proyección de columnas.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/delivery-dispatch.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'aikikan'
const TEN = 't1'

describe('insertZone', () => {
  it('INSERT con polygon serializado y defaults COALESCE', async () => {
    const c = mockClient([{ id: 'z1' }])
    const r = await repo.insertZone(c, {
      appId: APP, tenantId: TEN, name: 'Centro', polygon: { type: 'Polygon' },
      baseFeeCents: 100, perKmCents: 50, minOrderCents: 1000, isActive: false,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_delivery_dispatch\.zones/)
    expect(sql).toMatch(/COALESCE\(\$5,0\),COALESCE\(\$6,0\),COALESCE\(\$7,0\),COALESCE\(\$8,TRUE\)/)
    expect(params).toEqual([APP, TEN, 'Centro', JSON.stringify({ type: 'Polygon' }), 100, 50, 1000, false])
    expect(r).toEqual({ id: 'z1' })
  })

  it('defaults ausentes → 0/0/0/true', async () => {
    const c = mockClient([{ id: 'z1' }])
    await repo.insertZone(c, { appId: APP, tenantId: TEN, name: 'X', polygon: null })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'X', 'null', 0, 0, 0, true])
  })
})

describe('listZones', () => {
  it('scopea y ordena por name', async () => {
    const c = mockClient([{ id: 'z1' }])
    const r = await repo.listZones(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 ORDER BY name/)
    expect(params).toEqual([APP, TEN])
    expect(r).toEqual([{ id: 'z1' }])
  })
})

describe('insertRider', () => {
  it('INSERT con status default offline', async () => {
    const c = mockClient([{ id: 'r1' }])
    await repo.insertRider(c, { appId: APP, tenantId: TEN, userId: 'u1', displayName: 'Ana', phone: '600', vehicle: 'bike', status: 'available' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_delivery_dispatch\.riders/)
    expect(sql).toMatch(/COALESCE\(\$7,'offline'\)/)
    expect(params).toEqual([APP, TEN, 'u1', 'Ana', '600', 'bike', 'available'])
  })

  it('opcionales ausentes → null/offline', async () => {
    const c = mockClient([{ id: 'r1' }])
    await repo.insertRider(c, { appId: APP, tenantId: TEN, displayName: 'Ana' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, null, 'Ana', null, null, 'offline'])
  })
})

describe('listRiders', () => {
  it('sin status → solo scoping', async () => {
    const c = mockClient([])
    await repo.listRiders(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/status = /)
    expect(sql).toMatch(/ORDER BY display_name/)
    expect(params).toEqual([APP, TEN])
  })

  it('con status → filtro parametrizado', async () => {
    const c = mockClient([])
    await repo.listRiders(c, APP, TEN, { status: 'available' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$3/)
    expect(params).toEqual([APP, TEN, 'available'])
  })
})

describe('updateRiderLocation', () => {
  it('UPDATE last_lat/lng + COALESCE status; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.updateRiderLocation(c, APP, TEN, 'r1', { lat: 1.1, lng: 2.2, status: 'en_route' })).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET last_lat=\$4, last_lng=\$5, last_seen_at=now\(\), status=COALESCE\(\$6,status\)/)
    expect(params).toEqual([APP, TEN, 'r1', 1.1, 2.2, 'en_route'])
  })

  it('status ausente → null en param', async () => {
    const c = mockClient([{ id: 'r1' }])
    await repo.updateRiderLocation(c, APP, TEN, 'r1', { lat: 1, lng: 2 })
    expect(c.query.mock.calls[0][1][5]).toBeNull()
  })
})

describe('insertDelivery', () => {
  it('INSERT con direcciones serializadas y defaults', async () => {
    const c = mockClient([{ id: 'd1' }])
    await repo.insertDelivery(c, {
      appId: APP, tenantId: TEN, orderId: 'o1', carrier: 'glovo', externalRef: 'X1',
      zoneId: 'z1', pickupAddress: { line1: 'a' }, dropAddress: { line1: 'b' },
      feeCents: 300, status: 'pending', estimatedMinutes: 20,
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_delivery_dispatch\.deliveries/)
    expect(sql).toMatch(/COALESCE\(\$4,'own'\)/)
    expect(sql).toMatch(/COALESCE\(\$10,'pending'\)/)
    expect(params).toEqual([
      APP, TEN, 'o1', 'glovo', 'X1', 'z1',
      JSON.stringify({ line1: 'a' }), JSON.stringify({ line1: 'b' }), 300, 'pending', 20,
    ])
  })

  it('defaults: carrier own, pickup null serializado, fee 0, status pending', async () => {
    const c = mockClient([{ id: 'd1' }])
    await repo.insertDelivery(c, { appId: APP, tenantId: TEN, orderId: 'o1', dropAddress: { line1: 'b' } })
    const params = c.query.mock.calls[0][1]
    expect(params[3]).toBe('own')
    expect(params[6]).toBe('null') // pickup serialized null
    expect(params[8]).toBe(0)
    expect(params[9]).toBe('pending')
    expect(params[10]).toBeNull()
  })
})

describe('findDeliveryById', () => {
  it('scopea por id; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.findDeliveryById(c, APP, TEN, 'd9')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, 'd9'])
  })

  it('devuelve la fila cuando existe', async () => {
    const c = mockClient([{ id: 'd1' }])
    expect(await repo.findDeliveryById(c, APP, TEN, 'd1')).toEqual({ id: 'd1' })
  })
})

describe('listDeliveries', () => {
  it('sin filtros → scoping + limit default', async () => {
    const c = mockClient([])
    await repo.listDeliveries(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ORDER BY created_at DESC LIMIT \$3/)
    expect(params).toEqual([APP, TEN, 100])
  })

  it('status + riderId → ambos filtros y limit al final', async () => {
    const c = mockClient([])
    await repo.listDeliveries(c, APP, TEN, { status: 'dispatched', riderId: 'r1', limit: 10 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status = \$3/)
    expect(sql).toMatch(/rider_id = \$4/)
    expect(sql).toMatch(/LIMIT \$5/)
    expect(params).toEqual([APP, TEN, 'dispatched', 'r1', 10])
  })
})

describe('assignRider', () => {
  it('UPDATE rider_id + status dispatched; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.assignRider(c, APP, TEN, 'd1', 'r1')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET rider_id=\$4, status='dispatched', dispatched_at=now\(\)/)
    expect(params).toEqual([APP, TEN, 'd1', 'r1'])
  })

  it('devuelve la fila actualizada', async () => {
    const c = mockClient([{ id: 'd1', status: 'dispatched' }])
    expect(await repo.assignRider(c, APP, TEN, 'd1', 'r1')).toEqual({ id: 'd1', status: 'dispatched' })
  })
})

describe('setDeliveryStatus', () => {
  it('con tsCol → stampa timestamp; sin row → null', async () => {
    const c = mockClient([])
    expect(await repo.setDeliveryStatus(c, APP, TEN, 'd1', 'delivered', 'delivered_at')).toBeNull()
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/status=\$4, delivered_at=now\(\), updated_at=now\(\)/)
    expect(params).toEqual([APP, TEN, 'd1', 'delivered'])
  })

  it('sin tsCol → solo status + updated_at', async () => {
    const c = mockClient([{ id: 'd1' }])
    await repo.setDeliveryStatus(c, APP, TEN, 'd1', 'cancelled', undefined)
    const sql = c.query.mock.calls[0][0]
    expect(sql).toMatch(/status=\$4, updated_at=now\(\)/)
    expect(sql).not.toMatch(/_at=now\(\), updated_at/)
  })
})

describe('insertDeliveryEvent', () => {
  it('INSERT con payload serializado y default {}', async () => {
    const c = mockClient([])
    await repo.insertDeliveryEvent(c, { appId: APP, tenantId: TEN, deliveryId: 'd1', eventType: 'picked_up', lat: 1, lng: 2, payload: { k: 'v' } })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_delivery_dispatch\.delivery_events/)
    expect(sql).toMatch(/COALESCE\(\$7,'\{\}'::jsonb\)/)
    expect(params).toEqual([APP, TEN, 'd1', 'picked_up', 1, 2, JSON.stringify({ k: 'v' })])
  })

  it('lat/lng/payload ausentes → null/null/{}', async () => {
    const c = mockClient([])
    await repo.insertDeliveryEvent(c, { appId: APP, tenantId: TEN, deliveryId: 'd1', eventType: 'cancelled' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'd1', 'cancelled', null, null, '{}'])
  })
})

describe('listDeliveryEvents', () => {
  it('SELECT ordenado por ts ASC scopeado', async () => {
    const c = mockClient([{ id: 'e1' }])
    const r = await repo.listDeliveryEvents(c, APP, TEN, 'd1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_delivery_dispatch\.delivery_events/)
    expect(sql).toMatch(/ORDER BY ts ASC/)
    expect(params).toEqual([APP, TEN, 'd1'])
    expect(r).toEqual([{ id: 'e1' }])
  })
})
