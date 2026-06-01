import { describe, it, expect, vi, beforeEach } from 'vitest'

const { stripeMock, withTenantMock, splitRuleRepoMock, repoMock, publishMock } = vi.hoisted(() => ({
  stripeMock: {
    checkout: { sessions: { create: vi.fn() } },
  },
  withTenantMock: vi.fn(),
  splitRuleRepoMock: { findSplitRuleById: vi.fn() },
  repoMock: { insert: vi.fn() },
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
vi.mock('../repositories/split-rule.repository.js',       () => splitRuleRepoMock)
vi.mock('../repositories/checkout-session.repository.js', () => repoMock)

import { createCheckoutSession, getCheckoutSession } from '../services/checkout-session.service.js'
import { logger } from '../lib/logger.js'

const ctx  = { appId: 'aulavera', tenantId: 't1', subTenantId: null }
const STUB = { release: vi.fn(), query: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  withTenantMock.mockImplementation(async (_t, _s, fn) => fn(STUB))
  stripeMock.checkout.sessions.create.mockResolvedValue({
    id: 'cs_test_123', url: 'https://stripe.test/cs',
  })
  repoMock.insert.mockResolvedValue({ id: 'row-1' })
  publishMock.mockResolvedValue(undefined)
})

const baseInput = {
  mode: 'payment',
  lineItems: [{ price: 'price_1', quantity: 1 }],
  successUrl: 'http://x/ok',
  cancelUrl:  'http://x/no',
  customerEmail: 'd@x',
}

describe('createCheckoutSession — validación', () => {
  it('rechaza si lineItems vacío o no-array', async () => {
    await expect(createCheckoutSession(ctx, { ...baseInput, lineItems: [] })).rejects.toMatchObject({ statusCode: 422 })
    await expect(createCheckoutSession(ctx, { ...baseInput, lineItems: null })).rejects.toMatchObject({ statusCode: 422 })
  })

  it("rechaza mode != 'payment' | 'subscription'", async () => {
    await expect(createCheckoutSession(ctx, { ...baseInput, mode: 'trial' })).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('createCheckoutSession — one-shot (mode=payment) sin split', () => {
  it('llama a Stripe con line_items y enrichedMetadata + sin transfer_data', async () => {
    await createCheckoutSession(ctx, baseInput)
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1)
    const params = stripeMock.checkout.sessions.create.mock.calls[0][0]
    expect(params.mode).toBe('payment')
    expect(params.line_items).toEqual([{ price: 'price_1', quantity: 1 }])
    expect(params.metadata.tenant_id).toBe('t1')
    expect(params.metadata.app_id).toBe('aulavera')
    expect(params.payment_intent_data.metadata.tenant_id).toBe('t1')
    expect(params.payment_intent_data.transfer_data).toBeUndefined()
  })

  it('persiste row + publica splitpay.checkout.created', async () => {
    await createCheckoutSession(ctx, baseInput)
    expect(repoMock.insert).toHaveBeenCalledWith(STUB, ctx, expect.objectContaining({
      mode: 'payment', stripeSessionId: 'cs_test_123',
    }))
    expect(publishMock).toHaveBeenCalledWith(
      expect.anything(),
      'platform',
      expect.objectContaining({
        type: 'splitpay.checkout.created',
        payload: expect.objectContaining({ stripeSessionId: 'cs_test_123' }),
      }),
    )
  })

  it('devuelve { url, sessionId, stripeSessionId }', async () => {
    const r = await createCheckoutSession(ctx, baseInput)
    expect(r).toEqual({
      url: 'https://stripe.test/cs',
      sessionId: 'row-1',
      stripeSessionId: 'cs_test_123',
    })
  })

  it('ctx.appId ausente → app_id en metadata cae a "" (rama ?? "")', async () => {
    const ctxNoApp = { tenantId: 't1', subTenantId: null }
    await createCheckoutSession(ctxNoApp, baseInput)
    const params = stripeMock.checkout.sessions.create.mock.calls[0][0]
    expect(params.metadata.app_id).toBe('')
  })
})

describe('createCheckoutSession — subscription', () => {
  it('crea con mode=subscription y subscription_data en lugar de payment_intent_data', async () => {
    await createCheckoutSession(ctx, { ...baseInput, mode: 'subscription' })
    const params = stripeMock.checkout.sessions.create.mock.calls[0][0]
    expect(params.mode).toBe('subscription')
    expect(params.subscription_data).toBeDefined()
    expect(params.payment_intent_data).toBeUndefined()
  })
})

describe('createCheckoutSession — split rule', () => {
  it('aplica transfer_data.destination con la primera destination de la rule (mode=payment)', async () => {
    splitRuleRepoMock.findSplitRuleById.mockResolvedValueOnce({
      recipients: [{ accountId: 'acct_first' }, { accountId: 'acct_second' }],
    })
    await createCheckoutSession(ctx, { ...baseInput, splitRuleId: 'r1' })
    const params = stripeMock.checkout.sessions.create.mock.calls[0][0]
    expect(params.payment_intent_data.transfer_data).toEqual({ destination: 'acct_first' })
  })

  it('aplica transfer_data.destination en subscription_data cuando mode=subscription', async () => {
    splitRuleRepoMock.findSplitRuleById.mockResolvedValueOnce({
      recipients: [{ accountId: 'acct_first' }],
    })
    await createCheckoutSession(ctx, { ...baseInput, mode: 'subscription', splitRuleId: 'r1' })
    const params = stripeMock.checkout.sessions.create.mock.calls[0][0]
    expect(params.subscription_data.transfer_data).toEqual({ destination: 'acct_first' })
  })

  it('rechaza con 404 si la split rule no existe', async () => {
    splitRuleRepoMock.findSplitRuleById.mockResolvedValueOnce(null)
    await expect(
      createCheckoutSession(ctx, { ...baseInput, splitRuleId: 'no-existe' }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rechaza con 422 si la rule no tiene destinations', async () => {
    splitRuleRepoMock.findSplitRuleById.mockResolvedValueOnce({ recipients: [] })
    await expect(
      createCheckoutSession(ctx, { ...baseInput, splitRuleId: 'r-empty' }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})

describe('createCheckoutSession — Stripe falla', () => {
  it('stripe.checkout.sessions.create lanza → loguea + re-throw (no persiste)', async () => {
    stripeMock.checkout.sessions.create.mockRejectedValueOnce(new Error('Stripe boom'))
    await expect(createCheckoutSession(ctx, baseInput)).rejects.toThrow('Stripe boom')
    expect(logger.error).toHaveBeenCalled()
    expect(repoMock.insert).not.toHaveBeenCalled()
  })

  it('publish falla → logger.warn, pero la creación NO falla', async () => {
    publishMock.mockRejectedValueOnce(new Error('redis down'))
    const r = await createCheckoutSession(ctx, baseInput)
    expect(r.stripeSessionId).toBe('cs_test_123')
    // El catch en .catch() se ejecuta en microtask — esperamos un tick.
    await new Promise((res) => setImmediate(res))
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('getCheckoutSession', () => {
  it('SELECT por id + tenant, devuelve row', async () => {
    STUB.query.mockResolvedValueOnce({ rows: [{ id: 's1', tenant_id: 't1' }] })
    const r = await getCheckoutSession(ctx, 's1')
    expect(STUB.query.mock.calls[0][1]).toEqual(['s1', 't1'])
    expect(r.id).toBe('s1')
  })

  it('sin row → null', async () => {
    STUB.query.mockResolvedValueOnce({ rows: [] })
    expect(await getCheckoutSession(ctx, 'nope')).toBeNull()
  })
})

describe('createCheckoutSession — propagación de metadata', () => {
  it('metadata libre del caller + tenant_id/app_id/sub_tenant_id/split_rule_id auto-añadidos', async () => {
    await createCheckoutSession(ctx, {
      ...baseInput,
      metadata: { purpose: 'donation', donation_id: 'd-1' },
    })
    const params = stripeMock.checkout.sessions.create.mock.calls[0][0]
    expect(params.metadata.purpose).toBe('donation')
    expect(params.metadata.donation_id).toBe('d-1')
    expect(params.metadata.tenant_id).toBe('t1')
    expect(params.metadata.app_id).toBe('aulavera')
    expect(params.metadata.split_rule_id).toBe('')   // vacío cuando no hay rule
    // El metadata del payment_intent_data espeja el del nivel root
    expect(params.payment_intent_data.metadata).toEqual(params.metadata)
  })
})
