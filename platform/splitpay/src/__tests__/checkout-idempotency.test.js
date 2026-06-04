// #8 — Idempotencia de Checkout Sessions (service level).
//   - Con idempotencyKey y una sesión previa del MISMO tenant → replay (no
//     re-crea sesión en Stripe).
//   - Con idempotencyKey sin sesión previa → crea + propaga la idem key a Stripe
//     (regla CLAUDE.md #3) scoped por tenant.
//   - Sin idempotencyKey → no consulta el repo de idempotencia.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { stripeMock, withTenantMock, splitRuleRepoMock, repoMock, publishMock } = vi.hoisted(() => ({
  stripeMock: { checkout: { sessions: { create: vi.fn() } } },
  withTenantMock: vi.fn(),
  splitRuleRepoMock: { findSplitRuleById: vi.fn() },
  repoMock: { insert: vi.fn(), findByTenantIdempotencyKey: vi.fn() },
  publishMock: vi.fn(),
}))

vi.mock('../lib/env.js', () => ({ env: { SPLITPAY_STRIPE_SECRET_KEY: 'sk_test' } }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/stripe.js', () => ({ stripe: stripeMock, getWebhookSecret: vi.fn() }))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenant: withTenantMock }))
vi.mock('../lib/redis.js', () => ({ redis: {} }))
vi.mock('@apphub/platform-sdk/redis', () => ({ publish: publishMock }))
vi.mock('../repositories/split-rule.repository.js', () => splitRuleRepoMock)
vi.mock('../repositories/checkout-session.repository.js', () => repoMock)

import { createCheckoutSession } from '../services/checkout-session.service.js'

const ctx  = { appId: 'aulavera', tenantId: 'tenant-1', subTenantId: null }
const STUB = { release: vi.fn(), query: vi.fn() }

const baseInput = {
  mode: 'payment',
  lineItems: [{ price: 'price_1', quantity: 1 }],
  successUrl: 'http://x/ok',
  cancelUrl:  'http://x/no',
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantMock.mockImplementation(async (_t, _s, fn) => fn(STUB))
  stripeMock.checkout.sessions.create.mockResolvedValue({ id: 'cs_new', url: 'https://stripe/new' })
  repoMock.insert.mockResolvedValue({ id: 'row-new' })
  repoMock.findByTenantIdempotencyKey.mockResolvedValue(null)
  publishMock.mockResolvedValue(undefined)
})

describe('#8 — replay idempotente', () => {
  it('sesión previa con misma (tenant, key) → replay sin crear en Stripe', async () => {
    repoMock.findByTenantIdempotencyKey.mockResolvedValueOnce({
      id: 'row-existing',
      stripe_session_id: 'cs_existing',
      metadata: { checkout_url: 'https://stripe/existing' },
    })
    const r = await createCheckoutSession(ctx, { ...baseInput, idempotencyKey: 'k1' })
    expect(repoMock.findByTenantIdempotencyKey).toHaveBeenCalledWith(STUB, ctx, 'k1')
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled()
    expect(repoMock.insert).not.toHaveBeenCalled()
    expect(r).toEqual({
      url: 'https://stripe/existing',
      sessionId: 'row-existing',
      stripeSessionId: 'cs_existing',
      idempotentReplay: true,
    })
  })

  it('sin sesión previa → crea y propaga la idem key a Stripe scoped por tenant (regla #3)', async () => {
    await createCheckoutSession(ctx, { ...baseInput, idempotencyKey: 'k2' })
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1)
    const opts = stripeMock.checkout.sessions.create.mock.calls[0][1]
    expect(opts).toEqual({ idempotencyKey: 'cs_tenant-1_k2' })
    // Persiste la idem key + el checkout_url para futuros replays.
    expect(repoMock.insert).toHaveBeenCalledWith(STUB, ctx, expect.objectContaining({
      idempotencyKey: 'k2',
      metadata: expect.objectContaining({ checkout_url: 'https://stripe/new' }),
    }))
  })

  it('sin idempotencyKey → no consulta el repo de idempotencia ni pasa opts a Stripe', async () => {
    await createCheckoutSession(ctx, baseInput)
    expect(repoMock.findByTenantIdempotencyKey).not.toHaveBeenCalled()
    expect(stripeMock.checkout.sessions.create.mock.calls[0][1]).toBeUndefined()
  })
})
