// EasyPost orchestration — metric→imperial parcel conversion, cheapest-rate
// selection, the buy-label flow (per package → archive → persist → publish),
// and validation guards. All I/O (EasyPost lib, S3, repos, redis) is mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../lib/db.js', () => ({
  pool: {},
  withTenantTransaction: vi.fn(async (_p, _a, _t, _s, fn) => fn({})),
}))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))

vi.mock('../lib/easypost.js', () => ({
  createShipment: vi.fn(),
  buyShipment: vi.fn(),
  downloadLabel: vi.fn(),
  createPickup: vi.fn(),
  buyPickup: vi.fn(),
  cancelPickup: vi.fn(),
}))
vi.mock('../lib/storage.js', () => ({ archiveLabel: vi.fn() }))

vi.mock('../repositories/shipping.repository.js', () => ({
  findShipmentById: vi.fn(),
  listPackages: vi.fn(),
  updateShipmentFulfillment: vi.fn(),
  updatePackageLabel: vi.fn(),
  updateShipmentStatus: vi.fn(),
  insertShipmentEvent: vi.fn(),
}))
vi.mock('../repositories/addresses.repository.js', () => ({
  findAddressById: vi.fn(),
  findDefaultOrigin: vi.fn(),
}))
vi.mock('../repositories/pickups.repository.js', () => ({ insertPickup: vi.fn() }))
// addresses.service only contributes toEpAddress here — keep a faithful shape.
vi.mock('../services/addresses.service.js', () => ({
  toEpAddress: (row) => ({ street1: row.street1, city: row.city, country: row.country }),
}))

import { rateShop, buyLabel } from '../services/easypost.service.js'
import * as repo from '../repositories/shipping.repository.js'
import * as easypost from '../lib/easypost.js'
import * as storage from '../lib/storage.js'
import { publish } from '../lib/redis.js'

const ctx = { appId: 'shop', tenantId: '22222222-2222-2222-2222-222222222222', subTenantId: null }
const INLINE = { street1: '1 A St', city: 'NYC', country: 'US' }

beforeEach(() => vi.clearAllMocks())

describe('rateShop', () => {
  it('converts grams→oz and mm→inches, returns rates sorted by price', async () => {
    easypost.createShipment.mockResolvedValue({
      id: 'shp_1',
      rates: [
        { id: 'r2', carrier: 'UPS',  service: 'Ground',   rate: '12.50', currency: 'USD', delivery_days: 3 },
        { id: 'r1', carrier: 'USPS', service: 'Priority', rate: '8.00',  currency: 'USD', delivery_days: 2 },
      ],
    })
    const out = await rateShop(ctx, { to: INLINE, from: INLINE, parcel: { weightG: 1000, lengthMm: 254 } })

    const arg = easypost.createShipment.mock.calls[0][0]
    expect(arg.parcel.weight).toBeCloseTo(35.27, 1)   // 1000g / 28.3495
    expect(arg.parcel.length).toBeCloseTo(10, 2)       // 254mm / 25.4
    expect(out.easypost_shipment_id).toBe('shp_1')
    expect(out.rates.map((r) => r.rate_cents)).toEqual([800, 1250])
    expect(out.rates[0]).toMatchObject({ carrier: 'USPS', easypost_rate_id: 'r1' })
  })

  it('throws when parcel weight is missing', async () => {
    await expect(rateShop(ctx, { to: INLINE, from: INLINE, parcel: {} }))
      .rejects.toMatchObject({ name: 'ValidationError' })
    expect(easypost.createShipment).not.toHaveBeenCalled()
  })

  it('throws when no destination is provided', async () => {
    await expect(rateShop(ctx, { from: INLINE, parcel: { weightG: 500 } }))
      .rejects.toMatchObject({ name: 'ValidationError' })
  })
})

