import crypto from 'node:crypto'
import { pool, withTenantTransaction } from '../lib/db.js'
import { publish, redis } from '../lib/redis.js'
import * as repo from '../repositories/availability.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'

// Default slot granularity when a service doesn't override step_minutes.
const DEFAULT_STEP_MINUTES = 15

// Slot-grid cache TTL. Per-resource version key bumps on every hold /
// release so cache lookups always include the freshest reservation state.
const SLOT_CACHE_TTL_SECONDS = 60

function slotCacheKey(appId, tenantId, version, params) {
  const sig = crypto.createHash('sha1')
    .update(JSON.stringify(params))
    .digest('hex').slice(0, 16)
  return `availability:slots:${appId}:${tenantId}:v${version}:${sig}`
}

function resourceVersionKey(appId, tenantId, resourceId) {
  return `availability:rv:${appId}:${tenantId}:${resourceId}`
}

async function readResourceVersions(appId, tenantId, resourceIds) {
  if (!resourceIds.length) return '0'
  const keys = resourceIds.map((id) => resourceVersionKey(appId, tenantId, id))
  const vals = await redis.mget(...keys)
  return vals.map((v) => v ?? '0').join(':')
}

async function bumpResourceVersion(appId, tenantId, resourceId) {
  await redis.incr(resourceVersionKey(appId, tenantId, resourceId))
}

// Event-driven cache invalidation (recommendation #3). When platform/resources
// publishes `resource.unavailable` (a new exception was created) the cached
// slot grid for that resource is stale, so we bump its version. Failures are
// swallowed: a missed bump only means slots stay cached up to the 60s TTL.
export async function invalidateResourceCache(appId, tenantId, resourceId) {
  if (!appId || !tenantId || !resourceId) return
  try { await bumpResourceVersion(appId, tenantId, resourceId) } catch (_e) {}
}

// Max horizon a single "next available" rolling-forward search may scan,
// independent of any per-service booking window (recommendation #5).
const NEXT_AVAILABLE_MAX_DAYS = 90

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

// Clamp [from,to] to the service's booking window (recommendation #2):
//   - min_advance_minutes: a slot may not start sooner than now + N minutes
//     (forbids unmanageable last-minute bookings).
//   - max_advance_days: a slot may not start further than now + N days
//     (caps how far ahead the calendar is open).
// Returns the effective window, or null when the window collapses to empty
// (e.g. the whole requested range is too soon or too far) so the caller can
// short-circuit to [].
function applyBookingWindow(svc, fromDate, toDate, now = new Date()) {
  const minAdvance = Number(svc.min_advance_minutes ?? 0)
  const maxDays    = svc.max_advance_days == null ? null : Number(svc.max_advance_days)
  let effFrom = fromDate
  let effTo   = toDate
  if (minAdvance > 0) {
    const earliest = addMinutes(now, minAdvance)
    if (earliest > effFrom) effFrom = earliest
  }
  if (maxDays != null) {
    const latest = addMinutes(now, maxDays * 24 * 60)
    if (latest < effTo) effTo = latest
  }
  if (!(effFrom < effTo)) return null
  return { effFrom, effTo }
}

