// bootstrap.service — alta atómica de tenant + owner (vía auth /internal),
// magic-link, compensación en fallo, reenvío, revocación y estado derivado.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    PLATFORM_CORE_URL: 'http://platform-core.hulkstein.local:3000',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const dbQuery = vi.hoisted(() => vi.fn())
vi.mock('../lib/db.js', () => ({ pool: {}, withTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ redis: {} }))
const sdkPublish = vi.hoisted(() => vi.fn())
vi.mock('@apphub/platform-sdk/redis', () => ({ publish: sdkPublish }))
vi.mock('../services/nginx-config.service.js', () => ({
  writeAppNginxConfig: vi.fn(), writeTenantNginxConfig: vi.fn(),
  deleteTenantNginxConfig: vi.fn(), deleteAppNginxConfig: vi.fn(),
}))
vi.mock('../repositories/apps.repository.js')
vi.mock('../repositories/tenants.repository.js')
vi.mock('../repositories/audit.repository.js')

import {
  bootstrapTenant, resendActivation, listPendingTenants, revokeBootstrap, getBootstrapStatus,
} from '../services/bootstrap.service.js'
import { withTransaction } from '../lib/db.js'
import * as appsRepo from '../repositories/apps.repository.js'
import * as tenantsRepo from '../repositories/tenants.repository.js'
import * as auditRepo from '../repositories/audit.repository.js'
import { writeAppNginxConfig, writeTenantNginxConfig, deleteTenantNginxConfig } from '../services/nginx-config.service.js'
import { logger } from '../lib/logger.js'

const actor = { userId: 'u1', role: 'staff', ip: '1.2.3.4' }

