// basket.service — Redis-only cart con saved-for-later y guest merge.
// Contrato:
//   - Key layout: basket:<appId>:<tenantId>:<userId> y basket:saved:<...>.
//     Cambiar el layout es BREAKING para el frontend (lockfile invisible).
//   - upsertItem: replace by itemId (no acumula quantity); push si nuevo.
//   - mergeBaskets:
//       · userId === guestUserId → no-op (devuelve user basket).
//       · Items presentes en ambos → SUMA quantity.
//       · Items solo en guest → append.
//       · Guest basket SE BORRA al final (no leftover en re-login).
//   - saveForLater: mueve item de basket→saved; itemId no presente → no-op.
//   - moveBackToBasket: revierte el movimiento.
//   - removeItem en basket vacío → {items:[]} (no crash).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error', REDIS_URL: 'redis://localhost',
    BASKET_TTL_AUTH_SECONDS: 2_592_000, BASKET_TTL_GUEST_SECONDS: 604_800,
  },
}))
vi.mock('../lib/redis.js', () => {
  const store = new Map()
  const ttls = new Map()
  return {
    publish: vi.fn(async () => {}),
    redis: {
      // set(k, v) or set(k, v, 'EX', n) or set(k, v, 'KEEPTTL')
      set: vi.fn(async (k, v, mode, n) => {
        store.set(k, v)
        if (mode === 'EX') ttls.set(k, n)
        else if (mode !== 'KEEPTTL') ttls.delete(k)
        return 'OK'
      }),
      get: vi.fn(async (k) => store.get(k) ?? null),
      del: vi.fn(async (k) => { store.delete(k); ttls.delete(k); return 1 }),
      __store: store,
      __ttls: ttls,
      __reset: () => { store.clear(); ttls.clear() },
    },
  }
})

import {
  getBasket, getCount, upsertItem, patchQuantity, removeItem, clearBasket, mergeBaskets,
  listSaved, saveForLater, moveBackToBasket, removeSaved,
} from '../services/basket.service.js'
import { redis, publish } from '../lib/redis.js'

const APP = 'aikikan', TENANT = 't1', USER = 'u1', GUEST = 'g1'
const item = (id, qty = 1, price = 100) => ({
  itemId: id, quantity: qty, name: `item-${id}`, priceCents: price, metadata: null,
})

beforeEach(() => { vi.clearAllMocks(); redis.__reset() })

// ── Key layout (regression test) ────────────────────────────────────

describe('redis key layout', () => {
  it('clave basket SIEMPRE = basket:<app>:<tenant>:<user>', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    expect(redis.__store.has('basket:aikikan:t1:u1')).toBe(true)
  })
  it('clave saved-for-later = basket:saved:<app>:<tenant>:<user>', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    await saveForLater({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    expect(redis.__store.has('basket:saved:aikikan:t1:u1')).toBe(true)
  })
  it('basket de tenants distintos NO se solapan', async () => {
    await upsertItem({ appId: APP, tenantId: 't1', userId: USER, ...item('p1') })
    await upsertItem({ appId: APP, tenantId: 't2', userId: USER, ...item('p2') })
    expect(JSON.parse(redis.__store.get('basket:aikikan:t1:u1')).items[0].itemId).toBe('p1')
    expect(JSON.parse(redis.__store.get('basket:aikikan:t2:u1')).items[0].itemId).toBe('p2')
  })
})

// ── getBasket / upsertItem / removeItem ─────────────────────────────

describe('basket CRUD', () => {
  it('getBasket sin row → {items:[]}', async () => {
    const r = await getBasket({ appId: APP, tenantId: TENANT, userId: USER })
    expect(r).toEqual({ items: [] })
  })
  it('upsertItem add + replace by itemId (no acumula quantity)', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1', 1) })
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1', 5) })
    const b = await getBasket({ appId: APP, tenantId: TENANT, userId: USER })
    expect(b.items).toHaveLength(1)
    expect(b.items[0].quantity).toBe(5)             // replaced, not summed
  })
  it('removeItem en basket vacío → {items:[]} sin crash', async () => {
    const r = await removeItem({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'ghost' })
    expect(r).toEqual({ items: [] })
  })
  it('clearBasket borra la clave', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    await clearBasket({ appId: APP, tenantId: TENANT, userId: USER })
    expect(redis.__store.has('basket:aikikan:t1:u1')).toBe(false)
  })
})

// ── mergeBaskets (post-login flow) ──────────────────────────────────

