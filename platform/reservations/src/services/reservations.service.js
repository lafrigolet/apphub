import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/reservations.repository.js'
import { ConflictError, NotFoundError } from '../utils/errors.js'

const TRANSITIONS = {
  requested: ['confirmed','cancelled'],
  confirmed: ['seated','cancelled','no_show'],
  seated:    ['completed','cancelled'],
  completed: [],
  cancelled: [],
  no_show:   [],
}
const transitionAllowed = (f, t) => TRANSITIONS[f]?.includes(t) ?? false

export async function createReservation(ctx, body) {
  const r = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertReservation(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId, subTenantId: ctx.subTenantId, guestUserId: ctx.userId }),
  )
  await publish({
    type: 'reservation.created',
    payload: {
      appId: ctx.appId, tenantId: ctx.tenantId, reservationId: r.id,
      guestEmail: r.guest_email, guestName: r.guest_name,
      partySize: r.party_size, reservedFor: r.reserved_for, status: r.status,
    },
  })
  return r
}

export async function listReservations(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listReservations(client, ctx.appId, ctx.tenantId, opts),
  )
}

export async function getReservation(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const r = await repo.findReservationById(client, ctx.appId, ctx.tenantId, id)
    if (!r) throw new NotFoundError('reservation')
    return r
  })
}

export async function changeStatus(ctx, id, toStatus, tableId) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const r = await repo.findReservationById(client, ctx.appId, ctx.tenantId, id)
    if (!r) throw new NotFoundError('reservation')
    if (!transitionAllowed(r.status, toStatus)) {
      throw new ConflictError(`cannot transition reservation from ${r.status} to ${toStatus}`)
    }
    const updated = await repo.updateReservationStatus(client, ctx.appId, ctx.tenantId, id, toStatus, tableId)
    await publish({
      type: `reservation.${toStatus}`,
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, reservationId: id,
        guestEmail: updated.guest_email, guestName: updated.guest_name,
        partySize: updated.party_size, reservedFor: updated.reserved_for,
        tableId: updated.table_id,
      },
    })
    return updated
  })
}

export async function addToWaitlist(ctx, body) {
  const w = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertWaitlistEntry(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId }),
  )
  await publish({
    type: 'waitlist.added',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, waitlistId: w.id, partySize: w.party_size },
  })
  return w
}

export async function listWaitlist(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listWaitlist(client, ctx.appId, ctx.tenantId, opts),
  )
}

export async function notifyWaitlist(ctx, id) {
  const w = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.updateWaitlistStatus(client, ctx.appId, ctx.tenantId, id, 'notified'),
  )
  if (!w) throw new NotFoundError('waitlist entry')
  await publish({
    type: 'waitlist.notified',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, waitlistId: id, guestPhone: w.guest_phone, guestName: w.guest_name },
  })
  return w
}

export async function createServiceHours(ctx, body) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.insertServiceHours(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId }),
  )
}

export async function listServiceHours(ctx) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (client) =>
    repo.listServiceHours(client, ctx.appId, ctx.tenantId),
  )
}