// withTransaction inyecta un client con query mockeado.
function makeClient(rowsForInsert) {
  return { query: vi.fn().mockImplementation(async (sql) => {
    if (/INSERT INTO platform_tenants\.tenants/.test(sql)) return { rows: [rowsForInsert] }
    return { rows: [] }
  }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  sdkPublish.mockResolvedValue(undefined)
  global.fetch = vi.fn()
})

const basePayload = {
  app: { appId: 'aikikan', displayName: 'Aikikan', subdomain: 'aikikan', enabledModules: ['auth'] },
  tenant: { displayName: 'Dojo Centro', subdomain: 'dojo', defaultLocale: 'es' },
  owner: { email: 'owner@x.com', displayName: 'Owner' },
  subscription: { period: 'monthly', amountCents: 1000, currency: 'eur', stripePriceId: 'price_1' },
  flags: { splitpayEnabled: true, customDomain: null },
}

describe('bootstrapTenant', () => {
  it('app nueva: crea app + módulos + tenant + owner + nginx + evento', async () => {
    appsRepo.findByAppId.mockResolvedValue(null)
    appsRepo.create.mockResolvedValue({ app_id: 'aikikan', display_name: 'Aikikan', subdomain: 'aikikan' })
    appsRepo.updateEnabledModules.mockResolvedValue({ app_id: 'aikikan', display_name: 'Aikikan', subdomain: 'aikikan' })
    const tenantRow = { id: 't1', display_name: 'Dojo Centro', subdomain: 'dojo', app_id: 'aikikan' }
    withTransaction.mockImplementation(async (_p, fn) => fn(makeClient(tenantRow)))
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: { userId: 'o1', plainToken: 'tok', expiresAt: 'soon' } }) })

    const r = await bootstrapTenant(basePayload, actor)
    expect(appsRepo.create).toHaveBeenCalled()
    expect(appsRepo.updateEnabledModules).toHaveBeenCalled()
    expect(writeAppNginxConfig).toHaveBeenCalled()
    expect(writeTenantNginxConfig).toHaveBeenCalled()
    expect(sdkPublish).toHaveBeenCalledWith({}, 'platform', expect.objectContaining({ type: 'tenant.bootstrap_started' }))
    expect(r.owner.userId).toBe('o1')
    expect(r.owner.magicLinkUrl).toContain('dojo.hulkstein.local')
  })

  it('actor undefined → audit con actorUserId/role/ip = null (ramas ?? null)', async () => {
    appsRepo.findByAppId.mockResolvedValue({ app_id: 'aikikan', display_name: 'A', subdomain: 'aikikan' })
    const tenantRow = { id: 't1', display_name: 'Dojo', subdomain: 'dojo', app_id: 'aikikan' }
    withTransaction.mockImplementation(async (_p, fn) => fn(makeClient(tenantRow)))
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: { userId: 'o1', plainToken: 'tok', expiresAt: 's' } }) })
    await bootstrapTenant(basePayload, undefined)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUserId: null, actorRole: null, ip: null,
    }))
  })

  it('app existente: no crea app ni nginx de app', async () => {
    appsRepo.findByAppId.mockResolvedValue({ app_id: 'aikikan', display_name: 'Aikikan', subdomain: 'aikikan' })
    const tenantRow = { id: 't1', display_name: 'Dojo', subdomain: 'dojo', app_id: 'aikikan' }
    withTransaction.mockImplementation(async (_p, fn) => fn(makeClient(tenantRow)))
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: { userId: 'o1', plainToken: 'tok', expiresAt: 'soon' } }) })
    await bootstrapTenant(basePayload, actor)
    expect(appsRepo.create).not.toHaveBeenCalled()
    expect(writeAppNginxConfig).not.toHaveBeenCalled()
  })

  it('subdomain duplicado (23505) → Conflict', async () => {
    withTransaction.mockImplementation(async () => { throw Object.assign(new Error(), { code: '23505' }) })
    await expect(bootstrapTenant(basePayload, actor)).rejects.toThrow(/already exists/)
  })

  it('FK (23503) → NotFound App', async () => {
    withTransaction.mockImplementation(async () => { throw Object.assign(new Error(), { code: '23503' }) })
    await expect(bootstrapTenant(basePayload, actor)).rejects.toThrow(/App/)
  })

  it('otro error en paso 1 → re-lanza', async () => {
    withTransaction.mockImplementation(async () => { throw new Error('boom') })
    await expect(bootstrapTenant(basePayload, actor)).rejects.toThrow('boom')
  })

  it('owner creation falla → compensa borrando tenant y re-lanza', async () => {
    appsRepo.findByAppId.mockResolvedValue({ app_id: 'aikikan', display_name: 'A', subdomain: 'aikikan' })
    const tenantRow = { id: 't1', display_name: 'Dojo', subdomain: 'dojo', app_id: 'aikikan' }
    let call = 0
    withTransaction.mockImplementation(async (_p, fn) => { call++; return fn(makeClient(tenantRow)) })
    // owner call (fetch) falla
    global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { code: 'X', message: 'fail' } }) })
    await expect(bootstrapTenant(basePayload, actor)).rejects.toThrow()
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/rolling back/))
  })

  it('compensación de delete también falla → warn', async () => {
    appsRepo.findByAppId.mockResolvedValue({ app_id: 'aikikan', display_name: 'A', subdomain: 'aikikan' })
    const tenantRow = { id: 't1', display_name: 'Dojo', subdomain: 'dojo', app_id: 'aikikan' }
    let n = 0
    withTransaction.mockImplementation(async (_p, fn) => {
      n++
      if (n === 1) return fn(makeClient(tenantRow))
      throw new Error('comp-fail') // el delete compensatorio
    })
    global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: {} }) })
    await expect(bootstrapTenant(basePayload, actor)).rejects.toThrow()
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/Compensation delete failed/))
  })

  it('nginx + publish no-fatales: warns pero devuelve resultado', async () => {
    appsRepo.findByAppId.mockResolvedValue(null)
    appsRepo.create.mockResolvedValue({ app_id: 'aikikan', display_name: 'A', subdomain: 'aikikan' })
    const tenantRow = { id: 't1', display_name: 'Dojo', subdomain: 'dojo', app_id: 'aikikan' }
    withTransaction.mockImplementation(async (_p, fn) => fn(makeClient(tenantRow)))
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ data: { userId: 'o1', plainToken: 'tok', expiresAt: 's' } }) })
    writeAppNginxConfig.mockRejectedValueOnce(new Error('x'))
    writeTenantNginxConfig.mockRejectedValueOnce(new Error('y'))
    sdkPublish.mockRejectedValueOnce(new Error('z'))
    const payloadNoModules = { ...basePayload, app: { ...basePayload.app, enabledModules: [] } }
    const r = await bootstrapTenant(payloadNoModules, actor)
    expect(r.tenant.id).toBe('t1')
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('resendActivation', () => {
  it('owner pending → reissue + audit + publish', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', app_id: 'a', subdomain: 'dojo', default_locale: 'es', display_name: 'Dojo' })
    withTransaction.mockImplementation(async (_p, fn) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'o1', email: 'o@x', display_name: 'O', pending_activation: true } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { plainToken: 'tok2', expiresAt: 'soon' } }) })
    const r = await resendActivation('t1', actor)
    expect(r.magicLinkUrl).toContain('dojo')
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'TENANT_BOOTSTRAP_RESENT' }))
  })

  it('actor undefined + tenant sin default_locale → audit nulls + locale "es"', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', app_id: 'a', subdomain: 'dojo', display_name: 'Dojo' })
    withTransaction.mockImplementation(async (_p, fn) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'o1', email: 'o@x', display_name: 'O', pending_activation: true } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { plainToken: 'tok2', expiresAt: 'soon' } }) })
    await resendActivation('t1', undefined)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUserId: null, actorRole: null, ip: null,
    }))
    expect(sdkPublish).toHaveBeenCalledWith({}, 'platform', expect.objectContaining({
      payload: expect.objectContaining({ locale: 'es' }),
    }))
  })

  it('tenant no existe → 404', async () => {
    tenantsRepo.findById.mockResolvedValue(null)
    withTransaction.mockImplementation(async (_p, fn) => fn({}))
    await expect(resendActivation('x', actor)).rejects.toThrow(/Tenant/)
  })

  it('owner no encontrado → 404 Owner', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', subdomain: 'd' })
    withTransaction.mockImplementation(async (_p, fn) => fn({}))
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) })
    await expect(resendActivation('t1', actor)).rejects.toThrow(/Owner/)
  })

  it('owner ya activado → 409', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', subdomain: 'd' })
    withTransaction.mockImplementation(async (_p, fn) => fn({}))
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'o1', pending_activation: false } }) })
    await expect(resendActivation('t1', actor)).rejects.toMatchObject({ statusCode: 409 })
  })
})

