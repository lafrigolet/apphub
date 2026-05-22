// fees.service — flujo cuotas socio aikikan.
// Contrato:
//   - listProducts: tenantId vacío → ValidationError 422.
//   - getMyFees: identity sin userId → Forbidden; computa status por product code
//     basado en último pago paid en últimos 12 meses.
//   - getFeesByUserId: requiere rol admin/owner → 403 si user/staff/null.
//   - createCheckout:
//       · codes vacío/no array → ValidationError.
//       · Algún code no en catálogo → NotFoundError.
//       · Producto sin stripe_price_id → AppError 503 (STRIPE_PRICE_MISSING).
//       · Si hay producto recurring_annual → mode='subscription', else 'payment'.
//       · fetch a splitpay falla → 502 SPLITPAY_UNREACHABLE.
//       · splitpay 4xx/5xx → propaga el error.code y status del json.
//       · splitpay 200 pero falta url/stripeSessionId → 502 SPLITPAY_INVALID_RESPONSE.
//       · Pre-registra payment row con stripeSessionId.
//   - updateProduct / setProductStripePriceId:
//       · rol !owner/admin → Forbidden.
//       · code inexistente → NotFoundError.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_JWT_SECRET: 'test-secret-32-chars-xxxxxxxxxxxxxxx',
    SPLITPAY_BASE_URL: 'http://platform-core:3000',
    AIKIKAN_PUBLIC_URL: 'http://aikikan.local',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../repositories/fees.repository.js')

import {
  listProducts, getMyFees, getFeesByUserId, createCheckout,
  updateProduct, setProductStripePriceId,
} from '../services/fees.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/fees.repository.js'

const APP    = 'aikikan'
const TENANT = '22222222-2222-2222-2222-222222222222'
const USER   = 'user-1'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({ query: vi.fn() }))
  global.fetch = vi.fn()
})

// ── listProducts ────────────────────────────────────────────────────

describe('listProducts', () => {
  it('tenantId vacío → ValidationError 422', async () => {
    await expect(listProducts(null)).rejects.toMatchObject({ statusCode: 422 })
  })
  it('happy', async () => {
    repo.listProducts.mockResolvedValue([{ code: 'matricula' }])
    const r = await listProducts(TENANT)
    expect(r).toHaveLength(1)
  })
})

// ── getMyFees / getFeesByUserId ──────────────────────────────────────

