import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../lib/db.js', () => ({
  withTenantTransaction: vi.fn(async (_a, _t, _s, fn) => fn({ query: vi.fn() })),
  pool: {}, configurePool: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn(), configureRedis: vi.fn(), subscribe: vi.fn() }))
vi.mock('../repositories/commerce.repository.js', () => ({
  insertCheckout: vi.fn(), getById: vi.fn(), linkTx: vi.fn(), findByTx: vi.fn(), markStatus: vi.fn(),
}))

import * as service from '../services/commerce.service.js'
import * as repo from '../repositories/commerce.repository.js'
import { publish } from '../lib/redis.js'

const scope = { appId: 'luciapassardi', tenantId: 't1', subTenantId: null }
const row = (over = {}) => ({
  id: 'co1', app_id: 'luciapassardi', tenant_id: 't1', sub_tenant_id: null, kind: 'package',
  ref_id: 'tpl-bono10', client_user_id: 'u1', amount_cents: 11000, currency: 'EUR',
  status: 'pending', provider_tx_id: null, fulfillment: null, ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('commerce.service — crearCheckout', () => {
  it('crea checkout pendiente y devuelve vista', async () => {
    repo.insertCheckout.mockResolvedValue(row())
    const r = await service.crearCheckout(scope, { kind: 'package', refId: 'tpl-bono10', amountCents: 11000, clientUserId: 'u1' })
    expect(r).toMatchObject({ id: 'co1', kind: 'package', refId: 'tpl-bono10', status: 'pending', amountCents: 11000 })
  })
  it('kind inválido → error', async () => {
    await expect(service.crearCheckout(scope, { kind: 'x', refId: 'a', amountCents: 1 })).rejects.toMatchObject({ code: 'KIND_INVALIDO' })
  })
  it('importe inválido → error', async () => {
    await expect(service.crearCheckout(scope, { kind: 'package', refId: 'a', amountCents: 0 })).rejects.toMatchObject({ code: 'IMPORTE_INVALIDO' })
  })
})

describe('commerce.service — handlePaymentEvent', () => {
  it('payment.succeeded con checkout pendiente → paid + publica commerce.purchase.paid', async () => {
    repo.findByTx.mockResolvedValue(row())
    repo.markStatus.mockResolvedValue(row({ status: 'paid' }))
    await service.handlePaymentEvent({ type: 'payment.succeeded', payload: { appId: 'luciapassardi', tenantId: 't1', transactionId: 'tx1' } })
    expect(repo.markStatus).toHaveBeenCalledWith(expect.anything(), 'co1', 'paid')
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'commerce.purchase.paid',
      payload: expect.objectContaining({ checkoutId: 'co1', kind: 'package', refId: 'tpl-bono10', clientUserId: 'u1', amountCents: 11000 }),
    }))
  })

  it('checkout ya no pendiente → no publica (idempotente)', async () => {
    repo.findByTx.mockResolvedValue(row({ status: 'paid' }))
    await service.handlePaymentEvent({ type: 'payment.succeeded', payload: { appId: 'luciapassardi', tenantId: 't1', transactionId: 'tx1' } })
    expect(publish).not.toHaveBeenCalled()
  })

  it('payment.failed → marca failed, no publica', async () => {
    repo.findByTx.mockResolvedValue(row())
    await service.handlePaymentEvent({ type: 'payment.failed', payload: { appId: 'luciapassardi', tenantId: 't1', transactionId: 'tx1' } })
    expect(repo.markStatus).toHaveBeenCalledWith(expect.anything(), 'co1', 'failed')
    expect(publish).not.toHaveBeenCalled()
  })

  it('sin transactionId → no-op', async () => {
    await service.handlePaymentEvent({ type: 'payment.succeeded', payload: { appId: 'luciapassardi', tenantId: 't1' } })
    expect(repo.findByTx).not.toHaveBeenCalled()
  })
})
