// Repo SQL shape for the new priority features: zone/rider CRUD, active-zone
// lookup, external_ref lookup. All scoped by (app_id, tenant_id).
import { describe, it, expect, vi } from 'vitest'
import * as repo from '../repositories/delivery-dispatch.repository.js'

function mockClient(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) }
}

const APP = 'resto'
const TEN = 't1'
const ID  = 'id-1'

describe('findZoneById / listActiveZones', () => {
  it('findZoneById scopes by app+tenant+id', async () => {
    const c = mockClient([{ id: ID }])
    await repo.findZoneById(c, APP, TEN, ID)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/WHERE app_id=\$1 AND tenant_id=\$2 AND id=\$3/)
    expect(params).toEqual([APP, TEN, ID])
  })
  it('listActiveZones filters is_active', async () => {
    const c = mockClient([])
    await repo.listActiveZones(c, APP, TEN)
    expect(c.query.mock.calls[0][0]).toMatch(/is_active=TRUE/)
  })
})

describe('updateZone', () => {
  it('builds SET clause for provided fields only and scopes', async () => {
    const c = mockClient([{ id: ID, name: 'X' }])
    await repo.updateZone(c, APP, TEN, ID, { name: 'X', baseFeeCents: 300 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/UPDATE platform_delivery_dispatch\.zones SET/)
    expect(sql).toMatch(/name=\$4/)
    expect(sql).toMatch(/base_fee_cents=\$5/)
    expect(params.slice(0, 3)).toEqual([APP, TEN, ID])
  })
  it('serializes polygon when present', async () => {
    const c = mockClient([{ id: ID }])
    await repo.updateZone(c, APP, TEN, ID, { polygon: { type: 'Polygon' } })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/polygon=\$4/)
    expect(params[3]).toBe(JSON.stringify({ type: 'Polygon' }))
  })
  it('returns existing row when patch is empty', async () => {
    const c = mockClient([{ id: ID }])
    await repo.updateZone(c, APP, TEN, ID, {})
    expect(c.query.mock.calls[0][0]).toMatch(/SELECT \* FROM/)
  })
})

describe('deleteZone', () => {
  it('DELETE scoped, RETURNING id', async () => {
    const c = mockClient([{ id: ID }])
    const r = await repo.deleteZone(c, APP, TEN, ID)
    expect(c.query.mock.calls[0][0]).toMatch(/DELETE FROM platform_delivery_dispatch\.zones/)
    expect(r).toEqual({ id: ID })
  })
})

describe('listRiders excludes soft-deleted', () => {
  it('adds deleted_at IS NULL by default', async () => {
    const c = mockClient([])
    await repo.listRiders(c, APP, TEN)
    expect(c.query.mock.calls[0][0]).toMatch(/deleted_at IS NULL/)
  })
  it('includeDeleted=true omits the filter', async () => {
    const c = mockClient([])
    await repo.listRiders(c, APP, TEN, { includeDeleted: true })
    expect(c.query.mock.calls[0][0]).not.toMatch(/deleted_at IS NULL/)
  })
})

describe('updateRider / softDeleteRider', () => {
  it('updateRider updates only active rows', async () => {
    const c = mockClient([{ id: ID }])
    await repo.updateRider(c, APP, TEN, ID, { phone: '600', vehicle: 'car' })
    const [sql] = c.query.mock.calls[0]
    expect(sql).toMatch(/phone=\$4/)
    expect(sql).toMatch(/vehicle=\$5/)
    expect(sql).toMatch(/deleted_at IS NULL/)
  })
  it('softDeleteRider stamps deleted_at, reason, status', async () => {
    const c = mockClient([{ id: ID }])
    await repo.softDeleteRider(c, APP, TEN, ID, 'baja')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/deleted_at=now\(\)/)
    expect(sql).toMatch(/status='offline'/)
    expect(params).toEqual([APP, TEN, ID, 'baja'])
  })
})

describe('findDeliveryByExternalRef', () => {
  it('scopes by app+tenant+carrier+external_ref', async () => {
    const c = mockClient([{ id: ID }])
    await repo.findDeliveryByExternalRef(c, APP, TEN, 'uber', 'EXT-1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/carrier=\$3 AND external_ref=\$4/)
    expect(params).toEqual([APP, TEN, 'uber', 'EXT-1'])
  })
})
