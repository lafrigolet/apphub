// promotions.service — engine de promociones (Redis-only).
// Cubre: CRUD (upsert/get/delete/list con scan paginado), engine evaluate
// (percent / fixed_amount / free_shipping / desconocido / rechazos), y
// apply/clear/summary (mutación del basket JSON, phantom-code cleanup).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/redis.js', () => {
  const store = new Map()
  return {
    redis: {
      get: vi.fn(async (k) => store.get(k) ?? null),
      set: vi.fn(async (k, v) => { store.set(k, v); return 'OK' }),
      del: vi.fn(async (k) => { store.delete(k); return 1 }),
      mget: vi.fn(async (...keys) => keys.map((k) => store.get(k) ?? null)),
      // Implementación mínima de SCAN: pagina en bloques para ejercitar el
      // loop do/while del listPromos. Cursor textual "0" → fin.
      scan: vi.fn(async (cursor, _match, pattern, _count, count) => {
        const prefix = pattern.replace(/\*$/, '')
        const all = [...store.keys()].filter((k) => k.startsWith(prefix))
        const page = Number(count) || 200
        const start = Number(cursor) || 0
        const slice = all.slice(start, start + page)
        const next = start + page >= all.length ? '0' : String(start + page)
        return [next, slice]
      }),
      __store: store,
      __reset: () => store.clear(),
    },
  }
})

import {
  upsertPromo, getPromo, deletePromo, listPromos,
  evaluate, applyPromo, clearPromo, basketSummary,
} from '../services/promotions.service.js'
import { redis } from '../lib/redis.js'

const APP = 'aikikan', TENANT = 't1', USER = 'u1'
const basketKey = `basket:${APP}:${TENANT}:${USER}`

function seedBasket(items, extra = {}) {
  redis.__store.set(basketKey, JSON.stringify({ items, ...extra }))
}
const item = (id, price, qty) => ({ itemId: id, name: id, priceCents: price, quantity: qty })

beforeEach(() => { vi.clearAllMocks(); redis.__reset() })

// ── CRUD ──────────────────────────────────────────────────────────────

describe('promo CRUD', () => {
  it('upsertPromo normaliza code a uppercase + aplica defaults', async () => {
    const stored = await upsertPromo({ appId: APP, tenantId: TENANT, code: 'save10', def: { type: 'percent', value: 1000 } })
    expect(stored.code).toBe('SAVE10')
    expect(stored.value).toBe(1000)
    expect(stored.minSubtotalCents).toBe(0)
    expect(stored.maxUsesPerUser).toBe(null)
    expect(stored.freeShipping).toBe(false)
    expect(stored.enabled).toBe(true)
    expect(redis.__store.has(`basket:promo:${APP}:${TENANT}:SAVE10`)).toBe(true)
  })

  it('upsertPromo free_shipping fuerza freeShipping=true', async () => {
    const stored = await upsertPromo({ appId: APP, tenantId: TENANT, code: 'ship', def: { type: 'free_shipping' } })
    expect(stored.freeShipping).toBe(true)
  })

  it('upsertPromo respeta freeShipping explícito y enabled=false', async () => {
    const stored = await upsertPromo({
      appId: APP, tenantId: TENANT, code: 'x',
      def: { type: 'fixed_amount', value: 500, freeShipping: true, enabled: false, minSubtotalCents: 100, maxUsesPerUser: 2, expiresAt: '2030-01-01T00:00:00.000Z' },
    })
    expect(stored.freeShipping).toBe(true)
    expect(stored.enabled).toBe(false)
    expect(stored.minSubtotalCents).toBe(100)
    expect(stored.maxUsesPerUser).toBe(2)
    expect(stored.expiresAt).toBe('2030-01-01T00:00:00.000Z')
  })

  it('getPromo sin code → null', async () => {
    expect(await getPromo({ appId: APP, tenantId: TENANT, code: '' })).toBe(null)
  })

  it('getPromo inexistente → null', async () => {
    expect(await getPromo({ appId: APP, tenantId: TENANT, code: 'NOPE' })).toBe(null)
  })

  it('getPromo existente → objeto', async () => {
    await upsertPromo({ appId: APP, tenantId: TENANT, code: 'p', def: { type: 'percent', value: 100 } })
    const got = await getPromo({ appId: APP, tenantId: TENANT, code: 'p' })
    expect(got.code).toBe('P')
  })

  it('deletePromo borra la clave', async () => {
    await upsertPromo({ appId: APP, tenantId: TENANT, code: 'p', def: { type: 'percent', value: 100 } })
    await deletePromo({ appId: APP, tenantId: TENANT, code: 'p' })
    expect(await getPromo({ appId: APP, tenantId: TENANT, code: 'p' })).toBe(null)
  })

  it('listPromos vacío → []', async () => {
    expect(await listPromos({ appId: APP, tenantId: TENANT })).toEqual([])
  })

  it('listPromos devuelve promos ordenadas por code, salta valores nulos/corruptos', async () => {
    await upsertPromo({ appId: APP, tenantId: TENANT, code: 'zeta', def: { type: 'percent', value: 100 } })
    await upsertPromo({ appId: APP, tenantId: TENANT, code: 'alpha', def: { type: 'percent', value: 200 } })
    // valor corrupto (no JSON) → debe ser saltado por el try/catch
    redis.__store.set(`basket:promo:${APP}:${TENANT}:BROKEN`, '{not json')
    // mget devolverá null para una clave fantasma — fuerza la rama `if (!v) continue`
    redis.mget.mockImplementationOnce(async (...keys) => keys.map((k) => (k.endsWith('BROKEN') ? null : redis.__store.get(k) ?? null)))
    const list = await listPromos({ appId: APP, tenantId: TENANT })
    expect(list.map((p) => p.code)).toEqual(['ALPHA', 'ZETA'])
  })

  it('listPromos pagina (scan multi-página)', async () => {
    for (let i = 0; i < 5; i++) {
      await upsertPromo({ appId: APP, tenantId: TENANT, code: `c${i}`, def: { type: 'percent', value: 100 } })
    }
    // Fuerza páginas de 2 → 3 iteraciones del do/while
    redis.scan.mockImplementation(async (cursor, _m, pattern) => {
      const prefix = pattern.replace(/\*$/, '')
      const all = [...redis.__store.keys()].filter((k) => k.startsWith(prefix))
      const start = Number(cursor) || 0
      const slice = all.slice(start, start + 2)
      const next = start + 2 >= all.length ? '0' : String(start + 2)
      return [next, slice]
    })
    const list = await listPromos({ appId: APP, tenantId: TENANT })
    expect(list).toHaveLength(5)
  })
})

