import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/delivery-dispatch.repository.js')
vi.mock('../repositories/settings.repository.js')

import * as service from '../services/delivery-dispatch.service.js'
import { withTenantTransaction, pool } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/delivery-dispatch.repository.js'
import * as settingsRepo from '../repositories/settings.repository.js'
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '@apphub/platform-sdk/errors'
import crypto from 'node:crypto'

const APP_ID    = 'resto'
const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const ZONE_ID   = 'aaaaaaaa-0000-0000-0000-000000000001'
const RIDER_ID  = '22222222-2222-2222-2222-222222222222'
const DEL_ID    = '11111111-1111-1111-1111-111111111111'
const ORDER_ID  = '33333333-3333-3333-3333-333333333333'

const ctx = { appId: APP_ID, tenantId: TENANT_ID, subTenantId: null, userId: 'u1', role: 'dispatcher' }

const SQUARE = {
  type: 'Polygon',
  coordinates: [[[-3.71, 40.40], [-3.70, 40.40], [-3.70, 40.41], [-3.71, 40.41], [-3.71, 40.40]]],
}

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
})

// ── quote ──────────────────────────────────────────────────────────────
describe('quote', () => {
  it('returns OUT_OF_ZONE when no active zone contains the point', async () => {
    repo.listActiveZones.mockResolvedValue([{ id: ZONE_ID, polygon: SQUARE, base_fee_cents: 100, per_km_cents: 50, min_order_cents: 0 }])
    const q = await service.quote(ctx, { lat: 41.0, lng: -3.0 })
    expect(q.deliverable).toBe(false)
    expect(q.reason).toBe('OUT_OF_ZONE')
    expect(q.zoneId).toBeNull()
  })

  it('computes base + per_km fee for a point inside a zone', async () => {
    repo.listActiveZones.mockResolvedValue([{ id: ZONE_ID, name: 'Centro', polygon: SQUARE, base_fee_cents: 200, per_km_cents: 100, min_order_cents: 0 }])
    const q = await service.quote(ctx, { lat: 40.405, lng: -3.705 })
    expect(q.deliverable).toBe(true)
    expect(q.zoneId).toBe(ZONE_ID)
    expect(q.feeCents).toBeGreaterThanOrEqual(200)
    expect(q.distanceKm).toBeGreaterThanOrEqual(0)
  })

  it('flags BELOW_MIN_ORDER when order total is under the minimum', async () => {
    repo.listActiveZones.mockResolvedValue([{ id: ZONE_ID, polygon: SQUARE, base_fee_cents: 100, per_km_cents: 0, min_order_cents: 1500 }])
    const q = await service.quote(ctx, { lat: 40.405, lng: -3.705, orderTotalCents: 1000 })
    expect(q.deliverable).toBe(false)
    expect(q.reason).toBe('BELOW_MIN_ORDER')
    expect(q.feeCents).toBe(100)
  })
})

// ── zone CRUD ──────────────────────────────────────────────────────────
describe('zone update/delete', () => {
  it('updateZone throws NotFound when zone missing', async () => {
    repo.findZoneById.mockResolvedValue(null)
    await expect(service.updateZone(ctx, ZONE_ID, { name: 'X' })).rejects.toThrow(NotFoundError)
  })
  it('updateZone applies patch when zone exists', async () => {
    repo.findZoneById.mockResolvedValue({ id: ZONE_ID })
    repo.updateZone.mockResolvedValue({ id: ZONE_ID, name: 'Nuevo' })
    const r = await service.updateZone(ctx, ZONE_ID, { name: 'Nuevo' })
    expect(repo.updateZone).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, ZONE_ID, { name: 'Nuevo' })
    expect(r.name).toBe('Nuevo')
  })
  it('deleteZone throws NotFound when nothing deleted', async () => {
    repo.deleteZone.mockResolvedValue(null)
    await expect(service.deleteZone(ctx, ZONE_ID)).rejects.toThrow(NotFoundError)
  })
  it('deleteZone returns id when deleted', async () => {
    repo.deleteZone.mockResolvedValue({ id: ZONE_ID })
    expect(await service.deleteZone(ctx, ZONE_ID)).toEqual({ id: ZONE_ID, deleted: true })
  })
})

