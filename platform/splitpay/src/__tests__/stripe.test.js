// stripe.js — resolución del cliente Stripe (DB → env → throw), reset y
// getWebhookSecret. Mockea Stripe, pool y configRepo.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const stripeCtor = vi.hoisted(() => vi.fn())
vi.mock('stripe', () => ({ default: stripeCtor }))

const { envMock } = vi.hoisted(() => ({ envMock: {} }))
vi.mock('../lib/env.js', () => ({ env: envMock }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { poolMock, configRepoMock } = vi.hoisted(() => ({
  poolMock: { connect: vi.fn() },
  configRepoMock: { getValue: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: poolMock }))
vi.mock('../repositories/config.repository.js', () => configRepoMock)

import {
  reloadStripeFromDb, resetStripeClient, getWebhookSecret, getStripeMode, stripe,
} from '../lib/stripe.js'
import { logger } from '../lib/logger.js'

function fakeClient() {
  const client = { release: vi.fn() }
  poolMock.connect.mockResolvedValue(client)
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
  stripeCtor.mockImplementation(function (key) { this.key = key })
  delete envMock.SPLITPAY_STRIPE_SECRET_KEY
  delete envMock.SPLITPAY_STRIPE_WEBHOOK_SECRET
  resetStripeClient()
})

describe('reloadStripeFromDb', () => {
  it('secret en DB → crea cliente Stripe + libera client', async () => {
    const c = fakeClient()
    configRepoMock.getValue.mockResolvedValue('sk_db')
    await reloadStripeFromDb()
    expect(stripeCtor).toHaveBeenCalledWith('sk_db', expect.objectContaining({ apiVersion: '2024-06-20' }))
    expect(c.release).toHaveBeenCalled()
  })

  it('sin DB pero con env → usa env', async () => {
    fakeClient()
    configRepoMock.getValue.mockResolvedValue(null)
    envMock.SPLITPAY_STRIPE_SECRET_KEY = 'sk_env'
    await reloadStripeFromDb()
    expect(stripeCtor).toHaveBeenCalledWith('sk_env', expect.anything())
  })

  it('ni DB ni env → warn, sin crear cliente', async () => {
    fakeClient()
    configRepoMock.getValue.mockResolvedValue(null)
    await reloadStripeFromDb()
    expect(stripeCtor).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('stripe proxy — ensureStripe fallback', () => {
  it('sin cliente cargado y sin env → throw al acceder a un método', () => {
    resetStripeClient()
    expect(() => stripe.paymentIntents).toThrow(/Stripe is not configured/)
  })

  it('con env → ensureStripe crea cliente lazily; método se bindea', () => {
    resetStripeClient()
    envMock.SPLITPAY_STRIPE_SECRET_KEY = 'sk_env'
    stripeCtor.mockImplementation(function () {
      this.foo = function () { return 'bar' }
      this.value = 42
    })
    expect(typeof stripe.foo).toBe('function')
    expect(stripe.foo()).toBe('bar')
    expect(stripe.value).toBe(42)
  })
})

describe('getWebhookSecret', () => {
  it('secret en DB → la devuelve + libera client', async () => {
    const c = fakeClient()
    configRepoMock.getValue.mockResolvedValue('whsec_db')
    expect(await getWebhookSecret()).toBe('whsec_db')
    expect(c.release).toHaveBeenCalled()
  })

  it('sin DB → env fallback', async () => {
    fakeClient()
    configRepoMock.getValue.mockResolvedValue(null)
    envMock.SPLITPAY_STRIPE_WEBHOOK_SECRET = 'whsec_env'
    expect(await getWebhookSecret()).toBe('whsec_env')
  })

  it('ni DB ni env → null', async () => {
    fakeClient()
    configRepoMock.getValue.mockResolvedValue(null)
    expect(await getWebhookSecret()).toBeNull()
  })
})

// ── Resolución por modo (stripe_mode test/live, migración 0010) ────────────
describe('reloadStripeFromDb — modo test/live', () => {
  function dbValues(map) {
    configRepoMock.getValue.mockImplementation(async (_c, key) => map[key] ?? null)
  }

  it('modo live → usa stripe_live_secret_key e ignora el juego test', async () => {
    fakeClient()
    dbValues({ stripe_mode: 'live', stripe_live_secret_key: 'sk_live_db', stripe_test_secret_key: 'sk_test_db' })
    await reloadStripeFromDb()
    expect(getStripeMode()).toBe('live')
    expect(stripeCtor).toHaveBeenCalledWith('sk_live_db', expect.anything())
  })

  it('sin fila stripe_mode → default test', async () => {
    fakeClient()
    dbValues({ stripe_test_secret_key: 'sk_test_db' })
    await reloadStripeFromDb()
    expect(getStripeMode()).toBe('test')
    expect(stripeCtor).toHaveBeenCalledWith('sk_test_db', expect.anything())
  })

  it('el env fallback NO aplica en modo live (dev-stub antes que clave test)', async () => {
    fakeClient()
    envMock.SPLITPAY_STRIPE_SECRET_KEY = 'sk_test_env'
    dbValues({ stripe_mode: 'live' })
    await reloadStripeFromDb()
    expect(stripeCtor).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('getWebhookSecret en live → stripe_live_webhook_secret, sin env fallback', async () => {
    fakeClient()
    envMock.SPLITPAY_STRIPE_WEBHOOK_SECRET = 'whsec_env'
    configRepoMock.getValue.mockImplementation(async (_c, key) => ({
      stripe_mode: 'live', stripe_live_webhook_secret: 'whsec_live_db',
    }[key] ?? null))
    expect(await getWebhookSecret()).toBe('whsec_live_db')

    configRepoMock.getValue.mockImplementation(async (_c, key) =>
      key === 'stripe_mode' ? 'live' : null)
    expect(await getWebhookSecret()).toBeNull()
  })

  it('resetStripeClient vuelve a modo test', async () => {
    fakeClient()
    configRepoMock.getValue.mockImplementation(async (_c, key) => ({
      stripe_mode: 'live', stripe_live_secret_key: 'sk_live_db',
    }[key] ?? null))
    await reloadStripeFromDb()
    expect(getStripeMode()).toBe('live')
    resetStripeClient()
    expect(getStripeMode()).toBe('test')
  })
})
