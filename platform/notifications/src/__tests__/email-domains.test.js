// email-domains.service — gestión por tenant de dominios remitentes (Resend).
// Contrato:
//   createForTenant:
//     - DOMAIN_RE valida formato → 422 INVALID_DOMAIN si malformado.
//     - Lowercases + trim.
//     - Llama provider.createBrandedDomain ANTES del INSERT (evita rows huérfanos).
//     - Provider falla → 502 PROVIDER_ERROR + log.warn (no INSERT).
//
//   verifyForTenant:
//     - 404 si dominio no existe.
//     - provider.validateBrandedDomain → status='verified' (si valid) o 'pending'.
//     - provider lanza → setStatus(failed) (no propaga).
//
//   deleteForTenant:
//     - 404 si no existe.
//     - provider.delete falla → log.warn pero CONTINÚA con DB delete
//       (orphaned Resend rows < orphaned DB rows).
//
//   getForTenant / updateDefaultsForTenant / suspendForTenant:
//     - 404 si no existe.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: {
    NODE_ENV: 'test', LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost',
    RESEND_API_KEY: 'env_key',
  },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const fakeClient = vi.hoisted(() => ({ release: vi.fn() }))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue(fakeClient) },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../repositories/email-domains.repository.js')
const configMock = vi.hoisted(() => ({ getValue: vi.fn().mockResolvedValue(null) }))
vi.mock('../repositories/config.repository.js', () => configMock)
vi.mock('../services/resend-domains.service.js', () => ({
  createBrandedDomain: vi.fn(),
  validateBrandedDomain: vi.fn(),
  deleteBrandedDomain: vi.fn(),
}))

import {
  createForTenant, listForTenant, getForTenant,
  verifyForTenant, updateDefaultsForTenant, suspendForTenant, deleteForTenant,
} from '../services/email-domains.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/email-domains.repository.js'
import * as provider from '../services/resend-domains.service.js'

const ctx = { appId: 'aikikan', tenantId: 't1', subTenantId: null }
const DOMAIN_ID = 'dom-1'

beforeEach(() => {
  vi.clearAllMocks()
  configMock.getValue.mockResolvedValue(null)
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── createForTenant — validation ────────────────────────────────────

describe('createForTenant — validate', () => {
  it.each([
    [''],
    [null],
    ['notadomain'],
    ['x.'],
    ['-leading-dash.com'],
    ['has space.com'],
  ])('"%s" → 422 INVALID_DOMAIN', async (domain) => {
    await expect(createForTenant(ctx, { domain })).rejects.toMatchObject({
      statusCode: 422, code: 'INVALID_DOMAIN',
    })
    expect(provider.createBrandedDomain).not.toHaveBeenCalled()
  })

  it.each([
    ['simple.com'],
    ['mail.example.org'],
    ['sub.sub.co.uk'],
    ['x-y.z9.io'],
  ])('"%s" → válido', async (domain) => {
    provider.createBrandedDomain.mockResolvedValue({ providerDomainId: 'p1', dnsRecords: [] })
    repo.insert.mockResolvedValue({ id: DOMAIN_ID })
    await createForTenant(ctx, { domain })
    expect(provider.createBrandedDomain).toHaveBeenCalled()
  })

  it('lowercase + trim de domain antes de validar/persist', async () => {
    provider.createBrandedDomain.mockResolvedValue({ providerDomainId: 'p1', dnsRecords: [] })
    repo.insert.mockResolvedValue({})
    await createForTenant(ctx, { domain: '  HELLO.COM  ' })
    expect(provider.createBrandedDomain).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'hello.com',
    }))
  })
})

// ── createForTenant — provider falla ANTES del INSERT ──────────────

describe('createForTenant — provider failure', () => {
  it('provider lanza → 502 PROVIDER_ERROR + NO INSERT (anti rows huérfanos)', async () => {
    provider.createBrandedDomain.mockRejectedValue(new Error('Resend down'))
    await expect(createForTenant(ctx, { domain: 'x.com' })).rejects.toMatchObject({
      statusCode: 502, code: 'PROVIDER_ERROR',
    })
    expect(repo.insert).not.toHaveBeenCalled()
  })

  it('happy: persist row con providerDomainId + dnsRecords del provider', async () => {
    provider.createBrandedDomain.mockResolvedValue({
      providerDomainId: 'rsd-domain-123',
      dnsRecords: [{ type: 'TXT', name: 'x.com', value: 'v=spf1...' }],
    })
    repo.insert.mockResolvedValue({ id: DOMAIN_ID })
    await createForTenant(ctx, { domain: 'x.com' })
    expect(repo.insert).toHaveBeenCalledWith(expect.anything(), {
      appId: ctx.appId, tenantId: ctx.tenantId,
      domain: 'x.com',
      provider: 'resend',
      providerDomainId: 'rsd-domain-123',
      dnsRecords: [{ type: 'TXT', name: 'x.com', value: 'v=spf1...' }],
    })
  })
})