// ── rider CRUD ─────────────────────────────────────────────────────────
describe('rider update/deactivate', () => {
  it('updateRider throws NotFound when missing', async () => {
    repo.findRiderById.mockResolvedValue(null)
    await expect(service.updateRider(ctx, RIDER_ID, { phone: '600' })).rejects.toThrow(NotFoundError)
  })
  it('updateRider rejects deactivated rider', async () => {
    repo.findRiderById.mockResolvedValue({ id: RIDER_ID, deleted_at: new Date() })
    await expect(service.updateRider(ctx, RIDER_ID, { phone: '600' })).rejects.toThrow(ConflictError)
  })
  it('updateRider applies patch to active rider', async () => {
    repo.findRiderById.mockResolvedValue({ id: RIDER_ID, deleted_at: null })
    repo.updateRider.mockResolvedValue({ id: RIDER_ID, phone: '600' })
    const r = await service.updateRider(ctx, RIDER_ID, { phone: '600' })
    expect(r.phone).toBe('600')
  })
  it('deactivateRider throws NotFound when already gone', async () => {
    repo.softDeleteRider.mockResolvedValue(null)
    await expect(service.deactivateRider(ctx, RIDER_ID, 'baja')).rejects.toThrow(NotFoundError)
  })
  it('deactivateRider returns the soft-deleted rider', async () => {
    repo.softDeleteRider.mockResolvedValue({ id: RIDER_ID, deleted_at: new Date(), deleted_reason: 'baja' })
    const r = await service.deactivateRider(ctx, RIDER_ID, 'baja')
    expect(r.deleted_reason).toBe('baja')
    expect(repo.softDeleteRider).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, RIDER_ID, 'baja')
  })
})

// ── carrier webhook ────────────────────────────────────────────────────
describe('handleCarrierWebhook', () => {
  const secret = 'whsec'
  const body = { appId: APP_ID, tenantId: TENANT_ID, externalRef: 'EXT-1', status: 'delivered' }
  const rawBody = JSON.stringify(body)
  const sig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  beforeEach(() => {
    pool.connect.mockResolvedValue(mockClient())
    settingsRepo.getValue.mockResolvedValue(secret)
  })

  it('rejects unknown provider', async () => {
    await expect(service.handleCarrierWebhook('fedex', { rawBody, signature: sig, body }))
      .rejects.toThrow(NotFoundError)
  })

  it('rejects when webhook secret not configured', async () => {
    settingsRepo.getValue.mockResolvedValue(null)
    await expect(service.handleCarrierWebhook('uber', { rawBody, signature: sig, body }))
      .rejects.toThrow(UnauthorizedError)
  })

  it('rejects an invalid signature', async () => {
    await expect(service.handleCarrierWebhook('uber', { rawBody, signature: 'deadbeef', body }))
      .rejects.toThrow(UnauthorizedError)
  })

  it('requires appId/tenantId/externalRef in payload', async () => {
    const b = { status: 'delivered' }
    const raw = JSON.stringify(b)
    const s = crypto.createHmac('sha256', secret).update(raw).digest('hex')
    await expect(service.handleCarrierWebhook('uber', { rawBody: raw, signature: s, body: b }))
      .rejects.toThrow(ValidationError)
  })

  it('ignores unmapped external statuses', async () => {
    const b = { ...body, status: 'noise' }
    const raw = JSON.stringify(b)
    const s = crypto.createHmac('sha256', secret).update(raw).digest('hex')
    const r = await service.handleCarrierWebhook('uber', { rawBody: raw, signature: s, body: b })
    expect(r.ignored).toBe(true)
    expect(repo.findDeliveryByExternalRef).not.toHaveBeenCalled()
  })

  it('returns matched:false when no delivery found', async () => {
    repo.findDeliveryByExternalRef.mockResolvedValue(null)
    const r = await service.handleCarrierWebhook('uber', { rawBody, signature: sig, body })
    expect(r.matched).toBe(false)
    expect(publish).not.toHaveBeenCalled()
  })

  it('auto-transitions the delivery and publishes the event', async () => {
    repo.findDeliveryByExternalRef.mockResolvedValue({ id: DEL_ID, order_id: ORDER_ID, status: 'picked_up' })
    repo.setDeliveryStatus.mockResolvedValue({ id: DEL_ID, order_id: ORDER_ID, status: 'delivered' })
    repo.insertDeliveryEvent.mockResolvedValue()
    const r = await service.handleCarrierWebhook('uber', { rawBody, signature: sig, body })
    expect(r.transitioned).toBe(true)
    expect(repo.setDeliveryStatus).toHaveBeenCalledWith(expect.anything(), APP_ID, TENANT_ID, DEL_ID, 'delivered', 'delivered_at')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'delivery.delivered',
      payload: expect.objectContaining({ deliveryId: DEL_ID, source: 'carrier_webhook' }),
    }))
  })

  it('does not transition on an illegal FSM jump', async () => {
    repo.findDeliveryByExternalRef.mockResolvedValue({ id: DEL_ID, order_id: ORDER_ID, status: 'pending' })
    const r = await service.handleCarrierWebhook('uber', { rawBody, signature: sig, body })
    expect(r.transitioned).toBe(false)
    expect(r.illegal).toEqual({ from: 'pending', to: 'delivered' })
    expect(publish).not.toHaveBeenCalled()
  })

  it('is idempotent when already in target status', async () => {
    repo.findDeliveryByExternalRef.mockResolvedValue({ id: DEL_ID, order_id: ORDER_ID, status: 'delivered' })
    const r = await service.handleCarrierWebhook('uber', { rawBody, signature: sig, body })
    expect(r.transitioned).toBe(false)
    expect(repo.setDeliveryStatus).not.toHaveBeenCalled()
  })
})
