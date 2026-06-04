import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as repo from '../repositories/floor-plan.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'

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

export async function updateSection(ctx, id, patch) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const updated = await repo.updateSection(client, ctx.appId, ctx.tenantId, id, patch)
    if (!updated) throw new NotFoundError('section')
    return updated
  })
}

// Refuse to delete a section that still holds tables (avoids orphan cascade
// surprises); the caller must move/delete tables first.
export async function deleteSection(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const n = await repo.countTablesInSection(client, ctx.appId, ctx.tenantId, id)
    if (n > 0) throw new ConflictError(`section has ${n} table(s); remove them first`)
    const deleted = await repo.deleteSection(client, ctx.appId, ctx.tenantId, id)
    if (!deleted) throw new NotFoundError('section')
    return { id }
  })
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

export async function updateTable(ctx, id, patch) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const updated = await repo.updateTable(client, ctx.appId, ctx.tenantId, id, patch)
    if (!updated) throw new NotFoundError('table')
    return updated
  })
}

// A table can only be deleted when idle (free / out_of_service). Active tables
// (reserved/occupied/dirty) must be cleared first to avoid losing live state.
export async function deleteTable(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const t = await repo.findTableById(client, ctx.appId, ctx.tenantId, id)
    if (!t) throw new NotFoundError('table')
    if (!['free', 'out_of_service'].includes(t.status)) {
      throw new ConflictError(`cannot delete table in status ${t.status}`)
    }
    if (t.combined_with?.length) {
      throw new ConflictError('cannot delete a table that is part of a combined group')
    }
    await repo.deleteTable(client, ctx.appId, ctx.tenantId, id)
    return { id }
  })
}

export async function listTableEvents(ctx, id, opts = {}) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const t = await repo.findTableById(client, ctx.appId, ctx.tenantId, id)
    if (!t) throw new NotFoundError('table')
    return repo.listTableEvents(client, ctx.appId, ctx.tenantId, id, opts)
  })
}

export async function occupancy(ctx, opts = {}) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.occupancySnapshot(client, ctx.appId, ctx.tenantId, opts),
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
  const result = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const ids = [...new Set(otherIds)]
    if (ids.includes(primaryId)) throw new ValidationError('a table cannot be combined with itself')

    const primary = await repo.findTableById(client, ctx.appId, ctx.tenantId, primaryId)
    if (!primary) throw new NotFoundError('table')
    if (primary.status !== 'free') {
      throw new ConflictError(`primary table must be free to combine (is ${primary.status})`)
    }
    if (primary.combined_with?.length) {
      throw new ConflictError('primary table is already part of a combined group')
    }

    const others = await repo.findTablesByIds(client, ctx.appId, ctx.tenantId, ids)
    if (others.length !== ids.length) throw new NotFoundError('one or more tables to combine')
    for (const o of others) {
      if (o.status !== 'free') {
        throw new ConflictError(`table ${o.code} must be free to combine (is ${o.status})`)
      }
      if (o.combined_with?.length) {
        throw new ConflictError(`table ${o.code} is already part of a combined group`)
      }
    }

    // Primary holds the group; secondaries are reserved+locked so their state
    // cannot drift independently while combined.
    const updated = await repo.combineTables(client, ctx.appId, ctx.tenantId, primaryId, ids)
    for (const o of others) {
      await repo.setTableStatus(client, ctx.appId, ctx.tenantId, o.id, 'reserved')
      await repo.recordTableEvent(client, {
        appId: ctx.appId, tenantId: ctx.tenantId, tableId: o.id,
        fromStatus: o.status, toStatus: 'reserved', actorUserId: ctx.userId,
      })
    }
    const totalCapacity = primary.capacity + others.reduce((s, o) => s + o.capacity, 0)
    return { updated, ids, totalCapacity }
  })
  await publish({
    type: 'table.combined',
    payload: {
      appId: ctx.appId, tenantId: ctx.tenantId,
      primaryTableId: primaryId, combinedWith: result.ids, totalCapacity: result.totalCapacity,
    },
  })
  return { ...result.updated, total_capacity: result.totalCapacity }
}

// Reverse a combine: clear combined_with on the primary and release the
// secondaries (reserved → free).
export async function splitTables(ctx, primaryId) {
  const result = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const primary = await repo.findTableById(client, ctx.appId, ctx.tenantId, primaryId)
    if (!primary) throw new NotFoundError('table')
    const secondaryIds = primary.combined_with ?? []
    if (!secondaryIds.length) throw new ConflictError('table is not part of a combined group')

    const updated = await repo.clearCombined(client, ctx.appId, ctx.tenantId, primaryId)
    const secondaries = await repo.findTablesByIds(client, ctx.appId, ctx.tenantId, secondaryIds)
    for (const s of secondaries) {
      // Only release tables still held by the group; an occupied/dirty
      // secondary keeps its real state.
      if (s.status === 'reserved') {
        await repo.setTableStatus(client, ctx.appId, ctx.tenantId, s.id, 'free')
        await repo.recordTableEvent(client, {
          appId: ctx.appId, tenantId: ctx.tenantId, tableId: s.id,
          fromStatus: 'reserved', toStatus: 'free', actorUserId: ctx.userId,
        })
      }
    }
    return { updated, secondaryIds }
  })
  await publish({
    type: 'table.split',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, primaryTableId: primaryId, separated: result.secondaryIds },
  })
  return result.updated
}

// ── Event-driven status sync (reservations + POS) ──────────────────────────
// Best-effort: events carry tableId; we transition the matching table if the
// FSM allows it, otherwise skip. Never throws into the subscriber.
const EVENT_TRANSITIONS = {
  'reservation.confirmed': 'reserved',
  'reservation.cancelled': 'free',
  'reservation.seated':    'occupied',
  'pos.bill.opened':       'occupied',
  'pos.bill.closed':       'dirty',
  'pos.bill.paid':         'dirty',
}

async function syncTableFromEvent(event) {
  const toStatus = EVENT_TRANSITIONS[event.type]
  if (!toStatus) return
  const { appId, tenantId, tableId, reservationId, partySize } = event.payload ?? {}
  if (!appId || !tenantId || !tableId) return

  const ctx = { appId, tenantId, subTenantId: null, userId: null, role: 'system' }
  await withTenantTransaction(pool, appId, tenantId, null, async (client) => {
    const t = await repo.findTableById(client, appId, tenantId, tableId)
    if (!t) return
    // Idempotent: already in the target state → nothing to do.
    if (t.status === toStatus) return
    if (!transitionAllowed(t.status, toStatus)) {
      logger?.debug?.({ type: event.type, from: t.status, toStatus, tableId }, 'floor-plan: skipping event transition (FSM)')
      return
    }
    await repo.setTableStatus(client, appId, tenantId, tableId, toStatus)
    await repo.recordTableEvent(client, {
      appId, tenantId, tableId, fromStatus: t.status, toStatus,
      reservationId: reservationId ?? null, partySize: partySize ?? null,
    })
    await publish({
      type: `table.${toStatus === 'occupied' ? 'seated' : toStatus === 'free' ? 'cleared' : toStatus}`,
      payload: { appId, tenantId, tableId, fromStatus: t.status, toStatus, sourceEvent: event.type },
    })
  }).catch((err) => logger?.warn?.({ err, type: event.type }, 'floor-plan event sync error'))
}

export async function handleEvent(event) {
  try {
    await syncTableFromEvent(event)
  } catch (err) {
    logger?.warn?.({ err, type: event?.type }, 'floor-plan handleEvent error')
  }
}
