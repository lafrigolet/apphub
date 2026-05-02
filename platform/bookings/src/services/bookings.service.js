import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/bookings.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'

const TRANSITIONS = {
  requested:    ['confirmed','cancelled','rescheduled'],
  confirmed:    ['reminded','checked_in','cancelled','no_show','rescheduled'],
  reminded:     ['checked_in','cancelled','no_show','rescheduled'],
  checked_in:   ['in_progress','cancelled','no_show'],
  in_progress:  ['completed','cancelled'],
  completed:    [],
  cancelled:    [],
  no_show:      [],
  rescheduled:  [],
}
const transitionAllowed = (f, t) => TRANSITIONS[f]?.includes(t) ?? false

async function loadFull(client, ctx, id) {
  const b = await repo.findById(client, ctx.appId, ctx.tenantId, id)
  if (!b) throw new NotFoundError('booking')
  const resourceIds = await repo.listResources(client, ctx.appId, ctx.tenantId, id)
  const events      = await repo.listEvents(client, ctx.appId, ctx.tenantId, id)
  return { ...b, resourceIds, events }
}

export async function createBooking(ctx, body) {
  if (!body.resourceIds?.length) throw new ValidationError('at least one resourceId required')
  if (new Date(body.endsAt) <= new Date(body.startsAt)) throw new ValidationError('endsAt must be after startsAt')

  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    // Optional hold-on-create flow: client first calls POST /v1/availability/holds
    // to atomically reserve the slot, then sends holdId here. We re-validate
    // the hold matches the booking window/resource and consume it inside the
    // same transaction. The hold mechanism is what prevents two concurrent
    // /v1/bookings calls from selling the same slot to different clients.
    if (body.holdId) {
      const hold = await repo.consumeHold(c, ctx.appId, ctx.tenantId, body.holdId)
      if (!hold) throw new ConflictError('hold is invalid, expired, or already consumed')
      if (!body.resourceIds.includes(hold.resource_id)) {
        throw new ConflictError('hold resource does not match booking resources')
      }
      if (hold.starts_at.toISOString() !== new Date(body.startsAt).toISOString()
          || hold.ends_at.toISOString() !== new Date(body.endsAt).toISOString()) {
        throw new ConflictError('hold window does not match booking window')
      }
      if (hold.service_id !== body.serviceId) {
        throw new ConflictError('hold serviceId does not match booking serviceId')
      }
    }

    // Defence in depth: even when a valid hold was consumed we still run the
    // overlap-guarded insert. An overlap here means an existing non-cancelled
    // booking already owned the slot — e.g. from a recurrence-expander run
    // that bypassed the hold flow.
    const b = await repo.insertBookingAtomic(c, ctx.appId, ctx.tenantId, {
      ...body, subTenantId: ctx.subTenantId,
      clientUserId: body.clientUserId ?? ctx.userId,
      resourceIds: body.resourceIds,
    })
    if (!b) throw new ConflictError('slot already booked')

    for (const rid of body.resourceIds) {
      await repo.attachResource(c, ctx.appId, ctx.tenantId, b.id, rid)
    }
    await repo.recordEvent(c, ctx.appId, ctx.tenantId, b.id, null, b.status, ctx.userId, 'booking created')
    await publish({
      type: `booking.${b.status}`,
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, bookingId: b.id,
        serviceId: b.service_id, clientUserId: b.client_user_id,
        startsAt: b.starts_at, endsAt: b.ends_at,
        resourceIds: body.resourceIds,
      },
    })
    return loadFull(c, ctx, b.id)
  })
}

export async function getBooking(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    loadFull(c, ctx, id),
  )
}

export async function listBookings(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listBookings(c, ctx.appId, ctx.tenantId, opts),
  )
}

export async function changeStatus(ctx, id, toStatus, reason) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const b = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!b) throw new NotFoundError('booking')
    if (!transitionAllowed(b.status, toStatus)) {
      throw new ConflictError(`cannot transition booking from ${b.status} to ${toStatus}`)
    }
    const updated = await repo.setStatus(c, ctx.appId, ctx.tenantId, id, toStatus)
    await repo.recordEvent(c, ctx.appId, ctx.tenantId, id, b.status, toStatus, ctx.userId, reason)
    const resourceIds = await repo.listResources(c, ctx.appId, ctx.tenantId, id)
    await publish({
      type: `booking.${toStatus}`,
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, bookingId: id,
        serviceId: updated.service_id, clientUserId: updated.client_user_id,
        startsAt: updated.starts_at, endsAt: updated.ends_at,
        resourceIds,
      },
    })
    return updated
  })
}

export async function reschedule(ctx, id, { startsAt, endsAt, reason }) {
  if (new Date(endsAt) <= new Date(startsAt)) throw new ValidationError('endsAt must be after startsAt')
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const b = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!b) throw new NotFoundError('booking')
    if (['cancelled','no_show','completed','rescheduled'].includes(b.status)) {
      throw new ConflictError(`cannot reschedule a ${b.status} booking`)
    }
    const updated = await repo.setStatus(c, ctx.appId, ctx.tenantId, id, 'rescheduled', { startsAt, endsAt })
    await repo.recordEvent(c, ctx.appId, ctx.tenantId, id, b.status, 'rescheduled', ctx.userId, reason ?? 'rescheduled')

    // Create the new booking row (status=confirmed) referencing the original.
    const cloned = await repo.insertBooking(c, ctx.appId, ctx.tenantId, {
      subTenantId: b.sub_tenant_id, serviceId: b.service_id,
      clientUserId: b.client_user_id, clientName: b.client_name,
      clientEmail: b.client_email, clientPhone: b.client_phone,
      startsAt, endsAt, status: 'confirmed',
      notes: b.notes, internalNotes: b.internal_notes,
      recurrenceId: b.recurrence_id, parentBookingId: id,
      packageId: b.package_id, priceCents: b.price_cents, currency: b.currency, source: b.source,
      metadata: b.metadata,
    })
    const resourceIds = await repo.listResources(c, ctx.appId, ctx.tenantId, id)
    for (const rid of resourceIds) {
      await repo.attachResource(c, ctx.appId, ctx.tenantId, cloned.id, rid)
    }
    await repo.recordEvent(c, ctx.appId, ctx.tenantId, cloned.id, null, 'confirmed', ctx.userId, 'rescheduled from ' + id)
    await publish({
      type: 'booking.rescheduled',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        oldBookingId: id, newBookingId: cloned.id, startsAt, endsAt,
      },
    })
    return loadFull(c, ctx, cloned.id)
  })
}

export async function cancelBooking(ctx, id, reason) {
  return changeStatus(ctx, id, 'cancelled', reason)
}

// Waitlist
export async function addToWaitlist(ctx, body) {
  const w = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.insertWaitlist(c, ctx.appId, ctx.tenantId, { ...body, clientUserId: body.clientUserId ?? ctx.userId }),
  )
  await publish({
    type: 'booking.waitlist.added',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, waitlistId: w.id, serviceId: w.service_id },
  })
  return w
}

export async function listWaitlist(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listWaitlist(c, ctx.appId, ctx.tenantId, opts),
  )
}

export async function notifyWaitlist(ctx, id) {
  const w = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.updateWaitlistStatus(c, ctx.appId, ctx.tenantId, id, 'notified'),
  )
  if (!w) throw new NotFoundError('waitlist entry')
  await publish({
    type: 'booking.waitlist.notified',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, waitlistId: id, clientPhone: w.client_phone },
  })
  return w
}
