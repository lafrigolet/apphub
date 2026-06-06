// lib/stripe — resolución del juego de claves por stripe_mode, fallback a env
// SOLO en modo test (las env actuales son credenciales test; promoverlas a
// live de forma silenciosa sería cobrar de verdad con claves equivocadas).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { release, connect } = vi.hoisted(() => ({ release: vi.fn(), connect: vi.fn() }))
vi.mock('../lib/db.js', () => ({ pool: { connect } }))

const configRepo = vi.hoisted(() => ({ getValue: vi.fn() }))
vi.mock('../repositories/config.repository.js', () => configRepo)

import {
  reloadStripeFromDb, getWebhookSecret, getStripeMode, isStubbed, resetStripeClient,
} from '../lib/stripe.js'

// getValue(client, key) dispatcher sobre un mapa key→valor.
function dbValues(map) {
  configRepo.getValue.mockImplementation(async (_c, key) => map[key] ?? null)
}

const ENV_KEYS = ['PLATFORM_STRIPE_SECRET_KEY', 'PLATFORM_STRIPE_WEBHOOK_SECRET']
const savedEnv = {}

beforeEach(() => {
  vi.clearAllMocks()
  connect.mockResolvedValue({ release })
  resetStripeClient()
  for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('reloadStripeFromDb — resolución por modo', () => {
  it('modo test (default sin fila stripe_mode) → stripe_test_secret_key', async () => {
    dbValues({ stripe_test_secret_key: 'sk_test_db' })
    await reloadStripeFromDb()
    expect(getStripeMode()).toBe('test')
    expect(isStubbed()).toBe(false)
  })

  it('modo live → stripe_live_secret_key; ignora el juego test', async () => {
    dbValues({ stripe_mode: 'live', stripe_live_secret_key: 'sk_live_db', stripe_test_secret_key: 'sk_test_db' })
    await reloadStripeFromDb()
    expect(getStripeMode()).toBe('live')
    expect(isStubbed()).toBe(false)
    expect(configRepo.getValue).toHaveBeenCalledWith(expect.anything(), 'stripe_live_secret_key')
  })

  it('fallback a PLATFORM_STRIPE_SECRET_KEY solo en modo test', async () => {
    process.env.PLATFORM_STRIPE_SECRET_KEY = 'sk_test_env'
    dbValues({})
    await reloadStripeFromDb()
    expect(isStubbed()).toBe(false)

    resetStripeClient()
    dbValues({ stripe_mode: 'live' }) // live sin clave en DB: la env NO aplica
    await reloadStripeFromDb()
    expect(getStripeMode()).toBe('live')
    expect(isStubbed()).toBe(true) // dev-stub, nunca la clave test de env
  })

  it('resetStripeClient vuelve a modo test', async () => {
    dbValues({ stripe_mode: 'live', stripe_live_secret_key: 'sk_live_db' })
    await reloadStripeFromDb()
    expect(getStripeMode()).toBe('live')
    resetStripeClient()
    expect(getStripeMode()).toBe('test')
    expect(isStubbed()).toBe(true)
  })
})

describe('getWebhookSecret — por modo activo', () => {
  it('test → stripe_test_webhook_secret con fallback env', async () => {
    dbValues({ stripe_test_webhook_secret: 'whsec_test_db' })
    expect(await getWebhookSecret()).toBe('whsec_test_db')

    dbValues({})
    process.env.PLATFORM_STRIPE_WEBHOOK_SECRET = 'whsec_env'
    expect(await getWebhookSecret()).toBe('whsec_env')
  })

  it('live → stripe_live_webhook_secret, sin fallback env', async () => {
    process.env.PLATFORM_STRIPE_WEBHOOK_SECRET = 'whsec_env'
    dbValues({ stripe_mode: 'live', stripe_live_webhook_secret: 'whsec_live_db' })
    expect(await getWebhookSecret()).toBe('whsec_live_db')

    dbValues({ stripe_mode: 'live' })
    expect(await getWebhookSecret()).toBe(null)
  })
})
