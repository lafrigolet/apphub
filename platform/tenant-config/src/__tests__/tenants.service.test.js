// tenants.service — CRUD de tenants + provisioning NGINX best-effort +
// flujo de checkout de subscripción vía splitpay.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTransaction: vi.fn() }))
vi.mock('../services/nginx-config.service.js', () => ({
  writeTenantNginxConfig: vi.fn().mockResolvedValue(undefined),
  deleteTenantNginxConfig: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../repositories/tenants.repository.js')
vi.mock('../repositories/apps.repository.js')
vi.mock('../repositories/audit.repository.js')

import {
  listTenants, getTenant, createTenant, backfillTenantNginxConfigs,
  getTenantBySubdomain, setTenantStatus, getTenantSubscription,
  startSubscriptionCheckout, updateTenant,
} from '../services/tenants.service.js'
import { withTransaction } from '../lib/db.js'
import { writeTenantNginxConfig } from '../services/nginx-config.service.js'
import * as tenantsRepo from '../repositories/tenants.repository.js'
import * as appsRepo from '../repositories/apps.repository.js'
import * as auditRepo from '../repositories/audit.repository.js'
import { logger } from '../lib/logger.js'

const actor = { userId: 'u1', role: 'staff', ip: '1.2.3.4' }

beforeEach(() => {
  vi.clearAllMocks()
  withTransaction.mockImplementation(async (_p, fn) => fn({}))
})

describe('listTenants / getTenant', () => {
  it('listTenants delega en findAll', async () => {
    tenantsRepo.findAll.mockResolvedValue([{ id: 't1' }])
    expect(await listTenants('a')).toEqual([{ id: 't1' }])
    expect(tenantsRepo.findAll).toHaveBeenCalledWith({}, 'a')
  })

  it('getTenant → 404 si no existe', async () => {
    tenantsRepo.findById.mockResolvedValue(null)
    await expect(getTenant('x')).rejects.toThrow(/Tenant/)
  })

  it('getTenant → row', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1' })
    expect(await getTenant('t1')).toEqual({ id: 't1' })
  })
})

describe('createTenant', () => {
  beforeEach(() => {
    appsRepo.findByAppId.mockResolvedValue({ app_id: 'aikikan' })
    tenantsRepo.create.mockResolvedValue({ id: 't1', display_name: 'Dojo', subdomain: 'dojo' })
  })

  it('crea + audita + provisiona nginx', async () => {
    const t = await createTenant({ appId: 'aikikan', displayName: 'Dojo', subdomain: 'dojo' }, actor)
    expect(t.id).toBe('t1')
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'TENANT_CREATED' }))
    expect(writeTenantNginxConfig).toHaveBeenCalledWith({ tenantId: 't1', subdomain: 'dojo' })
  })

  it('app inexistente → NotFoundError', async () => {
    appsRepo.findByAppId.mockResolvedValue(null)
    await expect(createTenant({ appId: 'x', displayName: 'D', subdomain: 's' }, actor)).rejects.toThrow(/App/)
  })

  it('subdomain duplicado (23505) → ConflictError', async () => {
    withTransaction.mockImplementation(async () => { throw Object.assign(new Error(), { code: '23505' }) })
    await expect(createTenant({ appId: 'a', displayName: 'D', subdomain: 's' }, actor)).rejects.toThrow(/subdomain already exists/)
  })

  it('FK violation (23503) → NotFoundError App', async () => {
    withTransaction.mockImplementation(async () => { throw Object.assign(new Error(), { code: '23503' }) })
    await expect(createTenant({ appId: 'a', displayName: 'D', subdomain: 's' }, actor)).rejects.toThrow(/App/)
  })

  it('otro error → re-lanza', async () => {
    withTransaction.mockImplementation(async () => { throw new Error('boom') })
    await expect(createTenant({ appId: 'a', displayName: 'D', subdomain: 's' }, actor)).rejects.toThrow('boom')
  })

  it('nginx falla → warn pero tenant devuelto', async () => {
    writeTenantNginxConfig.mockRejectedValueOnce(new Error('redis down'))
    const t = await createTenant({ appId: 'a', displayName: 'D', subdomain: 's' }, actor)
    expect(t.id).toBe('t1')
    expect(logger.warn).toHaveBeenCalled()
  })

  it('actor ausente → defaults null', async () => {
    await createTenant({ appId: 'a', displayName: 'D', subdomain: 's' })
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorUserId: null }))
  })
})

