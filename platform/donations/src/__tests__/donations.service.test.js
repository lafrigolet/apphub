import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ───────────────────────────────────────────────────────────────
// Stub client returned by withTenantTransaction. Tests override
// .query.mockImplementation per scenario.
const stubClient = { query: vi.fn() }

vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(async (_app, _t, _s, fn) => fn(stubClient)),
  withStaffBypass:        vi.fn(async (fn) => fn(stubClient)),
}))

vi.mock('../lib/env.js', () => ({
  env: { PLATFORM_CORE_BASE_URL: 'http://platform-core:3000' },
}))

vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Repos — we control return values per test.
vi.mock('../repositories/donations.repository.js', () => ({
  insert:         vi.fn(),
  findById:       vi.fn(),
  attachSession:  vi.fn(),
  markPaid:       vi.fn(),
  markRefunded:   vi.fn(),
  listForDonor:   vi.fn(),
  listAdmin:      vi.fn(),
}))
vi.mock('../repositories/causes.repository.js', () => ({
  findById:        vi.fn(),
  incrementRaised: vi.fn(),
}))
vi.mock('../repositories/donation-subscriptions.repository.js', () => ({
  listForDonor: vi.fn(),
}))

import * as service from '../services/donations.service.js'
import * as donRepo from '../repositories/donations.repository.js'
import * as causesRepo from '../repositories/causes.repository.js'

// Captured fetch calls so we can assert the loopback to splitpay.
let fetchSpy
beforeEach(() => {
  vi.clearAllMocks()
  fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: { sessionId: 'cs_test_123', url: 'https://stripe.test/sess' } }),
  })
  globalThis.fetch = fetchSpy
})

const APP    = 'aikikan'
const TENANT = '30000000-0000-0000-0000-000000000001'

const baseInput = {
  appId: APP,
  tenantId: TENANT,
  amountCents: 2500,
  currency: 'EUR',
  donorEmail: 'donor@example.org',
  kind: 'one_shot',
  successUrl: 'http://x/ok',
  cancelUrl:  'http://x/no',
}

describe('createCheckout — validación', () => {
  it('rechaza amountCents < 100 (1€ mínimo)', async () => {
    await expect(service.createCheckout({ ...baseInput, amountCents: 50 })).rejects.toThrow()
  })
  it('rechaza kind desconocido', async () => {
    await expect(service.createCheckout({ ...baseInput, kind: 'tarjeta_regalo' })).rejects.toThrow()
  })
  it('rechaza si falta donorEmail', async () => {
    const { donorEmail, ...rest } = baseInput
    await expect(service.createCheckout(rest)).rejects.toThrow()
  })
  it('rechaza si falta successUrl o cancelUrl', async () => {
    await expect(service.createCheckout({ ...baseInput, successUrl: undefined })).rejects.toThrow()
  })
})

describe('createCheckout — flujo one_shot', () => {
  it('inserta row pending → llama splitpay con mode=payment → adjunta sessionId', async () => {
    donRepo.insert.mockResolvedValue({ id: 'd-1', app_id: APP, tenant_id: TENANT })
    donRepo.attachSession.mockResolvedValue({ id: 'd-1', stripe_session_id: 'cs_test_123' })

    const r = await service.createCheckout(baseInput)

    expect(donRepo.insert).toHaveBeenCalledWith(
      stubClient,
      expect.objectContaining({ status: 'pending', kind: 'one_shot', amountCents: 2500 }),
    )

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://platform-core:3000/v1/splitpay/checkout-sessions')
    const body = JSON.parse(opts.body)
    expect(body.mode).toBe('payment')
    expect(body.metadata.purpose).toBe('donation')
    expect(body.metadata.donation_id).toBe('d-1')
    expect(body.metadata.app_id).toBe(APP)
    expect(body.lineItems[0].price_data.unit_amount).toBe(2500)
    expect(body.lineItems[0].price_data.recurring).toBeUndefined()

    expect(donRepo.attachSession).toHaveBeenCalledWith(stubClient, 'd-1', 'cs_test_123')
    expect(r).toEqual({ sessionUrl: 'https://stripe.test/sess', donationId: 'd-1' })
  })

  it('propaga el Bearer del caller si lo hay (Authorization header)', async () => {
    donRepo.insert.mockResolvedValue({ id: 'd-2' })
    donRepo.attachSession.mockResolvedValue({ id: 'd-2' })

    await service.createCheckout(baseInput, { bearerToken: 'eyJzm.fake.token' })

    const headers = fetchSpy.mock.calls[0][1].headers
    expect(headers.Authorization).toBe('Bearer eyJzm.fake.token')
  })

  it('NO añade Authorization si no hay bearer (caso público sin login)', async () => {
    donRepo.insert.mockResolvedValue({ id: 'd-3' })
    donRepo.attachSession.mockResolvedValue({ id: 'd-3' })

    await service.createCheckout(baseInput)

    const headers = fetchSpy.mock.calls[0][1].headers
    expect(headers.Authorization).toBeUndefined()
  })
})

