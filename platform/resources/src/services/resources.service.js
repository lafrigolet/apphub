import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/resources.repository.js'
import { NotFoundError } from '../utils/errors.js'

// Tells platform/availability that a resource's recurring schedule or its
// exceptions changed, so it can bump the cached version and stop serving
// stale slots. Consumer side (availability cache bump) is cross-cutting.
async function publishScheduleChanged(ctx, resourceId, reason) {
  await publish({
    type: 'resource.schedule_changed',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, resourceId, reason },
  })
}

export async function createResource(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insert(c, ctx.appId, ctx.tenantId, { ...body, subTenantId: ctx.subTenantId }),
  )
}

export async function updateResource(ctx, id, patch) {
  const r = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.update(c, ctx.appId, ctx.tenantId, id, patch),
  )
  if (!r) throw new NotFoundError('resource')
  return r
}

export async function setResourceActive(ctx, id, isActive) {
  const r = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.setActive(c, ctx.appId, ctx.tenantId, id, isActive),
  )
  if (!r) throw new NotFoundError('resource')
  // Activating/deactivating changes whether the resource yields slots.
  await publishScheduleChanged(ctx, id, isActive ? 'activated' : 'deactivated')
  return r
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
  const wh = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertWorkHours(c, ctx.appId, ctx.tenantId, body),
  )
  await publishScheduleChanged(ctx, body.resourceId, 'work_hours.created')
  return wh
}

export async function updateWorkHour(ctx, id, patch) {
  const wh = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.updateWorkHours(c, ctx.appId, ctx.tenantId, id, patch),
  )
  if (!wh) throw new NotFoundError('work-hour')
  await publishScheduleChanged(ctx, wh.resource_id, 'work_hours.updated')
  return wh
}

export async function listWorkHours(ctx, resourceId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listWorkHours(c, ctx.appId, ctx.tenantId, resourceId),
  )
}

export async function deleteWorkHour(ctx, id) {
  const { ok, resourceId } = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const existing = await repo.findWorkHourById(c, ctx.appId, ctx.tenantId, id)
    if (!existing) return { ok: false, resourceId: null }
    await repo.deleteWorkHours(c, ctx.appId, ctx.tenantId, id)
    return { ok: true, resourceId: existing.resource_id }
  })
  if (!ok) throw new NotFoundError('work-hour')
  await publishScheduleChanged(ctx, resourceId, 'work_hours.deleted')
}

// Exceptions
async function publishUnavailable(ctx, e) {
  await publish({
    type: 'resource.unavailable',
    payload: {
      appId: ctx.appId, tenantId: ctx.tenantId,
      resourceId: e.resource_id, startsAt: e.starts_at, endsAt: e.ends_at, kind: e.kind,
    },
  })
}

export async function createException(ctx, body) {
  const e = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertException(c, ctx.appId, ctx.tenantId, body),
  )
  await publishUnavailable(ctx, e)
  await publishScheduleChanged(ctx, e.resource_id, 'exception.created')
  return e
}

export async function updateException(ctx, id, patch) {
  const e = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.updateException(c, ctx.appId, ctx.tenantId, id, patch),
  )
  if (!e) throw new NotFoundError('exception')
  await publishScheduleChanged(ctx, e.resource_id, 'exception.updated')
  return e
}

export async function deleteException(ctx, id) {
  const { ok, resourceId } = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const existing = await repo.findExceptionById(c, ctx.appId, ctx.tenantId, id)
    if (!existing) return { ok: false, resourceId: null }
    await repo.deleteException(c, ctx.appId, ctx.tenantId, id)
    return { ok: true, resourceId: existing.resource_id }
  })
  if (!ok) throw new NotFoundError('exception')
  await publishScheduleChanged(ctx, resourceId, 'exception.deleted')
}

// Bulk holiday/block: creates the same exception on every active resource of
// the tenant (optionally filtered by kind / sub_tenant). Publishes one
// resource.unavailable + resource.schedule_changed per affected resource.
export async function createTenantHolidays(ctx, body) {
  const e = {
    startsAt: body.startsAt,
    endsAt:   body.endsAt,
    reason:   body.reason,
    kind:     body.exceptionKind ?? 'holiday',
  }
  const rows = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertExceptionForTenant(c, ctx.appId, ctx.tenantId, e, {
      kind: body.kind, subTenantId: body.subTenantId,
    }),
  )
  for (const row of rows) {
    await publishUnavailable(ctx, row)
    await publishScheduleChanged(ctx, row.resource_id, 'exception.created')
  }
  return { created: rows.length, exceptions: rows }
}

export async function listExceptions(ctx, resourceId, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listExceptions(c, ctx.appId, ctx.tenantId, resourceId, opts),
  )
}