describe('listPendingTenants', () => {
  it('devuelve filas pending', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 't1' }] }) }
    withTransaction.mockImplementation(async (_p, fn) => fn(client))
    expect(await listPendingTenants()).toEqual([{ id: 't1' }])
    expect(client.query.mock.calls[0][0]).toMatch(/bootstrap_completed_at IS NULL/)
  })
})

describe('revokeBootstrap', () => {
  it('tenant no existe → 404', async () => {
    tenantsRepo.findById.mockResolvedValue(null)
    withTransaction.mockImplementation(async (_p, fn) => fn({}))
    await expect(revokeBootstrap('x', actor)).rejects.toThrow(/Tenant/)
  })

  it('ya bootstrapped → 409', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', bootstrap_completed_at: 'yes' })
    withTransaction.mockImplementation(async (_p, fn) => fn({}))
    await expect(revokeBootstrap('t1', actor)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('owner ya activado → 409', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', bootstrap_completed_at: null, subdomain: 'd', app_id: 'a' })
    withTransaction.mockImplementation(async (_p, fn) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { pending_activation: false } }) })
    await expect(revokeBootstrap('t1', actor)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('owner pending → borra owner + tenant + audit + nginx', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', bootstrap_completed_at: null, subdomain: 'd', app_id: 'a', display_name: 'Dojo' })
    withTransaction.mockImplementation(async (_p, fn) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { pending_activation: true } }) }) // state
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) })                            // delete owner
    const r = await revokeBootstrap('t1', actor)
    expect(r).toEqual({ tenantId: 't1' })
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'TENANT_BOOTSTRAP_REVOKED' }))
    expect(deleteTenantNginxConfig).toHaveBeenCalled()
  })

  it('owner null (no encontrado) → procede a revocar', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', bootstrap_completed_at: null, subdomain: 'd', app_id: 'a', display_name: 'Dojo' })
    withTransaction.mockImplementation(async (_p, fn) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) })
    await expect(revokeBootstrap('t1', actor)).resolves.toEqual({ tenantId: 't1' })
  })

  it('actor undefined → audit con nulls (ramas ?? null en revoke)', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', bootstrap_completed_at: null, subdomain: 'd', app_id: 'a', display_name: 'Dojo' })
    withTransaction.mockImplementation(async (_p, fn) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { pending_activation: true } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) })
    await revokeBootstrap('t1', undefined)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorUserId: null, actorRole: null, ip: null,
    }))
  })

  it('deleteTenantNginxConfig falla → warn no-fatal', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', bootstrap_completed_at: null, subdomain: 'd', app_id: 'a', display_name: 'Dojo' })
    withTransaction.mockImplementation(async (_p, fn) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { pending_activation: true } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: {} }) })
    deleteTenantNginxConfig.mockRejectedValueOnce(new Error('x'))
    await revokeBootstrap('t1', actor)
    expect(logger.warn).toHaveBeenCalled()
  })
})