describe('backfillTenantNginxConfigs', () => {
  it('reescribe configs de tenants activos con subdomain', async () => {
    tenantsRepo.findAllActive.mockResolvedValue([
      { id: 't1', subdomain: 'a' }, { id: 't2', subdomain: null }, { id: 't3', subdomain: 'c' },
    ])
    const n = await backfillTenantNginxConfigs()
    expect(n).toBe(2) // t2 sin subdomain se salta
  })

  it('error en una config → warn y continúa', async () => {
    tenantsRepo.findAllActive.mockResolvedValue([{ id: 't1', subdomain: 'a' }])
    writeTenantNginxConfig.mockRejectedValueOnce(new Error('x'))
    const n = await backfillTenantNginxConfigs()
    expect(n).toBe(0)
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('getTenantBySubdomain', () => {
  it('404 si no existe', async () => {
    tenantsRepo.findBySubdomain.mockResolvedValue(null)
    await expect(getTenantBySubdomain('x')).rejects.toThrow(/Tenant/)
  })

  it('mapea a vista pública', async () => {
    tenantsRepo.findBySubdomain.mockResolvedValue({ id: 't1', app_id: 'a', display_name: 'Dojo', status: 'active' })
    expect(await getTenantBySubdomain('dojo')).toEqual({ tenantId: 't1', appId: 'a', displayName: 'Dojo', status: 'active' })
  })
})

describe('setTenantStatus', () => {
  it('suspended → reason + audit TENANT_SUSPENDED', async () => {
    tenantsRepo.updateStatus.mockResolvedValue({ id: 't1', app_id: 'a' })
    await setTenantStatus('t1', { status: 'suspended', reason: 'abuse' }, actor)
    expect(tenantsRepo.updateStatus).toHaveBeenCalledWith(expect.anything(), 't1', expect.objectContaining({ suspendReason: 'abuse' }))
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'TENANT_SUSPENDED' }))
  })

  it('archived → archivedAt set', async () => {
    tenantsRepo.updateStatus.mockResolvedValue({ id: 't1', app_id: 'a' })
    await setTenantStatus('t1', { status: 'archived' }, actor)
    const arg = tenantsRepo.updateStatus.mock.calls[0][2]
    expect(arg.archivedAt).toBeInstanceOf(Date)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'TENANT_ARCHIVED' }))
  })

  it('active → TENANT_REACTIVATED', async () => {
    tenantsRepo.updateStatus.mockResolvedValue({ id: 't1', app_id: 'a' })
    await setTenantStatus('t1', { status: 'active' }, actor)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'TENANT_REACTIVATED' }))
  })

  it('status desconocido → TENANT_STATUS_CHANGED', async () => {
    tenantsRepo.updateStatus.mockResolvedValue({ id: 't1', app_id: 'a' })
    await setTenantStatus('t1', { status: 'weird' }, actor)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'TENANT_STATUS_CHANGED' }))
  })

  it('suspended sin reason → reason ?? null (suspendReason null)', async () => {
    tenantsRepo.updateStatus.mockResolvedValue({ id: 't1', app_id: 'a' })
    await setTenantStatus('t1', { status: 'suspended' }, actor)
    expect(tenantsRepo.updateStatus).toHaveBeenCalledWith(expect.anything(), 't1', expect.objectContaining({ suspendReason: null }))
  })

  it('actor undefined → audit con nulls (ramas actor?.x ?? null)', async () => {
    tenantsRepo.updateStatus.mockResolvedValue({ id: 't1', app_id: 'a' })
    await setTenantStatus('t1', { status: 'active' }, undefined)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUserId: null, actorRole: null, ip: null,
    }))
  })

  it('no existe → 404', async () => {
    tenantsRepo.updateStatus.mockResolvedValue(null)
    await expect(setTenantStatus('x', { status: 'active' }, actor)).rejects.toThrow(/Tenant/)
  })
})

describe('getTenantSubscription', () => {
  it('expone booleans configured sin price_id', async () => {
    tenantsRepo.findById.mockResolvedValue({
      id: 't1', app_id: 'a', display_name: 'D',
      subscription_stripe_price_id: 'price_1', subscription_stripe_subscription_id: null,
    })
    const r = await getTenantSubscription('t1')
    expect(r.priceConfigured).toBe(true)
    expect(r.stripeSubscriptionLinked).toBe(false)
    expect(r).not.toHaveProperty('subscription_stripe_price_id')
  })
})