describe('createCheckout — flujo recurring_monthly', () => {
  it('llama splitpay con mode=subscription y price_data.recurring.interval=month', async () => {
    donRepo.insert.mockResolvedValue({ id: 'd-r1' })
    donRepo.attachSession.mockResolvedValue({ id: 'd-r1' })

    await service.createCheckout({ ...baseInput, kind: 'recurring_monthly', amountCents: 1000 })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.mode).toBe('subscription')
    expect(body.lineItems[0].price_data.recurring).toEqual({ interval: 'month' })
    expect(body.lineItems[0].price_data.unit_amount).toBe(1000)
  })
})

describe('createCheckout — formas de respuesta de splitpay', () => {
  it('session plano sin .data → usa json directo y session.id como sessionId', async () => {
    donRepo.insert.mockResolvedValue({ id: 'd-flat' })
    donRepo.attachSession.mockResolvedValue({ id: 'd-flat' })
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      // json SIN .data → rama `?? json`; sin stripeSessionId/sessionId → rama `?? session.id`
      json: async () => ({ id: 'cs_flat_1', url: 'https://stripe.test/flat' }),
    })

    const r = await service.createCheckout(baseInput)

    expect(donRepo.attachSession).toHaveBeenCalledWith(stubClient, 'd-flat', 'cs_flat_1')
    expect(r).toEqual({ sessionUrl: 'https://stripe.test/flat', donationId: 'd-flat' })
  })

  it('usa session.stripeSessionId con preferencia sobre sessionId/id', async () => {
    donRepo.insert.mockResolvedValue({ id: 'd-strp' })
    donRepo.attachSession.mockResolvedValue({ id: 'd-strp' })
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { stripeSessionId: 'cs_strp_1', sessionId: 'ignored', id: 'ignored2', url: 'u' } }),
    })

    await service.createCheckout(baseInput)
    expect(donRepo.attachSession).toHaveBeenCalledWith(stubClient, 'd-strp', 'cs_strp_1')
  })
})

describe('createCheckout — error de splitpay', () => {
  it('propaga SPLITPAY_ERROR cuando splitpay devuelve 4xx', async () => {
    donRepo.insert.mockResolvedValue({ id: 'd-4' })
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: { code: 'STRIPE_VALIDATION', message: 'Importe inválido' } }),
    })
    await expect(service.createCheckout(baseInput)).rejects.toMatchObject({
      code: 'STRIPE_VALIDATION',
      statusCode: 422,
    })
  })

  it('usa fallbacks SPLITPAY_ERROR / mensaje genérico cuando el json no trae error', async () => {
    donRepo.insert.mockResolvedValue({ id: 'd-4b' })
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({}),   // sin .error → ramas `?? 'SPLITPAY_ERROR'` y `?? 'No se pudo...'`
    })
    await expect(service.createCheckout(baseInput)).rejects.toMatchObject({
      code: 'SPLITPAY_ERROR',
      statusCode: 400,
      message: 'No se pudo crear la sesión de pago',
    })
  })

  it('propaga SPLITPAY_UNREACHABLE 502 cuando el fetch falla por red', async () => {
    donRepo.insert.mockResolvedValue({ id: 'd-5' })
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(service.createCheckout(baseInput)).rejects.toMatchObject({
      code: 'SPLITPAY_UNREACHABLE',
      statusCode: 502,
    })
  })
})

