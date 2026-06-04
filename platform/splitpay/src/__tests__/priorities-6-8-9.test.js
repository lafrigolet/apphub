// Tests for the prioritized backend-only use cases implemented from
// docs/use-cases/splitpay.md "Recomendaciones de priorización":
//
//   #6 — Listado + export CSV de transacciones.
//   #8 — Idempotencia de Checkout Sessions + namespacing de claves por tenant.
//   #9 — Tarifa de Stripe configurable por plataforma/región (sin hardcode).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── #9 (pure) — split-engine fee config ──────────────────────────────────────

import {
  calculateStripeFee,
  simulateSplit,
  DEFAULT_STRIPE_FEE_PERCENT,
  DEFAULT_STRIPE_FEE_FIXED,
} from '../utils/split-engine.js'

describe('#9 — calculateStripeFee configurable', () => {
  it('sin feeConfig usa el default 2.9% + 30c (EUR/USD)', () => {
    // 10000 * 0.029 + 30 = 320
    expect(calculateStripeFee(10000)).toBe(320)
    expect(DEFAULT_STRIPE_FEE_PERCENT).toBe(0.029)
    expect(DEFAULT_STRIPE_FEE_FIXED).toBe(30)
  })

  it('feeConfig override aplica percent + fixed', () => {
    // 10000 * 0.014 + 25 = 165
    expect(calculateStripeFee(10000, { percent: 0.014, fixed: 25 })).toBe(165)
  })

  it('feeConfig parcial: percent override, fixed cae al default', () => {
    // 10000 * 0.02 + 30 = 230
    expect(calculateStripeFee(10000, { percent: 0.02 })).toBe(230)
  })

  it('valores no finitos en feeConfig se ignoran (fallback a defaults)', () => {
    expect(calculateStripeFee(10000, { percent: NaN, fixed: undefined })).toBe(320)
  })

  it('simulateSplit propaga el feeConfig al cálculo de la tarifa Stripe', () => {
    const rule = { platformFeePercent: 10, recipients: [{ accountId: 'acct_1', percentage: 90, label: 'A' }] }
    const def = simulateSplit(10000, 'eur', rule)
    const cheap = simulateSplit(10000, 'eur', rule, { percent: 0.01, fixed: 10 })
    expect(def.stripeFee).toBe(320)
    expect(cheap.stripeFee).toBe(110)
    // Net mayor con tarifa menor → más para reparto.
    expect(cheap.netAmount).toBeGreaterThan(def.netAmount)
  })
})

// ── #9 (repo) — getFeeConfig ──────────────────────────────────────────────────

import * as configRepo from '../repositories/config.repository.js'

describe('#9 — config.repository.getFeeConfig', () => {
  it('mapea filas plain a { percent, fixed } numéricos', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [
      { key: 'stripe_fee_percent', plain_value: '0.014' },
      { key: 'stripe_fee_fixed', plain_value: '25' },
    ] }) }
    expect(await configRepo.getFeeConfig(client)).toEqual({ percent: 0.014, fixed: 25 })
  })

  it('sin filas → objeto vacío (caller cae a defaults)', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) }
    expect(await configRepo.getFeeConfig(client)).toEqual({})
  })

  it('valores no numéricos se descartan', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [
      { key: 'stripe_fee_percent', plain_value: 'abc' },
      { key: 'stripe_fee_fixed', plain_value: '30' },
    ] }) }
    expect(await configRepo.getFeeConfig(client)).toEqual({ fixed: 30 })
  })
})

// ── #8 (redis) — namespaced idempotency helpers ──────────────────────────────

const { fakeRedis } = vi.hoisted(() => ({
  fakeRedis: { get: vi.fn(), setex: vi.fn(), del: vi.fn() },
}))
vi.mock('../lib/env.js', () => ({ env: { REDIS_URL: 'redis://localhost:6379' } }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { configureRedis, checkIdempotencyScoped, storeIdempotencyScoped } from '../lib/redis.js'
configureRedis(fakeRedis)

describe('#8 — idempotency keys namespaced por tenant', () => {
  beforeEach(() => vi.clearAllMocks())

  it('la clave Redis incluye el tenant para evitar colisión cross-tenant', async () => {
    await checkIdempotencyScoped('tenant-A', 'order-42')
    expect(fakeRedis.get).toHaveBeenCalledWith('idempotency:tenant-A:order-42')
  })

  it('dos tenants con la MISMA key generan claves Redis distintas', async () => {
    await checkIdempotencyScoped('tenant-A', 'same-key')
    await checkIdempotencyScoped('tenant-B', 'same-key')
    expect(fakeRedis.get).toHaveBeenNthCalledWith(1, 'idempotency:tenant-A:same-key')
    expect(fakeRedis.get).toHaveBeenNthCalledWith(2, 'idempotency:tenant-B:same-key')
  })

  it('store usa TTL de 24h (regla CLAUDE.md #3) + clave scoped', async () => {
    await storeIdempotencyScoped('tenant-A', 'k', { x: 1 })
    expect(fakeRedis.setex).toHaveBeenCalledWith(
      'idempotency:tenant-A:k', 60 * 60 * 24, JSON.stringify({ x: 1 }),
    )
  })

  it('tenant nulo cae a "no-tenant" (sin crash)', async () => {
    await checkIdempotencyScoped(null, 'k')
    expect(fakeRedis.get).toHaveBeenCalledWith('idempotency:no-tenant:k')
  })
})