describe('startSubscriptionCheckout', () => {
  const identity = { tenantId: 't1', role: 'owner', email: 'o@x.com' }
  const tenant = {
    id: 't1', app_id: 'a', display_name: 'D',
    subscription_stripe_price_id: 'price_1', subscription_currency: 'EUR', subscription_billing_email: 'bill@x',
  }

  beforeEach(() => { tenantsRepo.findById.mockResolvedValue(tenant) })

  it('owner del tenant + price configurado → devuelve url/sessionId', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { url: 'http://cs', stripeSessionId: 'cs_1' } }) })
    const r = await startSubscriptionCheckout('t1', identity, 'jwt', { returnUrl: 'http://back' })
    expect(r).toEqual({ url: 'http://cs', sessionId: 'cs_1' })
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.metadata.kind).toBe('platform_subscription')
  })

  it('otro tenant → Forbidden', async () => {
    await expect(startSubscriptionCheckout('t1', { tenantId: 'other', role: 'owner' }, 'j', { returnUrl: 'r' }))
      .rejects.toThrow(/otro tenant/)
  })

  it('rol no owner/admin → Forbidden', async () => {
    await expect(startSubscriptionCheckout('t1', { tenantId: 't1', role: 'user' }, 'j', { returnUrl: 'r' }))
      .rejects.toThrow(/owner o admin/)
  })

  it('sin price_id → SUBSCRIPTION_NOT_CONFIGURED 409', async () => {
    tenantsRepo.findById.mockResolvedValue({ ...tenant, subscription_stripe_price_id: null })
    await expect(startSubscriptionCheckout('t1', identity, 'j', { returnUrl: 'r' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('splitpay inalcanzable (fetch throws) → 502', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('econn'))
    await expect(startSubscriptionCheckout('t1', identity, 'j', { returnUrl: 'r' })).rejects.toMatchObject({ statusCode: 502 })
  })

  it('splitpay !ok → propaga código/status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 'X', message: 'bad' } }) })
    await expect(startSubscriptionCheckout('t1', identity, 'j', { returnUrl: 'r' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('splitpay !ok sin error.code → defaults SPLITPAY_ERROR', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    await expect(startSubscriptionCheckout('t1', identity, 'j', { returnUrl: 'r' })).rejects.toMatchObject({ code: 'SPLITPAY_ERROR' })
  })

  it('respeta SPLITPAY_BASE_URL del entorno', async () => {
    const prev = process.env.SPLITPAY_BASE_URL
    process.env.SPLITPAY_BASE_URL = 'http://custom:9000'
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { url: 'u', stripeSessionId: 's' } }) })
    await startSubscriptionCheckout('t1', identity, 'j', { returnUrl: 'r' })
    expect(global.fetch.mock.calls[0][0]).toMatch(/^http:\/\/custom:9000/)
    if (prev === undefined) delete process.env.SPLITPAY_BASE_URL; else process.env.SPLITPAY_BASE_URL = prev
  })

  it('respuesta sin url/sessionId → 502 INVALID_RESPONSE', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) })
    await expect(startSubscriptionCheckout('t1', identity, 'j', { returnUrl: 'r' })).rejects.toMatchObject({ statusCode: 502 })
  })

  it('respuesta ok sin data → json.data ?? {} → 502 INVALID_RESPONSE', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    await expect(startSubscriptionCheckout('t1', identity, 'j', { returnUrl: 'r' })).rejects.toMatchObject({ statusCode: 502 })
  })

  it('usa identity.email cuando no hay billing_email, y currency default eur', async () => {
    tenantsRepo.findById.mockResolvedValue({ ...tenant, subscription_billing_email: null, subscription_currency: null })
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { url: 'u', stripeSessionId: 's' } }) })
    await startSubscriptionCheckout('t1', identity, 'j', { returnUrl: 'r' })
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.customerEmail).toBe('o@x.com')
    expect(body.currency).toBe('eur')
  })
})

describe('updateTenant', () => {
  it('actualiza + audita campos cambiados', async () => {
    tenantsRepo.update.mockResolvedValue({ id: 't1', app_id: 'a' })
    await updateTenant('t1', { displayName: 'New', plan: undefined }, actor)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'TENANT_UPDATED', detail: 'Updated: displayName' }))
  })

  it('actor undefined → audit con nulls (ramas actor?.x ?? null)', async () => {
    tenantsRepo.update.mockResolvedValue({ id: 't1', app_id: 'a' })
    await updateTenant('t1', { displayName: 'New' }, undefined)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUserId: null, actorRole: null, ip: null,
    }))
  })

  it('no existe → 404', async () => {
    tenantsRepo.update.mockResolvedValue(null)
    await expect(updateTenant('x', { displayName: 'N' }, actor)).rejects.toThrow(/Tenant/)
  })
})