// ── API key resolution (DB > env) ──────────────────────────────────

describe('resolveProviderApiKey', () => {
  it('config DB tiene key → usa esa (prioritaria sobre env)', async () => {
    configMock.getValue.mockResolvedValue('db_key_xyz')
    provider.createBrandedDomain.mockResolvedValue({ providerDomainId: 'p', dnsRecords: [] })
    repo.insert.mockResolvedValue({})
    await createForTenant(ctx, { domain: 'x.com' })
    expect(provider.createBrandedDomain).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'db_key_xyz',
    }))
  })

  it('config DB null → fallback env.RESEND_API_KEY', async () => {
    configMock.getValue.mockResolvedValue(null)
    provider.createBrandedDomain.mockResolvedValue({ providerDomainId: 'p', dnsRecords: [] })
    repo.insert.mockResolvedValue({})
    await createForTenant(ctx, { domain: 'x.com' })
    expect(provider.createBrandedDomain).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'env_key',
    }))
  })
})

// ── verifyForTenant ────────────────────────────────────────────────

describe('verifyForTenant', () => {
  it('dominio no existe → 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(verifyForTenant(ctx, 'ghost')).rejects.toMatchObject({
      statusCode: 404, code: 'NOT_FOUND',
    })
  })

  it('provider valid=true → setStatus("verified", dnsRecords)', async () => {
    repo.findById.mockResolvedValue({ id: DOMAIN_ID, provider_domain_id: 'rsd-1' })
    provider.validateBrandedDomain.mockResolvedValue({
      valid: true, dnsRecords: [{ verified: true }],
    })
    await verifyForTenant(ctx, DOMAIN_ID)
    expect(repo.setStatus).toHaveBeenCalledWith(expect.anything(), DOMAIN_ID, 'verified', [{ verified: true }])
  })

  it('provider valid=false → setStatus("pending", dnsRecords)', async () => {
    repo.findById.mockResolvedValue({ id: DOMAIN_ID, provider_domain_id: 'rsd-1' })
    provider.validateBrandedDomain.mockResolvedValue({
      valid: false, dnsRecords: [{ verified: false }],
    })
    await verifyForTenant(ctx, DOMAIN_ID)
    expect(repo.setStatus).toHaveBeenCalledWith(expect.anything(), DOMAIN_ID, 'pending', [{ verified: false }])
  })

  it('provider lanza → setStatus("failed", null), NO propaga error', async () => {
    repo.findById.mockResolvedValue({ id: DOMAIN_ID, provider_domain_id: 'rsd-1' })
    provider.validateBrandedDomain.mockRejectedValue(new Error('Resend timeout'))
    await verifyForTenant(ctx, DOMAIN_ID)
    expect(repo.setStatus).toHaveBeenCalledWith(expect.anything(), DOMAIN_ID, 'failed', null)
  })
})

// ── deleteForTenant — provider failure tolerant ────────────────────

describe('deleteForTenant', () => {
  it('dominio no existe → 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(deleteForTenant(ctx, 'ghost')).rejects.toMatchObject({
      statusCode: 404, code: 'NOT_FOUND',
    })
  })

  it('happy: provider OK + repo.remove', async () => {
    repo.findById.mockResolvedValue({ id: DOMAIN_ID, provider_domain_id: 'rsd-1' })
    provider.deleteBrandedDomain.mockResolvedValue(undefined)
    await deleteForTenant(ctx, DOMAIN_ID)
    expect(repo.remove).toHaveBeenCalledWith(expect.anything(), DOMAIN_ID)
  })

  it('provider falla → log.warn pero CONTINÚA con repo.remove (anti DB orphans)', async () => {
    repo.findById.mockResolvedValue({ id: DOMAIN_ID, provider_domain_id: 'rsd-1' })
    provider.deleteBrandedDomain.mockRejectedValue(new Error('Resend 500'))
    await deleteForTenant(ctx, DOMAIN_ID)
    expect(repo.remove).toHaveBeenCalled()                    // SÍ se hace
  })
})

// ── getForTenant / updateDefaults / suspend ────────────────────────

describe('getForTenant / update / suspend 404', () => {
  it('getForTenant 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(getForTenant(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('updateDefaultsForTenant 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(updateDefaultsForTenant(ctx, 'ghost', { fromName: 'X' }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('suspendForTenant 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(suspendForTenant(ctx, 'ghost', 'spam')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('listForTenant delega al repo', async () => {
    repo.listForTenant.mockResolvedValue([{ id: DOMAIN_ID, domain: 'x.com' }])
    const r = await listForTenant(ctx)
    expect(r).toHaveLength(1)
  })
})
