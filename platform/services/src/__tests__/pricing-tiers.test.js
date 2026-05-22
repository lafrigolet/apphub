// services.service — resolvePrice + quotePrice + tier CRUD.
// Foco en resolvePrice (función PURA) y su lógica de specificity:
//   1. days_of_week + minute window → más específico (specificity 3)
//   2. days_of_week solo            → specificity 2
//   3. minute window solo           → specificity 1
//   4. ninguno (row-level)          → fallback
//
// Dentro del mismo specificity: gana el span (end - start) MÁS PEQUEÑO.
// Tier con enabled=false → ignorado.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/services.repository.js')

import {
  resolvePrice, listPricingTiers, addPricingTier, removePricingTier, quotePrice,
} from '../services/services.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/services.repository.js'

const ctx = { appId: 'wellness', tenantId: 't1', subTenantId: null }
const SVC = 'svc-1'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── resolvePrice (pure) — fallback ─────────────────────────────────

describe('resolvePrice — fallback', () => {
  const service = { price_cents: 5000 }

  it('sin tiers → price_cents del row + tier=null', () => {
    const r = resolvePrice(service, [], new Date('2026-05-22T10:00:00Z'))
    expect(r).toEqual({ priceCents: 5000, tier: null })
  })

  it('tier enabled=false → ignorado', () => {
    const tiers = [{
      enabled: false, price_cents: 9999,
      days_of_week: null, start_minute: null, end_minute: null,
    }]
    const r = resolvePrice(service, tiers, new Date('2026-05-22T10:00:00Z'))
    expect(r.priceCents).toBe(5000)
  })

  it('tier que NO matchea día → ignorado', () => {
    const tiers = [{
      enabled: true, price_cents: 7000,
      days_of_week: [6],  // sábado
      start_minute: null, end_minute: null,
    }]
    // 2026-05-22 = friday (UTC dow=5)
    const r = resolvePrice(service, tiers, new Date('2026-05-22T10:00:00Z'))
    expect(r.priceCents).toBe(5000)
  })

  it('tier que NO matchea minute window → ignorado', () => {
    const tiers = [{
      enabled: true, price_cents: 7000,
      days_of_week: null,
      start_minute: 600, end_minute: 720,  // 10h-12h
    }]
    const r = resolvePrice(service, tiers, new Date('2026-05-22T14:00:00Z'))   // 14h
    expect(r.priceCents).toBe(5000)
  })
})

// ── resolvePrice — specificity ─────────────────────────────────────

describe('resolvePrice — specificity ranking', () => {
  const service = { price_cents: 5000 }
  const friday1pm = new Date('2026-05-22T13:00:00Z')

  it('tier con días + window > tier con solo días > tier con solo window', () => {
    const tiers = [
      { enabled: true, price_cents: 9000, days_of_week: null, start_minute: 600, end_minute: 1440 },  // solo window
      { enabled: true, price_cents: 8000, days_of_week: [5], start_minute: null, end_minute: null }, // solo días
      { enabled: true, price_cents: 7000, days_of_week: [5], start_minute: 720, end_minute: 1440 }, // días + window (más específico)
    ]
    const r = resolvePrice(service, tiers, friday1pm)
    expect(r.priceCents).toBe(7000)
  })

  it('mismo specificity → wins el span MÁS PEQUEÑO (más restrictivo)', () => {
    const tiers = [
      { enabled: true, price_cents: 8000, days_of_week: [5], start_minute: 0,    end_minute: 1440 },  // 24h span
      { enabled: true, price_cents: 7000, days_of_week: [5], start_minute: 720,  end_minute: 1080 },  // 6h span (más restrictivo)
    ]
    const r = resolvePrice(service, tiers, friday1pm)
    expect(r.priceCents).toBe(7000)
  })

  it('only-window tiers → 1 con span más pequeño gana', () => {
    const tiers = [
      { enabled: true, price_cents: 9000, days_of_week: null, start_minute: 0,    end_minute: 1440 }, // 24h
      { enabled: true, price_cents: 8500, days_of_week: null, start_minute: 720, end_minute: 1080 }, // 6h
    ]
    const r = resolvePrice(service, tiers, friday1pm)
    expect(r.priceCents).toBe(8500)
  })

  it('only-days tier (sin window) → span Infinity, pero gana sobre row-level', () => {
    const tiers = [
      { enabled: true, price_cents: 6000, days_of_week: [5], start_minute: null, end_minute: null },
    ]
    const r = resolvePrice(service, tiers, friday1pm)
    expect(r.priceCents).toBe(6000)
  })

  it('day inclusivo en bord (dow=0 = domingo)', () => {
    const tiers = [
      { enabled: true, price_cents: 8000, days_of_week: [0], start_minute: null, end_minute: null },
    ]
    // 2026-05-24 es DOMINGO (UTC dow=0)
    const r = resolvePrice(service, tiers, new Date('2026-05-24T10:00:00Z'))
    expect(r.priceCents).toBe(8000)
  })

  it('window inclusivo del inicio, exclusivo del fin (start_minute <= m < end_minute)', () => {
    const tiers = [
      { enabled: true, price_cents: 7000, days_of_week: null, start_minute: 600, end_minute: 720 },
    ]
    // 10:00 (m=600) → matchea (inclusivo)
    expect(resolvePrice({ price_cents: 5000 }, tiers, new Date('2026-05-22T10:00:00Z')).priceCents).toBe(7000)
    // 11:59 (m=719) → matchea
    expect(resolvePrice({ price_cents: 5000 }, tiers, new Date('2026-05-22T11:59:00Z')).priceCents).toBe(7000)
    // 12:00 (m=720) → NO matchea (exclusivo)
    expect(resolvePrice({ price_cents: 5000 }, tiers, new Date('2026-05-22T12:00:00Z')).priceCents).toBe(5000)
  })
})

// ── listPricingTiers / addPricingTier / removePricingTier ──────────

describe('pricing tier CRUD', () => {
  it('listPricingTiers: service no existe → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(listPricingTiers(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('addPricingTier: service no existe → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(addPricingTier(ctx, 'ghost', { priceCents: 1000 }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('removePricingTier: tier no existe → NotFoundError "tier"', async () => {
    repo.deletePricingTier.mockResolvedValue(false)
    await expect(removePricingTier(ctx, 'ghost')).rejects.toMatchObject({
      statusCode: 404, message: expect.stringContaining('tier'),
    })
  })

  it('addPricingTier happy → delega al repo', async () => {
    repo.findById.mockResolvedValue({ id: SVC })
    repo.insertPricingTier.mockResolvedValue({ id: 'tier-1' })
    await addPricingTier(ctx, SVC, { priceCents: 7000, daysOfWeek: [5] })
    expect(repo.insertPricingTier).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, SVC, { priceCents: 7000, daysOfWeek: [5] },
    )
  })
})

// ── quotePrice (DB-backed wrapper sobre resolvePrice) ──────────────

describe('quotePrice', () => {
  it('service no existe → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(quotePrice(ctx, 'ghost', '2026-05-22T10:00:00Z'))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: combina service + tiers → resolvePrice', async () => {
    repo.findById.mockResolvedValue({ id: SVC, price_cents: 5000 })
    repo.listPricingTiers.mockResolvedValue([
      { enabled: true, price_cents: 7000, days_of_week: [5], start_minute: 600, end_minute: 1440 },
    ])
    const r = await quotePrice(ctx, SVC, '2026-05-22T13:00:00Z')
    expect(r.priceCents).toBe(7000)
    expect(r.tier).toBeDefined()
  })
})
