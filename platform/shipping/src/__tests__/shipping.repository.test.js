// shipping.repository — cubre shipments, eventos, packages y webhook events
// (zones/rates ya cubiertos por rate-quote.test.js). Mock client.query.
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/shipping.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'shop'
const TEN = 't1'

describe('listZones', () => {
  it('scope + ORDER BY name', async () => {
    const c = mockClient([{ id: 'z1' }])
    const r = await repo.listZones(c, APP, TEN)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/FROM platform_shipping\.shipping_zones/)
    expect(sql).toMatch(/ORDER BY name/)
    expect(params).toEqual([APP, TEN])
    expect(r).toEqual([{ id: 'z1' }])
  })
})

describe('insertShipment', () => {
  it('defaults: status pending, signatureRequired FALSE, metadata', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.insertShipment(c, APP, TEN, { orderId: 'o1' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_shipping\.shipments/)
    expect(params[2]).toBe('o1')
    expect(params[3]).toBeNull()      // carrier
    expect(params[5]).toBe('pending') // status default
    expect(params[7]).toEqual({})     // metadata default
    expect(params[10]).toBe(false)    // signatureRequired default
  })

  it('respeta valores explícitos', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.insertShipment(c, APP, TEN, {
      orderId: 'o1', carrier: 'ups', trackingCode: 'TC', status: 'shipped',
      rateId: 'r1', metadata: { k: 1 }, insuranceAmountCents: 500,
      insuranceCurrency: 'EUR', signatureRequired: true,
    })
    expect(c.query.mock.calls[0][1]).toEqual([
      APP, TEN, 'o1', 'ups', 'TC', 'shipped', 'r1', { k: 1 }, 500, 'EUR', true,
    ])
  })
})

describe('findShipmentById / findShipmentsByOrderId', () => {
  it('findShipmentById null cuando no existe', async () => {
    const c = mockClient([])
    expect(await repo.findShipmentById(c, APP, TEN, 's9')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 's9'])
  })
  it('findShipmentById devuelve fila', async () => {
    const c = mockClient([{ id: 's1' }])
    expect(await repo.findShipmentById(c, APP, TEN, 's1')).toEqual({ id: 's1' })
  })
  it('findShipmentsByOrderId devuelve array', async () => {
    const c = mockClient([{ id: 's1' }, { id: 's2' }])
    const r = await repo.findShipmentsByOrderId(c, APP, TEN, 'o1')
    expect(r).toHaveLength(2)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/order_id=\$3/)
    expect(params).toEqual([APP, TEN, 'o1'])
  })
})

describe('updateShipmentStatus', () => {
  it('solo status', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.updateShipmentStatus(c, APP, TEN, 's1', 'delivered')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status = \$4/)
    expect(params).toEqual([APP, TEN, 's1', 'delivered'])
  })

  it('con extras shippedAt/deliveredAt/trackingCode/carrier', async () => {
    const c = mockClient([{ id: 's1' }])
    await repo.updateShipmentStatus(c, APP, TEN, 's1', 'in_transit', {
      shippedAt: 'sa', deliveredAt: 'da', trackingCode: 'TC', carrier: 'ups',
    })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/shipped_at = \$5/)
    expect(sql).toMatch(/delivered_at = \$6/)
    expect(sql).toMatch(/tracking_code = \$7/)
    expect(sql).toMatch(/carrier = \$8/)
    expect(params).toEqual([APP, TEN, 's1', 'in_transit', 'sa', 'da', 'TC', 'ups'])
  })

  it('null cuando no devuelve fila', async () => {
    const c = mockClient([])
    expect(await repo.updateShipmentStatus(c, APP, TEN, 's1', 'x')).toBeNull()
  })
})

describe('shipment events', () => {
  it('insertShipmentEvent defaults null', async () => {
    const c = mockClient([{ id: 'e1' }])
    await repo.insertShipmentEvent(c, APP, TEN, 's1', { code: 'shipped' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_shipping\.shipment_events/)
    expect(params).toEqual([APP, TEN, 's1', 'shipped', null, null])
  })
  it('insertShipmentEvent con description/location', async () => {
    const c = mockClient([{ id: 'e1' }])
    await repo.insertShipmentEvent(c, APP, TEN, 's1', { code: 'x', description: 'd', location: 'l' })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 's1', 'x', 'd', 'l'])
  })
  it('listShipmentEvents ordena por ts', async () => {
    const c = mockClient([])
    await repo.listShipmentEvents(c, APP, TEN, 's1')
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY ts ASC/)
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 's1'])
  })
})