describe('getMyFees', () => {
  it('sin userId → Forbidden', async () => {
    await expect(getMyFees({})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('happy: marca paid=true cuando hay pago < 1 año', async () => {
    const now = Date.now()
    const sixMonthsAgo = new Date(now - 180 * 86400000).toISOString()
    repo.listProducts.mockResolvedValue([{ code: 'matricula' }, { code: 'anual' }])
    repo.listPaymentsForUser.mockResolvedValue([
      { id: 'p1', status: 'paid', product_codes: ['matricula'], paid_at: sixMonthsAgo },
    ])
    repo.findSubscriptionForUser.mockResolvedValue(null)
    const r = await getMyFees({ userId: USER, appId: APP, tenantId: TENANT, role: 'user' })
    expect(r.status.matricula.paid).toBe(true)
    expect(r.status.matricula.paymentId).toBe('p1')
    expect(r.status.anual.paid).toBe(false)
  })

  it('marca paid=false cuando el último paid es > 1 año', async () => {
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86400000).toISOString()
    repo.listProducts.mockResolvedValue([{ code: 'matricula' }])
    repo.listPaymentsForUser.mockResolvedValue([
      { id: 'p1', status: 'paid', product_codes: ['matricula'], paid_at: twoYearsAgo },
    ])
    repo.findSubscriptionForUser.mockResolvedValue(null)
    const r = await getMyFees({ userId: USER, appId: APP, tenantId: TENANT })
    expect(r.status.matricula.paid).toBe(false)
  })

  it('ignora pagos con status != paid', async () => {
    repo.listProducts.mockResolvedValue([{ code: 'matricula' }])
    repo.listPaymentsForUser.mockResolvedValue([
      { id: 'p1', status: 'pending', product_codes: ['matricula'], paid_at: new Date().toISOString() },
    ])
    repo.findSubscriptionForUser.mockResolvedValue(null)
    const r = await getMyFees({ userId: USER, appId: APP, tenantId: TENANT })
    expect(r.status.matricula.paid).toBe(false)
  })
})

describe('getFeesByUserId — admin guard', () => {
  it('rol "user" → Forbidden', async () => {
    await expect(getFeesByUserId(
      { userId: 'admin-1', appId: APP, tenantId: TENANT, role: 'user' }, USER,
    )).rejects.toMatchObject({ statusCode: 403 })
  })
  it('rol admin → OK', async () => {
    repo.listProducts.mockResolvedValue([])
    repo.listPaymentsForUser.mockResolvedValue([])
    repo.findSubscriptionForUser.mockResolvedValue(null)
    await expect(getFeesByUserId(
      { userId: 'a', appId: APP, tenantId: TENANT, role: 'admin' }, USER,
    )).resolves.toBeDefined()
  })
})

// ── createCheckout — validations ─────────────────────────────────────

describe('createCheckout validations', () => {
  const identity = { userId: USER, appId: APP, tenantId: TENANT, email: 'a@b.com', role: 'user' }

  it('codes vacío → ValidationError', async () => {
    await expect(createCheckout(identity, 'tok', { codes: [] }))
      .rejects.toMatchObject({ statusCode: 422 })
  })

  it('código no en catálogo → NotFoundError', async () => {
    repo.findProductsByCodes.mockResolvedValue([{ code: 'matricula', stripe_price_id: 'pr_1', amount_cents: 5000, currency: 'eur', kind: 'one_shot' }])
    await expect(createCheckout(identity, 'tok', { codes: ['matricula', 'ghost'] }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('producto sin stripe_price_id → AppError 503', async () => {
    repo.findProductsByCodes.mockResolvedValue([
      { code: 'anual', stripe_price_id: null, amount_cents: 5000, currency: 'eur', kind: 'one_shot' },
    ])
    await expect(createCheckout(identity, 'tok', { codes: ['anual'] }))
      .rejects.toMatchObject({ statusCode: 503, code: 'STRIPE_PRICE_MISSING' })
  })
})

// ── createCheckout — mode selection + splitpay call ─────────────────

describe('createCheckout — splitpay integration', () => {
  const identity = { userId: USER, appId: APP, tenantId: TENANT, email: 'a@b.com', role: 'user' }

  function mockProducts(products) {
    repo.findProductsByCodes.mockResolvedValue(products)
  }

  it('todos one_shot → mode="payment"', async () => {
    mockProducts([{ code: 'matricula', stripe_price_id: 'pr_1', amount_cents: 5000, currency: 'eur', kind: 'one_shot' }])
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ data: { url: 'http://stripe.test/sess', stripeSessionId: 'cs_test' } }),
    })
    await createCheckout(identity, 'tok', { codes: ['matricula'] })
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.mode).toBe('payment')
  })

  it('1+ recurring_annual → mode="subscription"', async () => {
    mockProducts([
      { code: 'matricula', stripe_price_id: 'pr_1', amount_cents: 5000, currency: 'eur', kind: 'one_shot' },
      { code: 'anual',     stripe_price_id: 'pr_2', amount_cents: 10000, currency: 'eur', kind: 'recurring_annual' },
    ])
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ data: { url: 'u', stripeSessionId: 'cs_test' } }),
    })
    await createCheckout(identity, 'tok', { codes: ['matricula', 'anual'] })
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.mode).toBe('subscription')
  })

  it('fetch lanza (red) → AppError 502 SPLITPAY_UNREACHABLE', async () => {
    mockProducts([{ code: 'matricula', stripe_price_id: 'pr_1', amount_cents: 5000, currency: 'eur', kind: 'one_shot' }])
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(createCheckout(identity, 'tok', { codes: ['matricula'] }))
      .rejects.toMatchObject({ statusCode: 502, code: 'SPLITPAY_UNREACHABLE' })
  })

  it('splitpay responde 400 → propaga code + status del json', async () => {
    mockProducts([{ code: 'matricula', stripe_price_id: 'pr_1', amount_cents: 5000, currency: 'eur', kind: 'one_shot' }])
    global.fetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => ({ error: { code: 'INVALID_PRICE', message: 'price not found' } }),
    })
    await expect(createCheckout(identity, 'tok', { codes: ['matricula'] }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PRICE' })
  })

  it('splitpay 200 sin url/stripeSessionId → 502 SPLITPAY_INVALID_RESPONSE', async () => {
    mockProducts([{ code: 'matricula', stripe_price_id: 'pr_1', amount_cents: 5000, currency: 'eur', kind: 'one_shot' }])
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: {} }) })
    await expect(createCheckout(identity, 'tok', { codes: ['matricula'] }))
      .rejects.toMatchObject({ statusCode: 502, code: 'SPLITPAY_INVALID_RESPONSE' })
  })

  it('happy: pre-registra payment con stripeSessionId + devuelve url', async () => {
    mockProducts([{ code: 'matricula', stripe_price_id: 'pr_1', amount_cents: 5000, currency: 'eur', kind: 'one_shot' }])
    global.fetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ data: { url: 'http://stripe.test/sess', stripeSessionId: 'cs_test_xyz' } }),
    })
    const r = await createCheckout(identity, 'tok', { codes: ['matricula'] })
    expect(r.sessionId).toBe('cs_test_xyz')
    expect(r.url).toBe('http://stripe.test/sess')
    expect(repo.insertPayment).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: USER, productCodes: ['matricula'], amountCents: 5000,
        stripeSessionId: 'cs_test_xyz',
      }),
    )
  })
})
