// splitpay-subscription.handler — subscriber Redis que sincroniza columnas
// subscription_* del tenant con los eventos splitpay.* (kind=platform_subscription).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({ env: { REDIS_URL: 'redis://localhost' } }))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const query = vi.hoisted(() => vi.fn())
const release = vi.hoisted(() => vi.fn())
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue({ query, release }) },
}))

let messageHandler, errorHandler, subscribeCb
const subscribe = vi.hoisted(() => vi.fn())
const connect = vi.hoisted(() => vi.fn())
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    connect: connect.mockResolvedValue(undefined),
    subscribe: (ch, cb) => { subscribeCb = cb; subscribe(ch, cb) },
    on: (ev, h) => { if (ev === 'message') messageHandler = h; if (ev === 'error') errorHandler = h },
  })),
}))

import { startSplitpaySubscriptionSubscriber } from '../events/splitpay-subscription.handler.js'
import { logger } from '../lib/logger.js'

beforeEach(() => {
  vi.clearAllMocks()
  query.mockResolvedValue({ rows: [] })
  connect.mockResolvedValue(undefined)
  startSplitpaySubscriptionSubscriber()
})

const emit = (event) => messageHandler('platform.events', JSON.stringify(event))
const subMeta = { metadata: { kind: 'platform_subscription' } }

describe('subscribe wiring', () => {
  it('subscribe callback con error → logger.error', () => {
    subscribeCb(new Error('sub fail'))
    expect(logger.error).toHaveBeenCalled()
  })

  it('subscribe callback OK → logger.info', () => {
    subscribeCb(null)
    expect(logger.info).toHaveBeenCalled()
  })

  it('error handler loguea', () => {
    errorHandler(new Error('boom'))
    expect(logger.error).toHaveBeenCalled()
  })

  it('connect rechaza → logger.error (catch)', async () => {
    connect.mockRejectedValueOnce(new Error('no connect'))
    startSplitpaySubscriptionSubscriber()
    await Promise.resolve()
    await Promise.resolve()
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('filtros de evento', () => {
  it('JSON malformado → no-op', async () => {
    await messageHandler('platform.events', '{bad')
    expect(query).not.toHaveBeenCalled()
  })

  it('sin kind=platform_subscription → ignora', async () => {
    await emit({ type: 'splitpay.checkout.completed', payload: { metadata: { kind: 'other' } } })
    expect(query).not.toHaveBeenCalled()
  })

  it('tipo desconocido → logger.debug', async () => {
    await emit({ type: 'splitpay.unknown', payload: { ...subMeta } })
    expect(logger.debug).toHaveBeenCalled()
  })

  it('handler lanza → logger.error', async () => {
    query.mockRejectedValue(new Error('db fail'))
    await emit({ type: 'splitpay.invoice.paid', payload: { ...subMeta, subscriptionId: 's1' } })
    expect(logger.error).toHaveBeenCalled()
  })
})

describe('onCheckoutCompleted', () => {
  it('mode != subscription → ignora', async () => {
    await emit({ type: 'splitpay.checkout.completed', payload: { ...subMeta, mode: 'payment' } })
    expect(query).not.toHaveBeenCalled()
  })

  it('sin tenant_id → warn', async () => {
    await emit({ type: 'splitpay.checkout.completed', payload: { metadata: { kind: 'platform_subscription' }, mode: 'subscription' } })
    expect(logger.warn).toHaveBeenCalled()
  })

  it('activa subscripción con period del tenant (annual)', async () => {
    query.mockResolvedValueOnce({ rows: [{ subscription_period: 'annual' }] })
    await emit({
      type: 'splitpay.checkout.completed',
      payload: { metadata: { kind: 'platform_subscription', tenant_id: 't1' }, mode: 'subscription', subscriptionId: 'sub_1', customerId: 'cus_1' },
    })
    const updateSql = query.mock.calls[1][0]
    expect(updateSql).toMatch(/subscription_status\s+= 'active'/)
    expect(query.mock.calls[1][1][0]).toBe('t1')
    expect(release).toHaveBeenCalled()
  })

  it('period default monthly cuando no hay row', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    await emit({
      type: 'splitpay.checkout.completed',
      payload: { metadata: { kind: 'platform_subscription', tenant_id: 't1' }, mode: 'subscription' },
    })
    expect(query).toHaveBeenCalledTimes(2)
  })
})

describe('onInvoicePaid / PaymentFailed', () => {
  it('paid sin subscriptionId → ignora', async () => {
    await emit({ type: 'splitpay.invoice.paid', payload: { ...subMeta } })
    expect(query).not.toHaveBeenCalled()
  })

  it('paid renueva con periodEnd', async () => {
    await emit({ type: 'splitpay.invoice.paid', payload: { ...subMeta, subscriptionId: 's1', periodEnd: '2026-07-01' } })
    expect(query.mock.calls[0][0]).toMatch(/subscription_status\s+= 'active'/)
  })

  it('paid sin periodEnd → param null', async () => {
    await emit({ type: 'splitpay.invoice.paid', payload: { ...subMeta, subscriptionId: 's1' } })
    expect(query.mock.calls[0][1][1]).toBeNull()
  })

  it('payment_failed → past_due', async () => {
    await emit({ type: 'splitpay.invoice.payment_failed', payload: { ...subMeta, subscriptionId: 's1' } })
    expect(query.mock.calls[0][0]).toMatch(/past_due/)
  })

  it('payment_failed sin subscriptionId → ignora', async () => {
    await emit({ type: 'splitpay.invoice.payment_failed', payload: { ...subMeta } })
    expect(query).not.toHaveBeenCalled()
  })
})

describe('onSubscriptionUpdated', () => {
  it('mapea status Stripe → local (trialing→trial)', async () => {
    await emit({ type: 'splitpay.subscription.updated', payload: { ...subMeta, subscriptionId: 's1', status: 'trialing', cancelAtPeriodEnd: true, currentPeriodEnd: '2026-08-01' } })
    expect(query.mock.calls[0][1][1]).toBe('trial')
    expect(query.mock.calls[0][1][2]).toBe(true)
  })

  it('status desconocido → localStatus null (COALESCE preserva)', async () => {
    await emit({ type: 'splitpay.subscription.updated', payload: { ...subMeta, subscriptionId: 's1', status: 'weird' } })
    expect(query.mock.calls[0][1][1]).toBeNull()
  })

  it('sin subscriptionId → ignora', async () => {
    await emit({ type: 'splitpay.subscription.updated', payload: { ...subMeta } })
    expect(query).not.toHaveBeenCalled()
  })
})

describe('onSubscriptionDeleted', () => {
  it('cancela', async () => {
    await emit({ type: 'splitpay.subscription.deleted', payload: { ...subMeta, subscriptionId: 's1' } })
    expect(query.mock.calls[0][0]).toMatch(/subscription_status = 'cancelled'/)
  })

  it('sin subscriptionId → ignora', async () => {
    await emit({ type: 'splitpay.subscription.deleted', payload: { ...subMeta } })
    expect(query).not.toHaveBeenCalled()
  })
})
