import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/services.repository.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'

export async function createService(ctx, body) {
  const s = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    try {
      return await repo.insert(c, ctx.appId, ctx.tenantId, { ...body, subTenantId: ctx.subTenantId })
    } catch (err) {
      if (err.code === '23505') throw new ConflictError('service code already exists for this tenant')
      throw err
    }
  })
  await publish({
    type: 'service.published',
    payload: {
      appId: ctx.appId, tenantId: ctx.tenantId, serviceId: s.id, code: s.code, modality: s.modality,
    },
  })
  return s
}

export async function getService(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!s) throw new NotFoundError('service')
    return s
  })
}

export async function listServices(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listByTenant(c, ctx.appId, ctx.tenantId, opts),
  )
}

export async function updateService(ctx, id, patch) {
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.update(c, ctx.appId, ctx.tenantId, id, patch),
  )
  if (!updated) throw new NotFoundError('service')
  return updated
}

export async function deactivateService(ctx, id) {
  const s = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.deactivate(c, ctx.appId, ctx.tenantId, id),
  )
  if (!s) throw new NotFoundError('service')
  await publish({
    type: 'service.deprecated',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, serviceId: id, code: s.code },
  })
  return s
}

export async function createCategory(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertCategory(c, ctx.appId, ctx.tenantId, body),
  )
}

export async function listCategories(ctx) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listCategories(c, ctx.appId, ctx.tenantId),
  )
}