describe('buyLabel', () => {
  const shipment = {
    id: 'shp', order_id: 'ord', from_address_id: null, to_address_id: null,
    signature_required: false, insurance_amount_cents: null,
  }
  const pkg = { id: 'pkg1', package_number: 1, weight_grams: 1000, length_mm: null, width_mm: null, height_mm: null }

  function happyMocks() {
    repo.findShipmentById.mockResolvedValue(shipment)
    repo.listPackages.mockResolvedValue([pkg])
    repo.updateShipmentFulfillment.mockResolvedValue(shipment)
    repo.updatePackageLabel.mockResolvedValue({})
    repo.updateShipmentStatus.mockResolvedValue({ ...shipment, status: 'in_transit' })
    repo.insertShipmentEvent.mockResolvedValue({})
    easypost.createShipment.mockResolvedValue({
      id: 'shp_ep',
      rates: [
        { id: 'rB', carrier: 'UPS',  service: 'Ground',   rate: '12.50', currency: 'USD' },
        { id: 'rA', carrier: 'USPS', service: 'Priority', rate: '8.00',  currency: 'USD' },
      ],
    })
    easypost.buyShipment.mockResolvedValue({
      tracking_code: '1ZTRACK',
      tracker: { public_url: 'https://track/1ZTRACK' },
      postage_label: { label_url: 'https://ep/label.pdf' },
      selected_rate: { carrier: 'USPS', service: 'Priority', rate: '8.00', currency: 'USD' },
    })
    easypost.downloadLabel.mockResolvedValue({ buf: Buffer.from('PDF'), contentType: 'application/pdf' })
    storage.archiveLabel.mockResolvedValue('labels/shop/t/pkg1.pdf')
  }

  it('buys the cheapest rate, archives the label, persists, and publishes events', async () => {
    happyMocks()
    const res = await buyLabel(ctx, 'shp', { to: INLINE, from: INLINE })

    // cheapest of 8.00 vs 12.50 → USPS rate rA
    expect(easypost.buyShipment).toHaveBeenCalledWith('shp_ep', 'rA', undefined)
    expect(storage.archiveLabel).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'pkg1' }))
    expect(repo.updatePackageLabel).toHaveBeenCalledWith({}, ctx.appId, ctx.tenantId, 'pkg1',
      expect.objectContaining({ carrier: 'USPS', trackingCode: '1ZTRACK', labelS3Key: 'labels/shop/t/pkg1.pdf', status: 'in_transit' }))
    expect(repo.updateShipmentStatus).toHaveBeenCalledWith({}, ctx.appId, ctx.tenantId, 'shp', 'in_transit', expect.any(Object))

    const events = publish.mock.calls.map((c) => c[0].type)
    expect(events).toContain('shipping.label.purchased')
    expect(events).toContain('shipping.shipment.shipped')
    expect(res.packages[0]).toMatchObject({ carrier: 'USPS', trackingCode: '1ZTRACK', rateCents: 800 })
  })

  it('honors a carrier filter when selecting the rate', async () => {
    happyMocks()
    await buyLabel(ctx, 'shp', { to: INLINE, from: INLINE, carrier: 'UPS' })
    expect(easypost.buyShipment).toHaveBeenCalledWith('shp_ep', 'rB', undefined)
  })

  it('keeps going when label archival fails (carrier URL retained)', async () => {
    happyMocks()
    storage.archiveLabel.mockRejectedValue(new Error('s3 down'))
    const res = await buyLabel(ctx, 'shp', { to: INLINE, from: INLINE })
    expect(res.packages[0].labelS3Key).toBeNull()
    expect(res.packages[0].labelUrl).toBe('https://ep/label.pdf')
  })

  it('throws when the shipment has no packages', async () => {
    repo.findShipmentById.mockResolvedValue(shipment)
    repo.listPackages.mockResolvedValue([])
    await expect(buyLabel(ctx, 'shp', { to: INLINE, from: INLINE }))
      .rejects.toMatchObject({ name: 'ValidationError' })
  })

  it('throws when the shipment is not found', async () => {
    repo.findShipmentById.mockResolvedValue(null)
    await expect(buyLabel(ctx, 'shp', { to: INLINE })).rejects.toMatchObject({ name: 'NotFoundError' })
  })
})
