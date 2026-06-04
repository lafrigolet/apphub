// tenants.service — casos de uso prioritarios: feature flags por tenant (#7) y
// verificación de dominio custom vía DNS TXT (#5).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL_TENANTS: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../services/nginx-config.service.js', () => ({
  writeTenantNginxConfig: vi.fn().mockResolvedValue(undefined),
  deleteTenantNginxConfig: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../repositories/tenants.repository.js')
vi.mock('../repositories/apps.repository.js')
vi.mock('../repositories/audit.repository.js')

import {
  getTenantEnabledModules, setTenantEnabledModulesOverride,
  issueCustomDomainChallenge, verifyCustomDomain, DNS_CHALLENGE_PREFIX,
} from '../services/tenants.service.js'
import { withTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as tenantsRepo from '../repositories/tenants.repository.js'
import * as appsRepo from '../repositories/apps.repository.js'
import * as auditRepo from '../repositories/audit.repository.js'

const actor = { userId: 'u1', role: 'staff', ip: '1.2.3.4' }

beforeEach(() => {
  vi.clearAllMocks()
  withTransaction.mockImplementation(async (_p, fn) => fn({}))
})

describe('getTenantEnabledModules (#7)', () => {
  it('override presente → source tenant', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', app_id: 'a', enabled_modules_override: ['auth', 'chat'] })
    const r = await getTenantEnabledModules('t1')
    expect(r).toEqual({ tenantId: 't1', appId: 'a', source: 'tenant', modules: ['auth', 'chat'] })
    expect(appsRepo.findByAppId).not.toHaveBeenCalled()
  })

  it('sin override → hereda del app (source app)', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', app_id: 'a', enabled_modules_override: null })
    appsRepo.findByAppId.mockResolvedValue({ app_id: 'a', enabled_modules: ['auth', 'tenants'] })
    const r = await getTenantEnabledModules('t1')
    expect(r).toEqual({ tenantId: 't1', appId: 'a', source: 'app', modules: ['auth', 'tenants'] })
  })

  it('sin override y app sin enabled_modules → []', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', app_id: 'a', enabled_modules_override: null })
    appsRepo.findByAppId.mockResolvedValue(null)
    const r = await getTenantEnabledModules('t1')
    expect(r.modules).toEqual([])
  })

  it('tenant no existe → 404', async () => {
    tenantsRepo.findById.mockResolvedValue(null)
    await expect(getTenantEnabledModules('x')).rejects.toThrow(/Tenant/)
  })
})

describe('setTenantEnabledModulesOverride (#7)', () => {
  it('setea override + audita + emite tenant.config.updated', async () => {
    tenantsRepo.setEnabledModulesOverride.mockResolvedValue({ id: 't1', app_id: 'a' })
    await setTenantEnabledModulesOverride('t1', ['auth'], actor)
    expect(tenantsRepo.setEnabledModulesOverride).toHaveBeenCalledWith(expect.anything(), 't1', ['auth'])
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'TENANT_MODULES_OVERRIDE_SET', detail: '[auth]' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'tenant.config.updated' }))
  })

  it('null limpia el override (detail "cleared")', async () => {
    tenantsRepo.setEnabledModulesOverride.mockResolvedValue({ id: 't1', app_id: 'a' })
    await setTenantEnabledModulesOverride('t1', null, actor)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ detail: 'cleared (inherits app)' }))
  })

  it('tenant no existe → 404', async () => {
    tenantsRepo.setEnabledModulesOverride.mockResolvedValue(null)
    await expect(setTenantEnabledModulesOverride('x', ['a'], actor)).rejects.toThrow(/Tenant/)
  })
})

describe('issueCustomDomainChallenge (#5)', () => {
  it('sin custom_domain → 409', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', app_id: 'a', custom_domain: null })
    await expect(issueCustomDomainChallenge('t1', actor)).rejects.toMatchObject({ statusCode: 409 })
  })

  it('emite token TXT y lo persiste', async () => {
    tenantsRepo.findById.mockResolvedValue({ id: 't1', app_id: 'a', custom_domain: 'acme.com' })
    tenantsRepo.setCustomDomainVerifyToken.mockResolvedValue({ id: 't1', app_id: 'a', custom_domain: 'acme.com' })
    const r = await issueCustomDomainChallenge('t1', actor)
    expect(r.recordHost).toBe(`${DNS_CHALLENGE_PREFIX}.acme.com`)
    expect(r.recordValue).toMatch(/^apphub-verify=/)
    expect(r.verified).toBe(false)
    const tokenArg = tenantsRepo.setCustomDomainVerifyToken.mock.calls[0][2]
    expect(tokenArg).toBe(r.recordValue)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'CUSTOM_DOMAIN_CHALLENGE_ISSUED' }))
  })
})

describe('verifyCustomDomain (#5)', () => {
  const tenant = { id: 't1', app_id: 'a', custom_domain: 'acme.com', custom_domain_verify_token: 'apphub-verify=abc' }

  it('sin custom_domain → 409', async () => {
    tenantsRepo.findById.mockResolvedValue({ ...tenant, custom_domain: null })
    await expect(verifyCustomDomain('t1', actor, { resolver: vi.fn() })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('sin token emitido → 409', async () => {
    tenantsRepo.findById.mockResolvedValue({ ...tenant, custom_domain_verify_token: null })
    await expect(verifyCustomDomain('t1', actor, { resolver: vi.fn() })).rejects.toMatchObject({ code: 'CHALLENGE_NOT_ISSUED' })
  })

  it('DNS lookup falla → 422 DNS_LOOKUP_FAILED', async () => {
    tenantsRepo.findById.mockResolvedValue(tenant)
    const resolver = vi.fn().mockRejectedValue(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }))
    await expect(verifyCustomDomain('t1', actor, { resolver })).rejects.toMatchObject({ code: 'DNS_LOOKUP_FAILED', statusCode: 422 })
  })

  it('TXT no coincide → 422 DNS_RECORD_MISMATCH', async () => {
    tenantsRepo.findById.mockResolvedValue(tenant)
    const resolver = vi.fn().mockResolvedValue([['otra-cosa']])
    await expect(verifyCustomDomain('t1', actor, { resolver })).rejects.toMatchObject({ code: 'DNS_RECORD_MISMATCH' })
  })

  it('TXT coincide (chunks unidos) → marca verified + audita + evento', async () => {
    tenantsRepo.findById.mockResolvedValue(tenant)
    tenantsRepo.markCustomDomainVerified.mockResolvedValue({ id: 't1', app_id: 'a', custom_domain: 'acme.com', custom_domain_verified_at: '2026-06-04T00:00:00Z' })
    // record dividido en chunks que al unirse forman el token
    const resolver = vi.fn().mockResolvedValue([['apphub-verify=', 'abc']])
    const r = await verifyCustomDomain('t1', actor, { resolver })
    expect(r.verified).toBe(true)
    expect(resolver).toHaveBeenCalledWith(`${DNS_CHALLENGE_PREFIX}.acme.com`)
    expect(auditRepo.insert).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'CUSTOM_DOMAIN_VERIFIED' }))
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'tenant.config.updated' }))
  })

  it('records null → tratado como vacío → mismatch', async () => {
    tenantsRepo.findById.mockResolvedValue(tenant)
    const resolver = vi.fn().mockResolvedValue(null)
    await expect(verifyCustomDomain('t1', actor, { resolver })).rejects.toMatchObject({ code: 'DNS_RECORD_MISMATCH' })
  })
})
