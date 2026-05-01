import { pool, withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/email-domains.repository.js'
import * as configRepo from '../repositories/config.repository.js'
import * as sg from './sendgrid-domains.service.js'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'

class HttpError extends Error {
  constructor(statusCode, code, message) { super(message); this.statusCode = statusCode; this.code = code }
}

const DOMAIN_RE = /^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/i

async function resolveSendGridApiKey() {
  const client = await pool.connect()
  try {
    const fromDb = await configRepo.getValue(client, 'sendgrid_api_key')
    return fromDb ?? env.SENDGRID_API_KEY ?? null
  } finally { client.release() }
}

export async function createForTenant(ctx, { domain }) {
  const normalized = String(domain || '').trim().toLowerCase()
  if (!DOMAIN_RE.test(normalized)) {
    throw new HttpError(422, 'INVALID_DOMAIN', 'domain is not a valid hostname')
  }
  const apiKey = await resolveSendGridApiKey()

  // Provision in SendGrid (or stub) BEFORE the DB insert so we don't store
  // half-initialised rows if the ESP rejects.
  let provisioned
  try {
    provisioned = await sg.createBrandedDomain({ apiKey, domain: normalized })
  } catch (err) {
    logger.warn({ err, domain: normalized }, 'sendgrid createBrandedDomain failed')
    throw new HttpError(502, 'PROVIDER_ERROR', 'failed to provision domain with provider')
  }

  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insert(c, {
      appId: ctx.appId,
      tenantId: ctx.tenantId,
      domain: normalized,
      provider: 'sendgrid',
      providerDomainId: provisioned.providerDomainId,
      dnsRecords: provisioned.dnsRecords,
    }),
  )
}

export async function listForTenant(ctx) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listForTenant(c),
  )
}

export async function getForTenant(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const r = await repo.findById(c, id)
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'email domain not found')
    return r
  })
}

export async function verifyForTenant(ctx, id) {
  const apiKey = await resolveSendGridApiKey()
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const r = await repo.findById(c, id)
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'email domain not found')

    let valid, dnsRecords
    try {
      ({ valid, dnsRecords } = await sg.validateBrandedDomain({ apiKey, providerDomainId: r.provider_domain_id }))
    } catch (err) {
      logger.warn({ err, id }, 'sendgrid validate failed')
      return repo.setStatus(c, id, 'failed', null)
    }
    return repo.setStatus(c, id, valid ? 'verified' : 'pending', dnsRecords)
  })
}

export async function updateDefaultsForTenant(ctx, id, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const r = await repo.findById(c, id)
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'email domain not found')
    return repo.updateDefaults(c, id, body)
  })
}

export async function suspendForTenant(ctx, id, reason) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const r = await repo.findById(c, id)
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'email domain not found')
    return repo.suspend(c, id, reason)
  })
}

export async function deleteForTenant(ctx, id) {
  const apiKey = await resolveSendGridApiKey()
  await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const r = await repo.findById(c, id)
    if (!r) throw new HttpError(404, 'NOT_FOUND', 'email domain not found')
    try {
      await sg.deleteBrandedDomain({ apiKey, providerDomainId: r.provider_domain_id })
    } catch (err) {
      // Log but don't block — leftover SendGrid rows are easier to clean up
      // than orphaned DB rows that block re-adding the same domain.
      logger.warn({ err, id }, 'sendgrid deleteBrandedDomain failed (continuing)')
    }
    await repo.remove(c, id)
  })
}