describe('createCheckout — causes', () => {
  it('valida que la cause existe y está activa', async () => {
    causesRepo.findById.mockResolvedValueOnce(null)
    await expect(service.createCheckout({ ...baseInput, causeId: 'no-existe' })).rejects.toThrow()
  })

  it('rechaza con ConflictError si la cause está inactiva', async () => {
    causesRepo.findById.mockResolvedValueOnce({ id: 'c1', active: false, name: 'X' })
    await expect(service.createCheckout({ ...baseInput, causeId: 'c1' })).rejects.toMatchObject({
      statusCode: 409,
    })
  })

  it('incluye cause_id en metadata cuando se pasa', async () => {
    causesRepo.findById.mockResolvedValueOnce({ id: 'c1', active: true, name: 'Tatami 2026' })
    donRepo.insert.mockResolvedValue({ id: 'd-c1' })
    donRepo.attachSession.mockResolvedValue({ id: 'd-c1' })

    await service.createCheckout({ ...baseInput, causeId: 'c1' })

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body)
    expect(body.metadata.cause_id).toBe('c1')
    expect(body.lineItems[0].price_data.product_data.name).toBe('Donación — Tatami 2026')
  })
})

// ── refund ──────────────────────────────────────────────────────────────

describe('refund', () => {
  const adminIdentity = { userId: 'u1', role: 'admin', appId: APP, tenantId: TENANT }
  const donorIdentity = { userId: 'u1', role: 'user',  appId: APP, tenantId: TENANT }

  it('rechaza si el caller no es admin', async () => {
    await expect(
      service.refund(donorIdentity, 'd-1', { idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rechaza si falta idempotencyKey', async () => {
    await expect(
      service.refund(adminIdentity, 'd-1', {}),
    ).rejects.toThrow()
  })

  it('rechaza si la donación no está en status=paid', async () => {
    donRepo.findById.mockResolvedValue({ id: 'd-1', status: 'pending', stripe_payment_intent_id: 'pi_x' })
    await expect(
      service.refund(adminIdentity, 'd-1', { idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })

  it('llama a splitpay payments/:id/refunds con idempotencyKey y decrementa raised_cents', async () => {
    donRepo.findById.mockResolvedValue({
      id: 'd-1', status: 'paid', stripe_payment_intent_id: 'pi_abc',
      cause_id: 'c1', amount_cents: 5000,
    })
    donRepo.markRefunded.mockResolvedValue({ id: 'd-1', status: 'refunded' })

    await service.refund(adminIdentity, 'd-1', { idempotencyKey: 'idem-1', reason: 'duplicate' })

    const [url, opts] = fetchSpy.mock.calls[0]
    expect(url).toBe('http://platform-core:3000/v1/payments/pi_abc/refunds')
    expect(JSON.parse(opts.body)).toEqual({ reason: 'duplicate', idempotencyKey: 'idem-1' })
    // Regla CLAUDE.md #6: refund proporcional — aquí lo modelamos como un
    // decremento del raised_cents igual al amount original (refund total V1).
    expect(causesRepo.incrementRaised).toHaveBeenCalledWith(stubClient, 'c1', -5000)
  })

  it('NO decrementa raised_cents si la donación no tenía cause asignada', async () => {
    donRepo.findById.mockResolvedValue({
      id: 'd-2', status: 'paid', stripe_payment_intent_id: 'pi_y',
      cause_id: null, amount_cents: 3000,
    })
    donRepo.markRefunded.mockResolvedValue({ id: 'd-2', status: 'refunded' })

    await service.refund(adminIdentity, 'd-2', { idempotencyKey: 'idem-2' })

    expect(causesRepo.incrementRaised).not.toHaveBeenCalled()
  })
})

// ── lectura — donor vs admin ────────────────────────────────────────────

describe('getDonation — autorización', () => {
  it('admin puede leer cualquier donación del tenant', async () => {
    donRepo.findById.mockResolvedValue({ id: 'd-9', donor_user_id: 'otherUser' })
    const r = await service.getDonation(
      { userId: 'admin1', role: 'admin', appId: APP, tenantId: TENANT },
      'd-9',
    )
    expect(r.id).toBe('d-9')
  })

  it('el donante puede leer su propia donación', async () => {
    donRepo.findById.mockResolvedValue({ id: 'd-9', donor_user_id: 'u1' })
    const r = await service.getDonation(
      { userId: 'u1', role: 'user', appId: APP, tenantId: TENANT },
      'd-9',
    )
    expect(r.id).toBe('d-9')
  })

  it('un usuario NO puede leer la donación de otro', async () => {
    donRepo.findById.mockResolvedValue({ id: 'd-9', donor_user_id: 'otherUser' })
    await expect(
      service.getDonation(
        { userId: 'u1', role: 'user', appId: APP, tenantId: TENANT },
        'd-9',
      ),
    ).rejects.toMatchObject({ statusCode: 403 })
  })

  it('donación inexistente → NotFound', async () => {
    donRepo.findById.mockResolvedValue(null)
    await expect(
      service.getDonation({ userId: 'u1', role: 'admin', appId: APP, tenantId: TENANT }, 'ghost'),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('sin userId → Forbidden', async () => {
    await expect(service.getDonation({}, 'd-9')).rejects.toMatchObject({ statusCode: 403 })
  })
})

// ── refund — ramas restantes ────────────────────────────────────────────

describe('refund — guards adicionales', () => {
  const admin = { userId: 'u1', role: 'admin', appId: APP, tenantId: TENANT }

  it('donación inexistente → NotFound', async () => {
    donRepo.findById.mockResolvedValue(null)
    await expect(service.refund(admin, 'ghost', { idempotencyKey: 'k' }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('sin stripe_payment_intent_id → Conflict', async () => {
    donRepo.findById.mockResolvedValue({ id: 'd', status: 'paid', stripe_payment_intent_id: null })
    await expect(service.refund(admin, 'd', { idempotencyKey: 'k' }))
      .rejects.toMatchObject({ statusCode: 409 })
  })

  it('splitpay refund error → propaga AppError con status del response', async () => {
    donRepo.findById.mockResolvedValue({
      id: 'd', status: 'paid', stripe_payment_intent_id: 'pi_x', cause_id: null, amount_cents: 100,
    })
    fetchSpy.mockResolvedValue({
      ok: false, status: 422,
      json: async () => ({ error: { code: 'REFUND_DENIED', message: 'nope' } }),
    })
    await expect(service.refund(admin, 'd', { idempotencyKey: 'k' }))
      .rejects.toMatchObject({ statusCode: 422, code: 'REFUND_DENIED' })
  })

  it('splitpay error con json malformado → fallback REFUND_ERROR', async () => {
    donRepo.findById.mockResolvedValue({
      id: 'd', status: 'paid', stripe_payment_intent_id: 'pi_x', cause_id: null, amount_cents: 100,
    })
    fetchSpy.mockResolvedValue({
      ok: false, status: 500,
      json: async () => { throw new Error('bad json') },
    })
    await expect(service.refund(admin, 'd', { idempotencyKey: 'k' }))
      .rejects.toMatchObject({ statusCode: 500, code: 'REFUND_ERROR' })
  })
})

// ── lecturas simples ────────────────────────────────────────────────────

describe('listMyDonations / listMySubscriptions / listAdminDonations', () => {
  const user  = { userId: 'u1', role: 'user',  appId: APP, tenantId: TENANT }
  const admin = { userId: 'a1', role: 'admin', appId: APP, tenantId: TENANT }

  it('listMyDonations sin userId → Forbidden', async () => {
    await expect(service.listMyDonations({})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('listMyDonations delega a repo.listForDonor', async () => {
    donRepo.listForDonor.mockResolvedValue([{ id: 'd1' }])
    const r = await service.listMyDonations(user)
    expect(r).toEqual([{ id: 'd1' }])
    expect(donRepo.listForDonor).toHaveBeenCalledWith(stubClient, 'u1')
  })

  it('listMySubscriptions sin userId → Forbidden', async () => {
    await expect(service.listMySubscriptions({})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('listMySubscriptions delega a subsRepo.listForDonor', async () => {
    const { listForDonor } = await import('../repositories/donation-subscriptions.repository.js')
    listForDonor.mockResolvedValue([{ id: 's1' }])
    const r = await service.listMySubscriptions(user)
    expect(r).toEqual([{ id: 's1' }])
  })

  it('listAdminDonations rechaza al user normal', async () => {
    await expect(service.listAdminDonations(user, {})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('listAdminDonations admin → repo.listAdmin con filtros', async () => {
    donRepo.listAdmin.mockResolvedValue([{ id: 'd1' }])
    const r = await service.listAdminDonations(admin, { status: 'paid' })
    expect(r).toEqual([{ id: 'd1' }])
    expect(donRepo.listAdmin).toHaveBeenCalledWith(stubClient, { status: 'paid' })
  })
})
