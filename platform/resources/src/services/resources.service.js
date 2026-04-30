import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/resources.repository.js'
import { NotFoundError } from '../utils/errors.js'

export async function createResource(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insert(c, ctx.appId, ctx.tenantId, { ...body, subTenantId: ctx.subTenantId }),
  )
}

export async function getResource(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const r = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!r) throw new NotFoundError('resource')
    const services = await repo.listServicesFor(c, ctx.appId, ctx.tenantId, id)
    const workHours = await repo.listWorkHours(c, ctx.appId, ctx.tenantId, id)
    return { ...r, services, workHours }
  })
}

export async function listResources(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listByTenant(c, ctx.appId, ctx.tenantId, opts),
  )
}

export async function listResourcesForService(ctx, serviceId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listForService(c, ctx.appId, ctx.tenantId, serviceId),
  )
}

export async function attachService(ctx, resourceId, serviceId) {
  await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.attachService(c, ctx.appId, ctx.tenantId, resourceId, serviceId),
  )
}

export async function detachService(ctx, resourceId, serviceId) {
  await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.detachService(c, ctx.appId, ctx.tenantId, resourceId, serviceId),
  )
}

// Work hours
export async function setWorkHour(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertWorkHours(c, ctx.appId, ctx.tenantId, body),
  )
}

export async function listWorkHours(ctx, resourceId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listWorkHours(c, ctx.appId, ctx.tenantId, resourceId),
  )
}

export async function deleteWorkHour(ctx, id) {
  const ok = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.deleteWorkHours(c, ctx.appId, ctx.tenantId, id),
  )
  if (!ok) throw new NotFoundError('work-hour')
}

// Exceptions
export async function createException(ctx, body) {
  const e = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertException(c, ctx.appId, ctx.tenantId, body),
  )
  await publish({
    type: 'resource.unavailable',
    payload: {
      appId: ctx.appId, tenantId: ctx.tenantId,
      resourceId: e.resource_id, startsAt: e.starts_at, endsAt: e.ends_at, kind: e.kind,
    },
  })
  return e
}

export async function listExceptions(ctx, resourceId, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listExceptions(c, ctx.appId, ctx.tenantId, resourceId, opts),
  )
}
