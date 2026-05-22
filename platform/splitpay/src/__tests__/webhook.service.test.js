// Verifica los dos contratos críticos de webhooks Stripe:
//   1) Stripe-Signature válido → constructEvent devuelve el evento parseado.
//   2) Stripe-Signature inválido / firma manipulada → throw + 400 en la ruta.
//
// El test usa el helper público de la librería oficial Stripe Node
// (`webhooks.generateTestHeaderString`) que produce firmas reales (HMAC
// SHA-256 sobre `${timestamp}.${body}` con la secret), exactamente lo
// que Stripe envía en prod. Así NO mockeamos `stripe.webhooks`.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { configRepoGetValue } = vi.hoisted(() => ({ configRepoGetValue: vi.fn() }))

vi.mock('../lib/env.js', () => ({
  env: {
    // Necesario para que ensureStripe() no throw cuando se crea el cliente.
    // constructEvent verifica firma localmente (HMAC); NO contacta API Stripe.
    SPLITPAY_STRIPE_SECRET_KEY:     'sk_test_fake_unused_in_signature_verify',
    SPLITPAY_STRIPE_WEBHOOK_SECRET: 'whsec_env_fallback',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: { connect: vi.fn() } }))
vi.mock('../lib/redis.js', () => ({ redis: {} }))
vi.mock('../repositories/config.repository.js', () => ({ getValue: configRepoGetValue }))

// stripe es la librería real — usamos sus helpers para generar/verificar firmas.
import Stripe from 'stripe'
import { constructWebhookEvent } from '../services/webhook.service.js'
import { pool } from '../lib/db.js'

const SECRET = 'whsec_test_abcdef0123456789'
const PAYLOAD = JSON.stringify({ id: 'evt_test_1', type: 'payment_intent.succeeded' })

beforeEach(() => {
  vi.clearAllMocks()
  // db pool returns a client whose configRepo.getValue is patched above.
  pool.connect.mockResolvedValue({ release: vi.fn(), query: vi.fn() })
  configRepoGetValue.mockResolvedValue(SECRET)
})

function makeSignature(body, secret, timestamp = Math.floor(Date.now() / 1000)) {
  // Stripe Node SDK expone esto en lib/webhooks; el resultado es el header
  // que llega como 'stripe-signature' en webhook requests reales.
  return Stripe.webhooks.generateTestHeaderString({
    timestamp,
    payload: body,
    secret,
  })
}

describe('constructWebhookEvent — firma válida', () => {
  it('acepta una firma generada con la misma secret', async () => {
    const signature = makeSignature(PAYLOAD, SECRET)
    const event = await constructWebhookEvent(PAYLOAD, signature)
    expect(event).toMatchObject({ id: 'evt_test_1', type: 'payment_intent.succeeded' })
  })

  it('lee la secret desde DB con prioridad sobre env', async () => {
    configRepoGetValue.mockResolvedValueOnce('whsec_db_only')
    const signature = makeSignature(PAYLOAD, 'whsec_db_only')
    const event = await constructWebhookEvent(PAYLOAD, signature)
    expect(event.id).toBe('evt_test_1')
  })
})

describe('constructWebhookEvent — firma inválida (tamper)', () => {
  it('rechaza firma generada con OTRA secret', async () => {
    const signatureWithDifferentSecret = makeSignature(PAYLOAD, 'whsec_DIFFERENT')
    await expect(constructWebhookEvent(PAYLOAD, signatureWithDifferentSecret))
      .rejects.toThrow(/signature/i)
  })

  it('rechaza si el body ha sido modificado (tampered)', async () => {
    const signature = makeSignature(PAYLOAD, SECRET)
    const tamperedBody = PAYLOAD.replace('evt_test_1', 'evt_attacker_1')
    await expect(constructWebhookEvent(tamperedBody, signature))
      .rejects.toThrow(/signature/i)
  })

  it('rechaza si la firma es texto basura (replay imposible)', async () => {
    await expect(constructWebhookEvent(PAYLOAD, 'not-a-valid-stripe-signature'))
      .rejects.toThrow()
  })

  it('rechaza si la timestamp del header está muy en el pasado (replay >5min, tolerancia default Stripe)', async () => {
    const oldTs = Math.floor(Date.now() / 1000) - 60 * 10   // 10 min atrás
    const signature = makeSignature(PAYLOAD, SECRET, oldTs)
    await expect(constructWebhookEvent(PAYLOAD, signature))
      .rejects.toThrow(/timestamp|tolerance/i)
  })
})

describe('constructWebhookEvent — fallback DB → env', () => {
  it('usa el env como fallback si la DB no tiene secret', async () => {
    configRepoGetValue.mockResolvedValueOnce(null)
    const signature = makeSignature(PAYLOAD, 'whsec_env_fallback')
    const event = await constructWebhookEvent(PAYLOAD, signature)
    expect(event.id).toBe('evt_test_1')
  })
})
