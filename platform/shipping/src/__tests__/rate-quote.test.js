// shipping.quote — devuelve las shipping_rates aplicables a un destino.
// Contrato (a través del repo.findRatesForCountry):
//   - SQL filtra (app_id, tenant_id) + LEFT JOIN zones, AND país ∈ country_codes
//     OR zone_id IS NULL (rates "wildcard").
//   - country=null → no filtra por país (devuelve todas las rates del tenant).
//   - country param se pasa como $3 (param, NO concat — anti-SQLi).
//   - ORDER BY price_cents (más barato primero).
//   - createRate persiste con min/max weight + eta_days_min/max + defaults.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))

import { quote, createRate, createZone, listRates } from '../services/shipping.service.js'
import { withTenantTransaction } from '../lib/db.js'

const ctx = {
  appId: 'shop',
  tenantId: '22222222-2222-2222-2222-222222222222',
  subTenantId: null,
}

function mockClient(rows = []) {
  const client = { query: vi.fn().mockResolvedValue({ rows }) }
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(client))
  return client
}

beforeEach(() => vi.clearAllMocks())

// ── quote(country) — el query crítico para el checkout ──────────────

describe('quote — SQL shape', () => {
  it('country presente → param $3 (anti-SQLi, no concat)', async () => {
    const c = mockClient([])
    await quote(ctx, { country: 'ES' })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/\$3/)
    expect(sql).toContain('ANY')
    expect(params).toEqual([ctx.appId, ctx.tenantId, 'ES'])
  })

  it('country malicioso → se pasa como param, NO concat', async () => {
    const c = mockClient([])
    await quote(ctx, { country: "'; DROP TABLE x; --" })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toContain('DROP TABLE')
    expect(params[2]).toBe("'; DROP TABLE x; --")
  })

  it('country undefined → param=null, devuelve TODAS las rates del tenant', async () => {
    const c = mockClient([])
    await quote(ctx, {})
    const [, params] = c.query.mock.calls[0]
    expect(params[2]).toBeNull()
  })

  it('ORDER BY r.price_cents (más barato primero — el portal espera este orden)', async () => {
    const c = mockClient([])
    await quote(ctx, { country: 'ES' })
    expect(c.query.mock.calls[0][0]).toMatch(/ORDER BY r\.price_cents/)
  })

  it('LEFT JOIN sobre shipping_zones (rates sin zona = wildcard global)', async () => {
    const c = mockClient([])
    await quote(ctx, { country: 'ES' })
    expect(c.query.mock.calls[0][0]).toMatch(/LEFT JOIN platform_shipping\.shipping_zones/)
  })

  it('devuelve rates ordenadas según el repo (combinación zone × weight × carrier)', async () => {
    mockClient([
      { id: 'r1', name: 'Standard ES', price_cents: 500, min_weight_g: 0,   max_weight_g: 5000, country_codes: ['ES'] },
      { id: 'r2', name: 'Express ES',  price_cents: 1200, min_weight_g: 0,   max_weight_g: 5000, country_codes: ['ES'] },
      { id: 'r3', name: 'Pesado ES',   price_cents: 2500, min_weight_g: 5000, max_weight_g: 20000, country_codes: ['ES'] },
    ])
    const r = await quote(ctx, { country: 'ES' })
    expect(r.map((x) => x.name)).toEqual(['Standard ES', 'Express ES', 'Pesado ES'])
  })
})

// ── createRate — defaults críticos ──────────────────────────────────

describe('createRate', () => {
  it('persiste todos los campos con defaults (min=0, max=null, eta=null)', async () => {
    const c = mockClient([{ id: 'r1' }])
    await createRate(ctx, { name: 'Standard', priceCents: 500 })
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO platform_shipping\.shipping_rates/)
    expect(params).toEqual([
      ctx.appId, ctx.tenantId,
      null,        // zoneId default null → rate wildcard
      'Standard', 500,
      0,           // minWeightG default 0
      null,        // maxWeightG default null
      null, null,  // etaDaysMin / etaDaysMax
    ])
  })

  it('zoneId + weight ranges + ETA propagan', async () => {
    const c = mockClient([{ id: 'r1' }])
    await createRate(ctx, {
      zoneId: 'z1', name: 'Express ES', priceCents: 1200,
      minWeightG: 500, maxWeightG: 5000, etaDaysMin: 1, etaDaysMax: 3,
    })
    expect(c.query.mock.calls[0][1]).toEqual([
      ctx.appId, ctx.tenantId, 'z1', 'Express ES', 1200, 500, 5000, 1, 3,
    ])
  })
})

// ── createZone ──────────────────────────────────────────────────────

describe('createZone', () => {
  it('country_codes y region_codes default a [] (Postgres TEXT[])', async () => {
    const c = mockClient([{ id: 'z1' }])
    await createZone(ctx, { name: 'EU-Iberia' })
    expect(c.query.mock.calls[0][1]).toEqual([ctx.appId, ctx.tenantId, 'EU-Iberia', [], []])
  })

  it('arrays propagan tal cual cuando se pasan', async () => {
    const c = mockClient([{ id: 'z1' }])
    await createZone(ctx, { name: 'EU', countryCodes: ['ES', 'PT'], regionCodes: ['CT', 'AN'] })
    expect(c.query.mock.calls[0][1]).toEqual([
      ctx.appId, ctx.tenantId, 'EU', ['ES', 'PT'], ['CT', 'AN'],
    ])
  })
})

// ── listRates — filter opcional por zona ────────────────────────────

describe('listRates', () => {
  it('sin zoneId → solo (app_id, tenant_id) en WHERE', async () => {
    const c = mockClient([])
    await listRates(ctx)
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).not.toMatch(/zone_id=\$/)
    expect(params).toEqual([ctx.appId, ctx.tenantId])
  })

  it('con zoneId → AGREGA zone_id=$3', async () => {
    const c = mockClient([])
    await listRates(ctx, 'z1')
    const [sql, params] = c.query.mock.calls[0]
    expect(sql).toMatch(/zone_id=\$3/)
    expect(params).toEqual([ctx.appId, ctx.tenantId, 'z1'])
  })
})
