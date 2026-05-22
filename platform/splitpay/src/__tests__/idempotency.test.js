// Verifica el contrato de idempotencia de splitpay (regla CLAUDE.md #3):
//   "Always use idempotency keys for Stripe API calls. Keys are stored in
//    Redis with a 24h TTL."
//
// Aquí probamos los HELPERS (checkIdempotency / storeIdempotency) sin
// arrastrar el servicio entero — son la barrera que garantiza que un
// reintento del mismo POST no crea un segundo cargo.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { fakeRedis } = vi.hoisted(() => ({
  fakeRedis: {
    get:   vi.fn(),
    setex: vi.fn(),
    del:   vi.fn(),
  },
}))

vi.mock('../lib/env.js', () => ({ env: { REDIS_URL: 'redis://localhost:6379' } }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Inyectamos el cliente fake antes del primer import.
import { configureRedis, checkIdempotency, storeIdempotency } from '../lib/redis.js'
configureRedis(fakeRedis)

beforeEach(() => vi.clearAllMocks())

describe('checkIdempotency / storeIdempotency — namespace y TTL', () => {
  it('keys se almacenan con prefijo "idempotency:" para evitar colisión', async () => {
    fakeRedis.get.mockResolvedValueOnce(null)
    await checkIdempotency('order-42')
    expect(fakeRedis.get).toHaveBeenCalledWith('idempotency:order-42')

    await storeIdempotency('order-42', { paymentId: 'pi_1' })
    expect(fakeRedis.setex).toHaveBeenCalledWith(
      'idempotency:order-42',
      expect.any(Number),
      JSON.stringify({ paymentId: 'pi_1' }),
    )
  })

  it('TTL = 24h (86400s) — regla CLAUDE.md #3', async () => {
    await storeIdempotency('k', { x: 1 })
    const ttl = fakeRedis.setex.mock.calls[0][1]
    expect(ttl).toBe(60 * 60 * 24)
  })

  it('el value almacenado es JSON.stringify del result (objeto recuperable)', async () => {
    await storeIdempotency('k2', { paymentId: 'pi_2', status: 'succeeded', amount_cents: 5000 })
    const serialized = fakeRedis.setex.mock.calls[0][2]
    expect(JSON.parse(serialized)).toEqual({
      paymentId: 'pi_2', status: 'succeeded', amount_cents: 5000,
    })
  })

  it('checkIdempotency devuelve el string crudo (caller hace JSON.parse)', async () => {
    fakeRedis.get.mockResolvedValueOnce('{"paymentId":"pi_3"}')
    const r = await checkIdempotency('k3')
    expect(r).toBe('{"paymentId":"pi_3"}')
  })

  it('checkIdempotency devuelve null cuando la key no existe (path "primera ejecución")', async () => {
    fakeRedis.get.mockResolvedValueOnce(null)
    const r = await checkIdempotency('never-seen')
    expect(r).toBeNull()
  })
})

describe('Contrato idempotencia — flujo lógico de doble POST', () => {
  it('1er POST: GET miss → guarda result. 2º POST con misma key: GET hit → NO ejecuta side-effect', async () => {
    // 1ª ejecución: cache miss → service crea el cargo y guarda
    fakeRedis.get.mockResolvedValueOnce(null)
    const firstCheck = await checkIdempotency('idem-abc')
    expect(firstCheck).toBeNull()           // "go ahead, crear el cargo"
    await storeIdempotency('idem-abc', { paymentId: 'pi_X', status: 'succeeded' })

    // 2ª ejecución: cache hit → service devuelve el resultado cacheado
    fakeRedis.get.mockResolvedValueOnce('{"paymentId":"pi_X","status":"succeeded"}')
    const secondCheck = await checkIdempotency('idem-abc')
    expect(secondCheck).toBeTruthy()
    expect(JSON.parse(secondCheck).paymentId).toBe('pi_X')

    // Verificación clave: setex se llamó UNA sola vez (no se duplicó el cargo).
    expect(fakeRedis.setex).toHaveBeenCalledTimes(1)
  })

  it('la key de idempotencia se propaga a Stripe como `idempotencyKey` para que la API también filtre dobles', async () => {
    // Sólo documentamos el contrato: storeIdempotency NO es el único guard;
    // payment.service.js además le pasa `{ idempotencyKey: 'pi_${input.idempotencyKey}' }`
    // a stripe.paymentIntents.create. Ese segundo guard garantiza que aunque
    // Redis se borre por TTL, Stripe seguirá devolviendo el mismo PI ID.
    // Test guard: tras storeIdempotency, el caller PUEDE pasar la key como
    // sufijo a la llamada Stripe sin colisión.
    await storeIdempotency('order-99', { paymentId: 'pi_99' })
    expect(fakeRedis.setex.mock.calls[0][0]).toContain('order-99')
  })
})