describe('mergeBaskets', () => {
  it('userId === guestUserId → no-op, devuelve user basket', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1', 3) })
    const r = await mergeBaskets({ appId: APP, tenantId: TENANT, userId: USER, guestUserId: USER })
    expect(r.items).toHaveLength(1)
    expect(r.items[0].quantity).toBe(3)
  })

  it('item solo en guest → APPEND al user basket', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER,  ...item('p1', 2) })
    await upsertItem({ appId: APP, tenantId: TENANT, userId: GUEST, ...item('p2', 1) })
    const merged = await mergeBaskets({ appId: APP, tenantId: TENANT, userId: USER, guestUserId: GUEST })
    const ids = merged.items.map((i) => i.itemId).sort()
    expect(ids).toEqual(['p1', 'p2'])
  })

  it('item en AMBOS → SUMA quantity', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER,  ...item('p1', 2) })
    await upsertItem({ appId: APP, tenantId: TENANT, userId: GUEST, ...item('p1', 5) })
    const merged = await mergeBaskets({ appId: APP, tenantId: TENANT, userId: USER, guestUserId: GUEST })
    expect(merged.items[0].quantity).toBe(7)
  })

  it('guest basket SE BORRA al final del merge (no re-login con leftover)', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: GUEST, ...item('p1') })
    await mergeBaskets({ appId: APP, tenantId: TENANT, userId: USER, guestUserId: GUEST })
    expect(redis.__store.has('basket:aikikan:t1:g1')).toBe(false)
  })

  it('user sin basket previo + guest con items → adopt guest', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: GUEST, ...item('p1', 4) })
    const r = await mergeBaskets({ appId: APP, tenantId: TENANT, userId: USER, guestUserId: GUEST })
    expect(r.items).toHaveLength(1)
    expect(r.items[0].quantity).toBe(4)
  })
})

// ── saved-for-later ─────────────────────────────────────────────────