describe('getBootstrapStatus', () => {
  function setup(tenant, owner, app = { splitpay_enabled: false, enabled_modules: [] }, adminCount = 0) {
    tenantsRepo.findById.mockResolvedValue(tenant)
    appsRepo.findByAppId.mockResolvedValue(app)
    withTransaction.mockImplementation(async (_p, fn) => fn({ query: vi.fn() }))
    global.fetch.mockImplementation(async (url) => {
      if (/owners\/state/.test(url)) return { ok: true, json: async () => ({ data: owner }) }
      if (/admins\/count/.test(url)) return { ok: true, json: async () => ({ data: adminCount }) }
      return { ok: true, json: async () => ({ data: null }) }
    })
  }

  it('tenant no existe → 404', async () => {
    tenantsRepo.findById.mockResolvedValue(null)
    withTransaction.mockImplementation(async (_p, fn) => fn({}))
    await expect(getBootstrapStatus('x')).rejects.toThrow(/Tenant/)
  })

  it('todos los required done → auto-marca completed + publica', async () => {
    setup(
      { id: 't1', app_id: 'a', legal_name: 'L', cif: 'C', country: 'ES', address: 'Calle',
        subscription_status: 'active', stripe_status: 'VERIFIED', custom_domain: 'x.com',
        bootstrap_started_at: 'd', bootstrap_completed_at: null, subscription_started_at: 'd' },
      { pending_activation: false, password_set: true, email: 'o@x', owner_activated_at: 'd' },
      { splitpay_enabled: true, enabled_modules: ['auth'] }, 2,
    )
    tenantsRepo.markBootstrapCompleted.mockResolvedValue({ bootstrap_completed_at: 'now' })
    const r = await getBootstrapStatus('t1')
    expect(r.completedAt).toBe('now')
    expect(tenantsRepo.markBootstrapCompleted).toHaveBeenCalled()
    expect(sdkPublish).toHaveBeenCalledWith({}, 'platform', expect.objectContaining({ type: 'tenant.bootstrap_completed' }))
  })

  it('required pendientes → no marca completed; splitpay no aplicable', async () => {
    setup(
      { id: 't1', app_id: 'a', legal_name: null, subscription_status: 'pending', stripe_status: null,
        custom_domain: null, bootstrap_started_at: 'd', bootstrap_completed_at: null },
      { pending_activation: true, password_set: false },
      { splitpay_enabled: false, enabled_modules: [] }, 0,
    )
    const r = await getBootstrapStatus('t1')
    expect(tenantsRepo.markBootstrapCompleted).not.toHaveBeenCalled()
    expect(r.steps.find((s) => s.key === 'splitpay-connect').status).toBe('not_applicable')
  })

  it('splitpay aplicable pero NO verificado → CTA connect-accounts (rama ternaria)', async () => {
    setup(
      { id: 't1', app_id: 'a', legal_name: null, subscription_status: 'pending', stripe_status: 'PENDING',
        custom_domain: null, bootstrap_started_at: 'd', bootstrap_completed_at: null },
      { pending_activation: true, password_set: false },
      { splitpay_enabled: true, enabled_modules: ['auth'] }, 0,
    )
    const r = await getBootstrapStatus('t1')
    const step = r.steps.find((s) => s.key === 'splitpay-connect')
    expect(step.status).toBe('pending')
    expect(step.cta).toBe('POST /v1/splitpay/connect-accounts')
  })

  it('admins/count devuelve null → adminCount ?? 0 = 0', async () => {
    setup(
      { id: 't1', app_id: 'a', legal_name: null, subscription_status: 'pending', stripe_status: null,
        custom_domain: null, bootstrap_started_at: 'd', bootstrap_completed_at: null },
      { pending_activation: true, password_set: false },
      { splitpay_enabled: false, enabled_modules: [] }, null,
    )
    const r = await getBootstrapStatus('t1')
    expect(r.steps.find((s) => s.key === 'admins').status).toBe('pending')
  })

  it('all required done, markBootstrapCompleted null y owner sin email → fallback Date + ownerEmail null', async () => {
    setup(
      { id: 't1', app_id: 'a', legal_name: 'L', cif: 'C', country: 'ES', address: 'Calle',
        subscription_status: 'trial', stripe_status: 'VERIFIED', custom_domain: 'x.com',
        bootstrap_started_at: 'd', bootstrap_completed_at: null, subscription_started_at: 'd' },
      // owner sin email pero activado → passwordDone true; owner?.email ?? null toma null
      { pending_activation: false, password_set: true, owner_activated_at: 'd' },
      { splitpay_enabled: true, enabled_modules: ['auth'] }, 2,
    )
    tenantsRepo.markBootstrapCompleted.mockResolvedValue(null) // → updated?.x ?? new Date()
    const r = await getBootstrapStatus('t1')
    expect(typeof r.completedAt).toBe('string')
    expect(sdkPublish).toHaveBeenCalledWith({}, 'platform', expect.objectContaining({
      payload: expect.objectContaining({ ownerEmail: null }),
    }))
  })

  it('owner state falla → defaults pending (warn)', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', app_id: 'a', bootstrap_started_at: 'd', bootstrap_completed_at: 'done' })
    appsRepo.findByAppId.mockResolvedValue({ splitpay_enabled: false, enabled_modules: [] })
    withTransaction.mockImplementation(async (_p, fn) => fn({ query: vi.fn() }))
    global.fetch.mockImplementation(async (url) => {
      if (/owners\/state/.test(url)) throw new Error('auth down')
      return { ok: true, json: async () => ({ data: 0 }) }
    })
    const r = await getBootstrapStatus('t1')
    expect(logger.warn).toHaveBeenCalled()
    expect(r.pendingActivation).toBe(false)
  })
})
