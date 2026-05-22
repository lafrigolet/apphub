// donation-subscriptions.service — listAdmin + cancel.
// Contrato:
//   listAdmin:
//     - identity sin userId → 403.
//     - role no admin → 403.
//     - admin → query all subscriptions ordered by created_at DESC.
//
//   cancel:
//     - identity sin userId → 403.
//     - subscription no existe → 404.
//     - non-admin que NO es donor_user_id → 403.
//     - donor que es dueño → permitido.
//     - admin → cualquiera del tenant.
//     - status='cancelled' → idempotent (return row sin tocar splitpay).
//     - splitpay 404 → CONTINÚA (Stripe sub ya borrada).
//     - splitpay 5xx/4xx other → propaga AppError con code+status.
//     - happy: optimistically marca cancelled localmente.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_CORE_BASE_URL: 'http://platform-core:3000',
  },
}))
vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(),
  withStaffBypass: vi.fn(),
}))
vi.mock('../repositories/donation-subscriptions.repository.js')

import { listAdmin, cancel } from '../services/donation-subscriptions.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/donation-subscriptions.repository.js'

const adminIdentity = {
  userId: 'admin-1', appId: 'aikikan', tenantId: 't1', subTenantId: null, role: 'admin',
}
const donorIdentity = {
  userId: 'donor-1', appId: 'aikikan', tenantId: 't1', subTenantId: null, role: 'user',
}
const SUB = 'sub-1'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_a, _t, _s, fn) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
  global.fetch = vi.fn()
})

// ── listAdmin ───────────────────────────────────────────────────────

describe('listAdmin', () => {
  it('sin userId → ForbiddenError', async () => {
    await expect(listAdmin({})).rejects.toMatchObject({ statusCode: 403 })
  })

  it('rol "user" → ForbiddenError', async () => {
    await expect(listAdmin(donorIdentity)).rejects.toMatchObject({
      statusCode: 403, message: expect.stringContaining('admin/staff'),
    })
  })

  it.each([['owner'], ['admin'], ['staff'], ['super_admin']])(
    'rol "%s" → permitido',
    async (role) => {
      await listAdmin({ ...adminIdentity, role })
      // Llegó a la query
      expect(withTenantTransaction).toHaveBeenCalled()
    },
  )

  it('SQL: ORDER BY created_at DESC (más recientes primero)', async () => {
    const fakeClient = { query: vi.fn().mockResolvedValue({ rows: [{ id: SUB }] }) }
    withTenantTransaction.mockImplementation(async (_a, _t, _s, fn) => fn(fakeClient))
    const r = await listAdmin(adminIdentity)
    expect(fakeClient.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC/)
    expect(r).toHaveLength(1)
  })
})

// ── cancel — guards ─────────────────────────────────────────────────

describe('cancel — guards', () => {
  it('sin userId → ForbiddenError', async () => {
    await expect(cancel({}, SUB)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('subscription no existe → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(cancel(adminIdentity, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('non-admin que NO es el donor → ForbiddenError', async () => {
    repo.findById.mockResolvedValue({ id: SUB, donor_user_id: 'someone-else', status: 'active' })
    await expect(cancel(donorIdentity, SUB)).rejects.toMatchObject({
      statusCode: 403, message: expect.stringContaining('cancelar'),
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('donor puede cancelar SU PROPIA subscription', async () => {
    repo.findById.mockResolvedValue({
      id: SUB, donor_user_id: 'donor-1', status: 'active',
      stripe_subscription_id: 'sub_xyz',
    })
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    repo.markCancelled.mockResolvedValue({ id: SUB, status: 'cancelled' })
    await cancel(donorIdentity, SUB)
    expect(global.fetch).toHaveBeenCalled()
  })

  it('admin puede cancelar la de OTRO', async () => {
    repo.findById.mockResolvedValue({
      id: SUB, donor_user_id: 'other-donor', status: 'active',
      stripe_subscription_id: 'sub_xyz',
    })
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    repo.markCancelled.mockResolvedValue({ id: SUB, status: 'cancelled' })
    await cancel(adminIdentity, SUB)
    expect(repo.markCancelled).toHaveBeenCalled()
  })
})

// ── cancel — idempotency + splitpay ────────────────────────────────

describe('cancel — idempotency + splitpay loopback', () => {
  it('status="cancelled" → idempotente, return row sin llamar splitpay', async () => {
    repo.findById.mockResolvedValue({
      id: SUB, donor_user_id: 'donor-1', status: 'cancelled',
    })
    const r = await cancel(donorIdentity, SUB)
    expect(r.status).toBe('cancelled')
    expect(global.fetch).not.toHaveBeenCalled()
    expect(repo.markCancelled).not.toHaveBeenCalled()
  })

  it('happy: POST a splitpay loopback con stripe_subscription_id', async () => {
    repo.findById.mockResolvedValue({
      id: SUB, donor_user_id: 'donor-1', status: 'active',
      stripe_subscription_id: 'sub_xyz',
    })
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    repo.markCancelled.mockResolvedValue({ id: SUB })
    await cancel(donorIdentity, SUB)
    expect(global.fetch).toHaveBeenCalledWith(
      'http://platform-core:3000/v1/splitpay/subscriptions/sub_xyz/cancel',
      { method: 'POST' },
    )
  })

  it('splitpay 404 → CONTINÚA (Stripe sub ya borrada — race con webhook)', async () => {
    repo.findById.mockResolvedValue({
      id: SUB, donor_user_id: 'donor-1', status: 'active',
      stripe_subscription_id: 'sub_xyz',
    })
    global.fetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    repo.markCancelled.mockResolvedValue({ id: SUB })
    await expect(cancel(donorIdentity, SUB)).resolves.toBeDefined()
    expect(repo.markCancelled).toHaveBeenCalled()
  })

  it('splitpay 5xx → propaga AppError con status', async () => {
    repo.findById.mockResolvedValue({
      id: SUB, donor_user_id: 'donor-1', status: 'active',
      stripe_subscription_id: 'sub_xyz',
    })
    global.fetch.mockResolvedValue({
      ok: false, status: 502,
      json: async () => ({ error: { code: 'STRIPE_DOWN', message: 'temporary' } }),
    })
    await expect(cancel(donorIdentity, SUB)).rejects.toMatchObject({
      statusCode: 502, code: 'STRIPE_DOWN',
    })
    expect(repo.markCancelled).not.toHaveBeenCalled()
  })

  it('happy: optimistamente marca cancelled localmente (no espera al webhook)', async () => {
    repo.findById.mockResolvedValue({
      id: SUB, donor_user_id: 'donor-1', status: 'active',
      stripe_subscription_id: 'sub_xyz',
    })
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    repo.markCancelled.mockResolvedValue({ id: SUB, status: 'cancelled' })
    const r = await cancel(donorIdentity, SUB)
    expect(repo.markCancelled).toHaveBeenCalledWith(expect.anything(), SUB)
    expect(r.status).toBe('cancelled')
  })

  it('splitpay 400 con json malformado → fallback CANCEL_FAILED + status del response', async () => {
    repo.findById.mockResolvedValue({
      id: SUB, donor_user_id: 'donor-1', status: 'active',
      stripe_subscription_id: 'sub_xyz',
    })
    global.fetch.mockResolvedValue({
      ok: false, status: 400,
      json: async () => { throw new Error('not json') },
    })
    await expect(cancel(donorIdentity, SUB)).rejects.toMatchObject({
      statusCode: 400, code: 'CANCEL_FAILED',
    })
  })
})