// ── engine evaluate (pura) ─────────────────────────────────────────────

describe('evaluate', () => {
  const basket = { items: [item('a', 1000, 2)] } // subtotal 2000

  it('sin promo → subtotal + shipping', () => {
    const r = evaluate(basket, null, { shippingCents: 500 })
    expect(r).toEqual({ subtotalCents: 2000, discountCents: 0, freeShipping: false, totalCents: 2500 })
  })

  it('promo deshabilitada → reject', () => {
    const r = evaluate(basket, { code: 'X', type: 'percent', value: 1000, enabled: false })
    expect(r.error).toBe('promo not enabled')
  })

  it('promo expirada → reject', () => {
    const r = evaluate(basket, { code: 'X', type: 'percent', value: 1000, enabled: true, expiresAt: '2000-01-01T00:00:00.000Z' })
    expect(r.error).toBe('promo expired')
  })

  it('subtotal por debajo del mínimo → reject', () => {
    const r = evaluate(basket, { code: 'X', type: 'percent', value: 1000, enabled: true, minSubtotalCents: 5000 })
    expect(r.error).toContain('min subtotal')
  })

  it('percent: value en basis points', () => {
    const r = evaluate(basket, { code: 'X', type: 'percent', value: 1000, enabled: true }, { shippingCents: 0 })
    expect(r.discountCents).toBe(200) // 10% de 2000
    expect(r.totalCents).toBe(1800)
    expect(r.promoApplied).toBe('X')
  })

  it('percent: value ausente → 0 descuento', () => {
    const r = evaluate(basket, { code: 'X', type: 'percent', enabled: true })
    expect(r.discountCents).toBe(0)
  })

  it('fixed_amount: capado al subtotal', () => {
    const r = evaluate(basket, { code: 'X', type: 'fixed_amount', value: 999999, enabled: true })
    expect(r.discountCents).toBe(2000)
    expect(r.totalCents).toBe(0)
  })

  it('fixed_amount: value ausente → 0', () => {
    const r = evaluate(basket, { code: 'X', type: 'fixed_amount', enabled: true })
    expect(r.discountCents).toBe(0)
  })

  it('free_shipping: shipping cae a 0', () => {
    const r = evaluate(basket, { code: 'X', type: 'free_shipping', enabled: true }, { shippingCents: 700 })
    expect(r.freeShipping).toBe(true)
    expect(r.totalCents).toBe(2000)
  })

  it('tipo desconocido → reject', () => {
    const r = evaluate(basket, { code: 'X', type: 'mystery', enabled: true })
    expect(r.error).toContain('unknown promo type')
  })

  it('basket sin items → subtotal 0', () => {
    const r = evaluate({}, null)
    expect(r.subtotalCents).toBe(0)
  })
})

// ── apply / clear / summary ─────────────────────────────────────────────

