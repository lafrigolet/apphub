import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/reservations.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'

const TRANSITIONS = {
  requested: ['confirmed','cancelled'],
  confirmed: ['seated','cancelled','no_show'],
  seated:    ['completed','cancelled'],
  completed: [],
  cancelled: [],
  no_show:   [],
}
const transitionAllowed = (f, t) => TRANSITIONS[f]?.includes(t) ?? false

// Statuses that free seating capacity once a reservation reaches them. When a
// reservation transitions into one of these we look for a waiting guest that
// now fits and auto-notify them (case-of-use #4).
const FREEING_STATUSES = new Set(['completed', 'cancelled', 'no_show'])

// Minutes-since-midnight (UTC) of a Date — service_hours store open/close as
// minute offsets and the restaurant's local calendar runs in the tenant's tz;
// V1 evaluates against UTC, matching how reserved_for is stored.
function minuteOfDay(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

// Validate `reserved_for` against service hours + blackouts + per-window
// capacity. Walk-ins skip the check (the guest is physically present and the
// hostess overrides). Tenants with no configured service_hours for the weekday
// are treated as "always open" so the feature is opt-in and backward
// compatible. Returns the matched service window (or null when unconstrained).
async function assertSlotAvailable(client, ctx, { reservedFor, durationMinutes, partySize, source }) {
  if (source === 'walk_in') return null

  const when = new Date(reservedFor)
  if (Number.isNaN(when.getTime())) throw new ValidationError('reservedFor is not a valid date')

  const blackout = await repo.findBlackoutCovering(client, ctx.appId, ctx.tenantId, reservedFor)
  if (blackout) throw new ConflictError(`reservation falls inside a blackout (${blackout.reason ?? 'closed'})`)

  const dow = when.getUTCDay()
  const windows = await repo.listOpenServiceHoursForDay(client, ctx.appId, ctx.tenantId, dow)
  if (windows.length === 0) return null // no hours configured → unconstrained

  const startMin = minuteOfDay(when)
  const endMin = startMin + (durationMinutes ?? 90)
  // The whole seating must fit inside an open window.
  const window = windows.find((w) => startMin >= w.open_minute && endMin <= w.close_minute)
  if (!window) throw new ConflictError('reservation is outside service hours')

  if (window.max_covers != null) {
    const to = new Date(when.getTime() + (durationMinutes ?? 90) * 60000).toISOString()
    const used = await repo.sumActiveCoversInWindow(client, ctx.appId, ctx.tenantId, reservedFor, to)
    if (used + partySize > window.max_covers) {
      throw new ConflictError('no capacity left for the requested service window')
    }
  }
  return window
}

export async function createReservation(ctx, body) {
  const r = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    await assertSlotAvailable(client, ctx, {
      reservedFor: body.reservedFor,
      durationMinutes: body.durationMinutes,
      partySize: body.partySize,
      source: body.source,
    })
    return repo.insertReservation(client, { ...body, appId: ctx.appId, tenantId: ctx.tenantId, subTenantId: ctx.subTenantId, guestUserId: ctx.userId })
  })
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

// Public availability: for a given calendar date + party size, return each
// open service window for that weekday with covers used / remaining. Windows
// without a max_covers cap report remaining: null (unlimited).
export async function checkAvailability(ctx, { date, partySize }) {
  const day = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(day.getTime())) throw new ValidationError('date must be YYYY-MM-DD')
  const dow = day.getUTCDay()

  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const windows = await repo.listOpenServiceHoursForDay(client, ctx.appId, ctx.tenantId, dow)
    const out = []
    for (const w of windows) {
      const from = new Date(day.getTime() + w.open_minute * 60000).toISOString()
      const to = new Date(day.getTime() + w.close_minute * 60000).toISOString()
      const used = await repo.sumActiveCoversInWindow(client, ctx.appId, ctx.tenantId, from, to)
      const remaining = w.max_covers == null ? null : Math.max(0, w.max_covers - used)
      out.push({
        serviceHoursId: w.id,
        serviceLabel: w.service_label,
        openMinute: w.open_minute,
        closeMinute: w.close_minute,
        maxCovers: w.max_covers,
        coversUsed: used,
        coversRemaining: remaining,
        available: remaining == null || remaining >= (partySize ?? 1),
      })
    }
    return { date, dayOfWeek: dow, partySize: partySize ?? null, windows: out }
  })
}

// Past no-show count for a guest (by user id when authenticated, else email).
export async function getGuestNoShowCount(ctx, { guestUserId, guestEmail }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const count = await repo.countNoShowsByGuest(client, ctx.appId, ctx.tenantId, { guestUserId, guestEmail })
    return { count }
  })
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

export async function changeStatus(ctx, id, toStatus, tableId, meta = {}) {
  const events = []
  const result = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (client) => {
    const r = await repo.findReservationById(client, ctx.appId, ctx.tenantId, id)
    if (!r) throw new NotFoundError('reservation')
    if (!transitionAllowed(r.status, toStatus)) {
      throw new ConflictError(`cannot transition reservation from ${r.status} to ${toStatus}`)
    }
    const updated = await repo.updateReservationStatus(client, ctx.appId, ctx.tenantId, id, toStatus, tableId, {
      cancelledBy: toStatus === 'cancelled' ? (meta.cancelledBy ?? 'staff') : null,
      cancellationReason: toStatus === 'cancelled' ? (meta.cancellationReason ?? null) : null,
    })
    events.push({
      type: `reservation.${toStatus}`,
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, reservationId: id,
        guestEmail: updated.guest_email, guestName: updated.guest_name,
        partySize: updated.party_size, reservedFor: updated.reserved_for,
        tableId: updated.table_id,
        cancelledBy: updated.cancelled_by, cancellationReason: updated.cancellation_reason,
      },
    })

    // A freeing transition opens capacity for the size that just left. If a
    // waiting guest now fits, mark them notified inside the same tx so the
    // queue advances atomically and emit waitlist.notified afterwards.
    if (FREEING_STATUSES.has(toStatus)) {
      const next = await repo.findNextWaitingForCapacity(client, ctx.appId, ctx.tenantId, updated.party_size)
      if (next) {
        const notified = await repo.updateWaitlistStatus(client, ctx.appId, ctx.tenantId, next.id, 'notified')
        events.push({
          type: 'waitlist.notified',
          payload: {
            appId: ctx.appId, tenantId: ctx.tenantId, waitlistId: notified.id,
            guestPhone: notified.guest_phone, guestName: notified.guest_name,
            reason: 'auto_table_freed', freedReservationId: id,
          },
        })
      }
    }
    return updated
  })
  for (const e of events) await publish(e)
  return result
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
