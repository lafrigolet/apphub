import { pool, withTenantTransaction } from '../lib/db.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/addresses.repository.js'
import * as easypost from '../lib/easypost.js'
import { NotFoundError } from '../utils/errors.js'

// Map a stored address row → the EasyPost address shape (their field names).
export function toEpAddress(row) {
  return {
    name: row.name ?? undefined,
    company: row.company ?? undefined,
    street1: row.street1,
    street2: row.street2 ?? undefined,
    city: row.city,
    state: row.region ?? undefined,
    zip: row.zip ?? undefined,
    country: row.country,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
  }
}

export async function listAddresses(ctx, filters) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listAddresses(c, ctx.appId, ctx.tenantId, filters),
  )
}

export async function getAddress(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const a = await repo.findAddressById(c, ctx.appId, ctx.tenantId, id)
    if (!a) throw new NotFoundError('address')
    return a
  })
}

export async function createAddress(ctx, input) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    // Clear any existing default origin BEFORE inserting the new default, or the
    // partial unique index rejects the insert.
    if (input.role === 'origin' && input.isDefault) {
      await repo.clearDefaultOrigin(c, ctx.appId, ctx.tenantId)
    }
    return repo.insertAddress(c, ctx.appId, ctx.tenantId, input)
  })
}

export async function updateAddress(ctx, id, patch) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    // Demote other default origins first (keeping this row), then promote it.
    if (patch.isDefault === true) {
      await repo.clearDefaultOrigin(c, ctx.appId, ctx.tenantId, id)
    }
    const a = await repo.updateAddress(c, ctx.appId, ctx.tenantId, id, patch)
    if (!a) throw new NotFoundError('address')
    return a
  })
}

export async function deleteAddress(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const ok = await repo.deleteAddress(c, ctx.appId, ctx.tenantId, id)
    if (!ok) throw new NotFoundError('address')
    return { deleted: true }
  })
}

// Verify the address against EasyPost: normalize + confirm deliverability and
// cache the resulting EasyPost address id for reuse in rate-shop/label calls.
export async function verifyAddress(ctx, id) {
  const address = await getAddress(ctx, id)
  const ep = await easypost.verifyAddress(toEpAddress(address))
  // EasyPost reports per-check success under verifications.delivery.success.
  const ok = ep?.verifications?.delivery?.success ?? false
  const patch = {
    easypostAddressId: ep?.id ?? null,
    verified: !!ok,
  }
  // Adopt EasyPost's normalized fields when the check succeeded.
  if (ok) {
    Object.assign(patch, {
      street1: ep.street1 ?? address.street1,
      street2: ep.street2 ?? address.street2,
      city: ep.city ?? address.city,
      region: ep.state ?? address.region,
      zip: ep.zip ?? address.zip,
      country: ep.country ?? address.country,
    })
  } else {
    logger.warn({ addressId: id, errors: ep?.verifications?.delivery?.errors }, 'EasyPost address verification failed')
  }
  const updated = await updateAddress(ctx, id, patch)
  return { ...updated, verification: ep?.verifications?.delivery ?? null }
}
