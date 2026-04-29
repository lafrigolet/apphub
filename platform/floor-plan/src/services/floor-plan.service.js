import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/floor-plan.repository.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'

const TRANSITIONS = {
  free:           ['reserved','occupied','out_of_service'],
  reserved:       ['occupied','free','out_of_service'],
  occupied:       ['dirty','free','out_of_service'],
  dirty:          ['free','out_of_service'],
  out_of_service: ['free'],
}

function transitionAllowed(from, to) {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export async function createSection(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertSection(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId }),
  )
}

export async function listSections(ctx) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listSections(client, ctx.appId, ctx.tenantId),
  )
}

export async function createTable(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertTable(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId }),
  )
}

export async function listTables(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listTables(client, ctx.appId, ctx.tenantId, opts),
  )
}

export async function getTable(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const t = await repo.findTableById(client, ctx.appId, ctx.tenantId, id)
    if (!t) throw new NotFoundError('table')
    return t
  })
}

export async function changeTableStatus(ctx, id, toStatus, meta = {}) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const t = await repo.findTableById(client, ctx.appId, ctx.tenantId, id)
    if (!t) throw new NotFoundError('table')
    if (!transitionAllowed(t.status, toStatus)) {
      throw new ConflictError(`cannot transition table from ${t.status} to ${toStatus}`)
    }
    const updated = await repo.setTableStatus(client, ctx.appId, ctx.tenantId, id, toStatus)
    await repo.recordTableEvent(client, {
      appId: ctx.appId, tenantId: ctx.tenantId, tableId: id,
      fromStatus: t.status, toStatus,
      reservationId: meta.reservationId, partySize: meta.partySize, actorUserId: ctx.userId,
    })
    await publish({
      type: `table.${toStatus === 'occupied' ? 'seated' : toStatus === 'free' ? 'cleared' : toStatus}`,
      payload: { appId: ctx.appId, tenantId: ctx.tenantId, tableId: id, fromStatus: t.status, toStatus, ...meta },
    })
    return updated
  })
}

export async function combineTables(ctx, primaryId, otherIds) {
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const updated = await repo.combineTables(client, ctx.appId, ctx.tenantId, primaryId, otherIds)
    if (!updated) throw new NotFoundError('table')
    return updated
  })
  await publish({
    type: 'table.combined',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, primaryTableId: primaryId, combinedWith: otherIds },
  })
  return updated
}
