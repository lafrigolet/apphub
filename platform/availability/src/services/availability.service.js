import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/availability.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'

const STEP_MINUTES = 15  // slot granularity

function startOfDayUTC(d) {
  const x = new Date(d); x.setUTCHours(0, 0, 0, 0); return x
}
function addMinutes(d, m) { return new Date(d.getTime() + m * 60_000) }

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd
}

// Build candidate slot starts for a given resource on day `dayDate` (UTC).
function workingWindows(workHours, dayDate) {
  const dow = dayDate.getUTCDay()
  return workHours
    .filter((wh) => wh.day_of_week === dow)
    .filter((wh) => !wh.effective_from || dayDate >= new Date(wh.effective_from))
    .filter((wh) => !wh.effective_until || dayDate <= new Date(wh.effective_until))
    .map((wh) => ({
      start: addMinutes(dayDate, wh.start_minute),
      end:   addMinutes(dayDate, wh.end_minute),
    }))
}

export async function listSlots(ctx, { serviceId, resourceId, from, to }) {
  if (!from || !to) throw new ValidationError('from/to required')
  const fromDate = new Date(from)
  const toDate   = new Date(to)
  if (!(fromDate < toDate)) throw new ValidationError('from must be before to')

  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const svc = await repo.getServiceById(c, ctx.appId, ctx.tenantId, serviceId)
    if (!svc) throw new NotFoundError('service')

    const baseResources = resourceId
      ? [{ id: resourceId }]
      : await repo.getResourcesForService(c, ctx.appId, ctx.tenantId, serviceId)
    if (!baseResources.length) return []

    const slots = []
    for (const r of baseResources) {
      const workHours  = await repo.getWorkHours(c, ctx.appId, ctx.tenantId, r.id)
      const exceptions = await repo.getExceptions(c, ctx.appId, ctx.tenantId, r.id, fromDate.toISOString(), toDate.toISOString())
      const bookings   = await repo.getBusyBookings(c, ctx.appId, ctx.tenantId, r.id, fromDate.toISOString(), toDate.toISOString())
      const holds      = await repo.getActiveHolds(c, ctx.appId, ctx.tenantId, r.id, fromDate.toISOString(), toDate.toISOString())
      const busy = [
        ...exceptions.map((e) => ({ start: new Date(e.starts_at), end: new Date(e.ends_at) })),
        ...bookings.map((b)   => ({ start: new Date(b.starts_at), end: new Date(b.ends_at) })),
        ...holds.map((h)      => ({ start: new Date(h.starts_at), end: new Date(h.ends_at) })),
      ]

      const totalMinutes = svc.duration_minutes + (svc.buffer_before_minutes ?? 0) + (svc.buffer_after_minutes ?? 0)

      for (let day = startOfDayUTC(fromDate); day < toDate; day = addMinutes(day, 24 * 60)) {
        for (const win of workingWindows(workHours, day)) {
          let cursor = new Date(Math.max(win.start, fromDate))
          // Round cursor up to next STEP_MINUTES boundary.
          const rem = cursor.getMinutes() % STEP_MINUTES
          if (rem) cursor = addMinutes(cursor, STEP_MINUTES - rem)
          while (true) {
            const slotEnd = addMinutes(cursor, totalMinutes)
            if (slotEnd > win.end || slotEnd > toDate) break
            const blocked = busy.some((b) => rangesOverlap(cursor, slotEnd, b.start, b.end))
            if (!blocked) {
              slots.push({
                resourceId: r.id,
                startsAt:   addMinutes(cursor, svc.buffer_before_minutes ?? 0).toISOString(),
                endsAt:     addMinutes(cursor, (svc.buffer_before_minutes ?? 0) + svc.duration_minutes).toISOString(),
              })
            }
            cursor = addMinutes(cursor, STEP_MINUTES)
          }
        }
      }
    }
    slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    return slots
  })
}

export async function holdSlot(ctx, { serviceId, resourceId, startsAt, endsAt, ttlSeconds = 300 }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    await repo.purgeExpiredHolds(c, ctx.appId, ctx.tenantId)
    const h = await repo.insertHoldAtomic(c, ctx.appId, ctx.tenantId, {
      serviceId, resourceId, startsAt, endsAt,
      clientUserId: ctx.userId, ttlSeconds,
    })
    if (!h) throw new ConflictError('slot is no longer available')
    await publish({
      type: 'availability.held',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, holdId: h.id,
        serviceId, resourceId, startsAt, endsAt, expiresAt: h.expires_at,
      },
    })
    return h
  })
}

export async function releaseHold(ctx, holdId) {
  const ok = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.deleteHold(c, ctx.appId, ctx.tenantId, holdId),
  )
  if (!ok) throw new NotFoundError('hold')
  await publish({
    type: 'availability.released',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, holdId },
  })
}