describe('saveForLater / moveBackToBasket', () => {
  it('saveForLater mueve item de basket→saved', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1', 2) })
    const r = await saveForLater({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    expect(r.basket.items).toHaveLength(0)
    expect(r.saved.items[0].itemId).toBe('p1')
  })

  it('saveForLater de un itemId que no existe → no-op', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    const r = await saveForLater({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'ghost' })
    expect(r.basket.items).toHaveLength(1)
    expect(r.saved.items).toHaveLength(0)
  })

  it('moveBackToBasket revierte movimiento + suma cantidad (vía upsert replace, en realidad no acumula)', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1', 3) })
    await saveForLater({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    const r = await moveBackToBasket({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    expect(r.saved.items).toHaveLength(0)
    expect(r.basket.items[0].itemId).toBe('p1')
    expect(r.basket.items[0].quantity).toBe(3)
  })

  it('removeSaved en saved vacío → {items:[]} sin crash', async () => {
    const r = await removeSaved({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'ghost' })
    expect(r).toEqual({ items: [] })
  })

  it('listSaved sin row → {items:[]}', async () => {
    const r = await listSaved({ appId: APP, tenantId: TENANT, userId: USER })
    expect(r).toEqual({ items: [] })
  })

  it('listSaved con items → devuelve el contenido persistido', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1', 2) })
    await saveForLater({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    const r = await listSaved({ appId: APP, tenantId: TENANT, userId: USER })
    expect(r.items[0].itemId).toBe('p1')
  })

  it('removeSaved con items → filtra el item indicado', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p2') })
    await saveForLater({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    await saveForLater({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p2' })
    const r = await removeSaved({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    expect(r.items.map((i) => i.itemId)).toEqual(['p2'])
  })

  it('moveBackToBasket sin saved key → no-op devuelve basket actual', async () => {
    const r = await moveBackToBasket({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    expect(r.saved).toEqual({ items: [] })
  })

  it('moveBackToBasket itemId no presente en saved → no-op', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    await saveForLater({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    const r = await moveBackToBasket({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'ghost' })
    expect(r.saved.items[0].itemId).toBe('p1')
  })

  it('removeItem con items → filtra correctamente', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p2') })
    const r = await removeItem({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    expect(r.items.map((i) => i.itemId)).toEqual(['p2'])
  })

  // ── Ramas residuales de branch coverage ────────────────────────────────

  it('mergeBaskets: user con items, guest vacío (guestRaw falsy) → conserva user', async () => {
    // user basket presente, guest basket ausente: ejercita la rama
    // `guestRaw ? ... : { items: [] }` por el lado falsy.
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    const r = await mergeBaskets({ appId: APP, tenantId: TENANT, userId: USER, guestUserId: GUEST })
    expect(r.items.map((i) => i.itemId)).toEqual(['p1'])
  })

  it('mergeBaskets: quantity undefined en ambos lados → Number(||0) fallback', async () => {
    // Sembramos directamente entradas sin `quantity` para ejercitar los
    // fallbacks `Number(existing.quantity || 0)` y `Number(g.quantity || 0)`.
    const userKey  = `basket:${APP}:${TENANT}:${USER}`
    const guestKey = `basket:${APP}:${TENANT}:${GUEST}`
    redis.__store.set(userKey,  JSON.stringify({ items: [{ itemId: 'p1', name: 'p1', priceCents: 100 }] }))
    redis.__store.set(guestKey, JSON.stringify({ items: [{ itemId: 'p1', name: 'p1', priceCents: 100 }] }))
    const r = await mergeBaskets({ appId: APP, tenantId: TENANT, userId: USER, guestUserId: GUEST })
    expect(r.items).toHaveLength(1)
    expect(r.items[0].quantity).toBe(0)
  })

  it('saveForLater sin basket (raw falsy) → no-op, saved vacío', async () => {
    const r = await saveForLater({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'ghost' })
    expect(r.saved).toEqual({ items: [] })
    expect(r.basket).toEqual({ items: [] })
  })
})

// ── TTL / sliding expiry / empty-key cleanup ─────────────────────────────

describe('TTL & empty-key cleanup', () => {
  it('upsertItem (auth) escribe con TTL de 30d', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    expect(redis.__ttls.get('basket:aikikan:t1:u1')).toBe(2_592_000)
  })

  it('upsertItem (guest) escribe con TTL de 7d', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1'), isGuest: true })
    expect(redis.__ttls.get('basket:aikikan:t1:u1')).toBe(604_800)
  })

  it('removeItem que deja el basket vacío → BORRA la clave (no leak)', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    await removeItem({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    expect(redis.__store.has('basket:aikikan:t1:u1')).toBe(false)
  })

  it('saveForLater que vacía el basket → borra la clave del carrito', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    await saveForLater({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    expect(redis.__store.has('basket:aikikan:t1:u1')).toBe(false)
    expect(redis.__store.has('basket:saved:aikikan:t1:u1')).toBe(true)
  })

  it('removeSaved que vacía la lista guardada → borra la clave saved', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    await saveForLater({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    await removeSaved({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1' })
    expect(redis.__store.has('basket:saved:aikikan:t1:u1')).toBe(false)
  })
})

// ── patchQuantity (atomic relative change) ───────────────────────────────

describe('patchQuantity', () => {
  it('incrementa la cantidad del ítem', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1', 2) })
    const r = await patchQuantity({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1', delta: 3 })
    expect(r.items[0].quantity).toBe(5)
  })

  it('decrementa pero nunca por debajo de 1 (clamp)', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1', 2) })
    const r = await patchQuantity({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1', delta: -10 })
    expect(r.items[0].quantity).toBe(1)
  })

  it('itemId inexistente → no-op (devuelve basket sin cambios)', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1', 2) })
    const r = await patchQuantity({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'ghost', delta: 1 })
    expect(r.items[0].quantity).toBe(2)
  })

  it('sin basket en Redis → devuelve {items:[]}', async () => {
    const r = await patchQuantity({ appId: APP, tenantId: TENANT, userId: USER, itemId: 'p1', delta: 1 })
    expect(r).toEqual({ items: [] })
  })
})

// ── getCount (mini-cart badge) ───────────────────────────────────────────

describe('getCount', () => {
  it('sin basket → ceros', async () => {
    const r = await getCount({ appId: APP, tenantId: TENANT, userId: USER })
    expect(r).toEqual({ itemCount: 0, lineCount: 0, subtotalCents: 0, appliedPromo: null })
  })

  it('suma cantidades + subtotal + líneas + appliedPromo', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1', 2, 100) })
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p2', 3, 50) })
    // simula un promo aplicado en el JSON del basket
    const raw = JSON.parse(redis.__store.get('basket:aikikan:t1:u1'))
    raw.appliedPromo = 'SAVE10'
    redis.__store.set('basket:aikikan:t1:u1', JSON.stringify(raw))
    const r = await getCount({ appId: APP, tenantId: TENANT, userId: USER })
    expect(r).toEqual({ itemCount: 5, lineCount: 2, subtotalCents: 350, appliedPromo: 'SAVE10' })
  })
})

// ── basket.updated event ─────────────────────────────────────────────────

describe('basket.updated events', () => {
  it('upsertItem publica basket.updated con conteos', async () => {
    await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1', 2) })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'basket.updated', action: 'upsert_item', appId: APP, tenantId: TENANT, userId: USER,
      itemCount: 2, lineCount: 1,
    }))
  })

  it('clearBasket publica basket.updated action=clear', async () => {
    await clearBasket({ appId: APP, tenantId: TENANT, userId: USER })
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'basket.updated', action: 'clear' }))
  })

  it('fallo en publish no rompe la mutación (best-effort)', async () => {
    publish.mockRejectedValueOnce(new Error('redis down'))
    const r = await upsertItem({ appId: APP, tenantId: TENANT, userId: USER, ...item('p1') })
    expect(r.items).toHaveLength(1)
  })
})