export async function listSlots(ctx, { serviceId, resourceId, from, to }) {
  if (!from || !to) throw new ValidationError('from/to required')
  const reqFrom = new Date(from)
  const reqTo   = new Date(to)
  if (!(reqFrom < reqTo)) throw new ValidationError('from must be before to')

  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const svc = await repo.getServiceById(c, ctx.appId, ctx.tenantId, serviceId)
    if (!svc) throw new NotFoundError('service')

    // Booking window (#2): narrow the requested range before computing.
    const win = applyBookingWindow(svc, reqFrom, reqTo)
    if (!win) return []
    const fromDate = win.effFrom
    const toDate   = win.effTo

    const baseResources = resourceId
      ? await repo.getResourcesForService(c, ctx.appId, ctx.tenantId, serviceId)
          .then((all) => all.filter((r) => r.id === resourceId))
      : await repo.getResourcesForService(c, ctx.appId, ctx.tenantId, serviceId)
    if (!baseResources.length) return []

    // Cache key: hash of params + per-resource version stamps. Any hold or
    // release on a covered resource bumps the version, so the next read
    // computes from scratch and writes a fresh entry.
    const resourceIds = baseResources.map((r) => r.id)
    const version = await readResourceVersions(ctx.appId, ctx.tenantId, resourceIds)
    const cacheKey = slotCacheKey(ctx.appId, ctx.tenantId, version, {
      serviceId, resourceIds, from: fromDate.toISOString(), to: toDate.toISOString(),
    })
    try {
      const cached = await redis.get(cacheKey)
      if (cached) return JSON.parse(cached)
    } catch (_e) { /* fall through to compute */ }

    const stepMinutes = Number(svc.step_minutes) > 0 ? Number(svc.step_minutes) : DEFAULT_STEP_MINUTES
    const totalMinutes = svc.duration_minutes + (svc.buffer_before_minutes ?? 0) + (svc.buffer_after_minutes ?? 0)
    const serviceCapacity = Math.max(1, Number(svc.capacity ?? 1))

    const slots = []
    for (const r of baseResources) {
      const resourceCapacity = Math.max(1, Number(r.capacity ?? 1))
      // Effective capacity = min(service.capacity, resource.capacity). For a
      // 1:1 booking this stays at 1 and behaviour matches the previous code.
      const slotCapacity = Math.min(serviceCapacity, resourceCapacity)

      const workHours  = await repo.getWorkHours(c, ctx.appId, ctx.tenantId, r.id)
      const exceptions = await repo.getExceptions(c, ctx.appId, ctx.tenantId, r.id, fromDate.toISOString(), toDate.toISOString())
      const bookings   = await repo.getBusyBookings(c, ctx.appId, ctx.tenantId, r.id, fromDate.toISOString(), toDate.toISOString())
      const holds      = await repo.getActiveHolds(c, ctx.appId, ctx.tenantId, r.id, fromDate.toISOString(), toDate.toISOString())
      // Exceptions still hard-block (resource is unavailable). Bookings and
      // holds are countable against capacity for group-class workflows.
      const hardBlocks = exceptions.map((e) => ({ start: new Date(e.starts_at), end: new Date(e.ends_at) }))
      const consumers  = [
        ...bookings.map((b) => ({ start: new Date(b.starts_at), end: new Date(b.ends_at) })),
        ...holds.map((h)    => ({ start: new Date(h.starts_at), end: new Date(h.ends_at) })),
      ]

      for (let day = startOfDayUTC(fromDate); day < toDate; day = addMinutes(day, 24 * 60)) {
        for (const win of workingWindows(workHours, day)) {
          let cursor = new Date(Math.max(win.start, fromDate))
          const rem = cursor.getMinutes() % stepMinutes
          if (rem) cursor = addMinutes(cursor, stepMinutes - rem)
          while (true) {
            const slotEnd = addMinutes(cursor, totalMinutes)
            if (slotEnd > win.end || slotEnd > toDate) break
            const isHardBlocked = hardBlocks.some((b) => rangesOverlap(cursor, slotEnd, b.start, b.end))
            if (!isHardBlocked) {
              const used = consumers.filter((b) => rangesOverlap(cursor, slotEnd, b.start, b.end)).length
              const remaining = slotCapacity - used
              if (remaining > 0) {
                slots.push({
                  resourceId: r.id,
                  startsAt:   addMinutes(cursor, svc.buffer_before_minutes ?? 0).toISOString(),
                  endsAt:     addMinutes(cursor, (svc.buffer_before_minutes ?? 0) + svc.duration_minutes).toISOString(),
                  capacity:   slotCapacity,
                  remaining,
                })
              }
            }
            cursor = addMinutes(cursor, stepMinutes)
          }
        }
      }
    }
    slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt))

    try { await redis.set(cacheKey, JSON.stringify(slots), 'EX', SLOT_CACHE_TTL_SECONDS) } catch (_e) {}
    return slots
  })
}

// Recommendation #5: "next available" rolling-forward search. Instead of the
// widget pulling a wide slot grid and taking the first element, this scans
// forward in 7-day windows from `after` (default now) and returns the single
// earliest slot. listSlots already clamps each window to the service booking
// window (min_advance_minutes / max_advance_days), so once the service's
// max_advance_days is exceeded every window yields [] and the loop stops at
// the NEXT_AVAILABLE_MAX_DAYS hard cap.
export async function nextAvailable(ctx, { serviceId, resourceId, after }) {
  const afterDate = after ? new Date(after) : new Date()
  if (Number.isNaN(afterDate.getTime())) throw new ValidationError('after must be a valid datetime')

  // Walk forward in 7-day windows so a single listSlots call computes a
  // bounded grid; stop at the first non-empty window.
  const chunkDays = 7
  let cursorFrom = afterDate
  const hardEnd = addMinutes(afterDate, NEXT_AVAILABLE_MAX_DAYS * 24 * 60)
  while (cursorFrom < hardEnd) {
    const cursorTo = new Date(Math.min(
      addMinutes(cursorFrom, chunkDays * 24 * 60).getTime(),
      hardEnd.getTime(),
    ))
    const slots = await listSlots(ctx, {
      serviceId, resourceId,
      from: cursorFrom.toISOString(),
      to:   cursorTo.toISOString(),
    })
    if (slots.length) return slots[0]
    cursorFrom = cursorTo
  }
  return null
}

export async function holdSlot(ctx, { serviceId, resourceId, startsAt, endsAt, ttlSeconds = 300 }) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    await repo.purgeExpiredHolds(c, ctx.appId, ctx.tenantId)
    const h = await repo.insertHoldAtomic(c, ctx.appId, ctx.tenantId, {
      serviceId, resourceId, startsAt, endsAt,
      clientUserId: ctx.userId, ttlSeconds,
    })
    if (!h) throw new ConflictError('slot is no longer available')
    await bumpResourceVersion(ctx.appId, ctx.tenantId, resourceId)
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
  const released = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    // Read first so we know which resource to invalidate, then delete.
    const { rows } = await c.query(
      `SELECT resource_id FROM platform_availability.holds WHERE app_id=$1 AND tenant_id=$2 AND id=$3`,
      [ctx.appId, ctx.tenantId, holdId],
    )
    const ok = await repo.deleteHold(c, ctx.appId, ctx.tenantId, holdId)
    return ok ? rows[0]?.resource_id ?? null : null
  })
  if (released === null) throw new NotFoundError('hold')
  if (released) await bumpResourceVersion(ctx.appId, ctx.tenantId, released)
  await publish({
    type: 'availability.released',
    payload: { appId: ctx.appId, tenantId: ctx.tenantId, holdId },
  })
}