describe('packages', () => {
  it('insertPackage defaults (status pending, metadata)', async () => {
    const c = mockClient([{ id: 'p1' }])
    await repo.insertPackage(c, APP, TEN, 's1', { packageNumber: 1 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_shipping\.shipment_packages/)
    expect(params[3]).toBe(1)
    expect(params[10]).toBe('pending')
    expect(params[11]).toEqual({})
  })
  it('insertPackage respeta todos los campos', async () => {
    const c = mockClient([{ id: 'p1' }])
    await repo.insertPackage(c, APP, TEN, 's1', {
      packageNumber: 2, carrier: 'ups', trackingCode: 'TC', weightGrams: 100,
      lengthMm: 10, widthMm: 20, heightMm: 30, status: 'shipped', metadata: { k: 1 },
    })
    expect(c.query.mock.calls[0][1]).toEqual([
      APP, TEN, 's1', 2, 'ups', 'TC', 100, 10, 20, 30, 'shipped', { k: 1 },
    ])
  })
  it('listPackages ordena por package_number', async () => {
    const c = mockClient([])
    await repo.listPackages(c, APP, TEN, 's1')
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY package_number/)
  })
  it('findPackageByTracking null cuando no existe', async () => {
    const c = mockClient([])
    expect(await repo.findPackageByTracking(c, APP, TEN, 'TC')).toBeNull()
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'TC'])
  })
  it('findPackageByTracking devuelve fila', async () => {
    const c = mockClient([{ id: 'p1' }])
    expect(await repo.findPackageByTracking(c, APP, TEN, 'TC')).toEqual({ id: 'p1' })
  })

  it('updatePackageStatus solo status', async () => {
    const c = mockClient([{ id: 'p1' }])
    await repo.updatePackageStatus(c, APP, TEN, 'p1', 'delivered')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET status = \$4/)
    expect(params).toEqual([APP, TEN, 'p1', 'delivered'])
  })
  it('updatePackageStatus con extras', async () => {
    const c = mockClient([{ id: 'p1' }])
    await repo.updatePackageStatus(c, APP, TEN, 'p1', 'in_transit', { shippedAt: 'sa', deliveredAt: 'da' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/shipped_at = \$5/)
    expect(sql).toMatch(/delivered_at = \$6/)
    expect(params).toEqual([APP, TEN, 'p1', 'in_transit', 'sa', 'da'])
  })
  it('updatePackageStatus null cuando no existe', async () => {
    const c = mockClient([])
    expect(await repo.updatePackageStatus(c, APP, TEN, 'p1', 'x')).toBeNull()
  })

  it('nextPackageNumber devuelve next', async () => {
    const c = mockClient([{ next: 3 }])
    expect(await repo.nextPackageNumber(c, APP, TEN, 's1')).toBe(3)
    expect(c.query.mock.calls[0][0]).toMatch(/MAX\(package_number\), 0\) \+ 1/)
  })
  it('nextPackageNumber default 1 cuando no hay fila', async () => {
    const c = mockClient([])
    expect(await repo.nextPackageNumber(c, APP, TEN, 's1')).toBe(1)
  })
})

describe('webhook events', () => {
  it('insertWebhookEvent ON CONFLICT DO NOTHING; defaults null', async () => {
    const c = mockClient([{ id: 'w1' }])
    await repo.insertWebhookEvent(c, { carrier: 'easypost' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/ON CONFLICT \(carrier, event_external_id\) DO NOTHING/)
    expect(params).toEqual([null, null, 'easypost', null, null, null, {}, null])
  })
  it('insertWebhookEvent con todos los campos', async () => {
    const c = mockClient([{ id: 'w1' }])
    await repo.insertWebhookEvent(c, {
      appId: APP, tenantId: TEN, carrier: 'ups', eventExternalId: 'ext1',
      shipmentId: 's1', packageId: 'p1', payload: { k: 1 }, signatureValid: true,
    })
    expect(c.query.mock.calls[0][1]).toEqual([APP, TEN, 'ups', 'ext1', 's1', 'p1', { k: 1 }, true])
  })
  it('insertWebhookEvent null en duplicado (idempotente)', async () => {
    const c = mockClient([])
    expect(await repo.insertWebhookEvent(c, { carrier: 'ups' })).toBeNull()
  })

  it('markWebhookProcessed stampa processed_at', async () => {
    const c = mockClient([])
    await repo.markWebhookProcessed(c, 'w1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/SET processed_at = now\(\) WHERE id = \$1/)
    expect(params).toEqual(['w1'])
  })
})