describe('applyPromo', () => {
  it('promo no encontrada → summary con error', async () => {
    seedBasket([item('a', 1000, 1)])
    const r = await applyPromo({ appId: APP, tenantId: TENANT, userId: USER, code: 'NONE' })
    expect(r.summary.error).toBe('promo not found')
  })

  it('promo válida → persiste appliedPromo en el basket', async () => {
    seedBasket([item('a', 1000, 2)])
    await upsertPromo({ appId: APP, tenantId: TENANT, code: 'save10', def: { type: 'percent', value: 1000 } })
    const r = await applyPromo({ appId: APP, tenantId: TENANT, userId: USER, code: 'save10' })
    expect(r.summary.discountCents).toBe(200)
    expect(JSON.parse(redis.__store.get(basketKey)).appliedPromo).toBe('SAVE10')
  })

  it('promo con error (mínimo no cumplido) → NO persiste', async () => {
    seedBasket([item('a', 100, 1)])
    await upsertPromo({ appId: APP, tenantId: TENANT, code: 'big', def: { type: 'fixed_amount', value: 50, minSubtotalCents: 5000 } })
    const r = await applyPromo({ appId: APP, tenantId: TENANT, userId: USER, code: 'big' })
    expect(r.summary.error).toContain('min subtotal')
    expect(JSON.parse(redis.__store.get(basketKey)).appliedPromo).toBeUndefined()
  })
})

describe('clearPromo', () => {
  it('elimina appliedPromo del basket', async () => {
    seedBasket([item('a', 1000, 1)], { appliedPromo: 'SAVE10' })
    const r = await clearPromo({ appId: APP, tenantId: TENANT, userId: USER })
    expect(r.basket.appliedPromo).toBeUndefined()
    expect(r.summary.discountCents).toBe(0)
  })
})

describe('basketSummary', () => {
  it('sin promo aplicada → totales base', async () => {
    seedBasket([item('a', 1000, 2)])
    const r = await basketSummary({ appId: APP, tenantId: TENANT, userId: USER, shippingCents: 300 })
    expect(r.summary.totalCents).toBe(2300)
  })

  it('con promo válida aplicada → aplica descuento', async () => {
    await upsertPromo({ appId: APP, tenantId: TENANT, code: 'save10', def: { type: 'percent', value: 1000 } })
    seedBasket([item('a', 1000, 2)], { appliedPromo: 'SAVE10' })
    const r = await basketSummary({ appId: APP, tenantId: TENANT, userId: USER })
    expect(r.summary.discountCents).toBe(200)
  })

  it('promo aplicada pero borrada → limpia el phantom code', async () => {
    seedBasket([item('a', 1000, 1)], { appliedPromo: 'GHOST' })
    const r = await basketSummary({ appId: APP, tenantId: TENANT, userId: USER })
    expect(r.basket.appliedPromo).toBeUndefined()
    expect(JSON.parse(redis.__store.get(basketKey)).appliedPromo).toBeUndefined()
  })

  it('promo aplicada pero deshabilitada → limpia el phantom code', async () => {
    await upsertPromo({ appId: APP, tenantId: TENANT, code: 'old', def: { type: 'percent', value: 100, enabled: false } })
    seedBasket([item('a', 1000, 1)], { appliedPromo: 'OLD' })
    const r = await basketSummary({ appId: APP, tenantId: TENANT, userId: USER })
    expect(r.basket.appliedPromo).toBeUndefined()
  })

  it('summary con shippingCents default 0', async () => {
    seedBasket([item('a', 500, 1)])
    const r = await basketSummary({ appId: APP, tenantId: TENANT, userId: USER })
    expect(r.summary.totalCents).toBe(500)
  })
})

// ── Ramas residuales de branch coverage ──────────────────────────────────

describe('branch coverage residual', () => {
  it('listPromos: valor con JSON corrupto → catch lo descarta', async () => {
    await upsertPromo({ appId: APP, tenantId: TENANT, code: 'good', def: { type: 'percent', value: 100 } })
    // Inyectamos un valor no-JSON bajo el prefijo de promos para forzar el catch.
    redis.__store.set(`basket:promo:${APP}:${TENANT}:BROKEN`, '{not json')
    const list = await listPromos({ appId: APP, tenantId: TENANT })
    expect(list.map((p) => p.code)).toEqual(['GOOD'])
  })

  it('evaluate: items sin priceCents/quantity → Number(||0) → subtotal 0', () => {
    const r = evaluate({ items: [{ itemId: 'x', name: 'x' }] }, null)
    expect(r.subtotalCents).toBe(0)
    expect(r.totalCents).toBe(0)
  })

  it('applyPromo sin basket en Redis (raw falsy) → readBasket devuelve {items:[]}', async () => {
    await upsertPromo({ appId: APP, tenantId: TENANT, code: 'save10', def: { type: 'percent', value: 1000, minSubtotalCents: 0 } })
    const r = await applyPromo({ appId: APP, tenantId: TENANT, userId: USER, code: 'SAVE10' })
    expect(r.basket.items).toEqual([])
  })

  it('clearPromo sin basket en Redis (raw falsy) → {items:[]}', async () => {
    const r = await clearPromo({ appId: APP, tenantId: TENANT, userId: USER })
    expect(r.basket.items).toEqual([])
  })
})
