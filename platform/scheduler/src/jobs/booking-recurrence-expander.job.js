// Every hour, materialize the next 30 days of bookings for each active
// recurrence row. This is the simple V1: a recurrence stores RRULE-light
// JSON {freq:'weekly', interval:1, byday:['MO','WE'], time:'18:00'} and an
// optional ends_on / count. We expand into concrete platform_bookings.bookings
// rows so they show up on calendars and so reminders/availability count them.
//
// Idempotency: each generated row carries recurrence_id + starts_at;
// (recurrence_id, starts_at) is the natural dedupe key. Re-running the job
// SKIPs slots that already have a row in bookings.

import crypto from 'node:crypto'

export const meta = {
  name:        'booking-recurrence-expander',
  cron:        '0 * * * *',
  description: 'Materialize 30 days of recurring bookings from rrule rows',
}

const HORIZON_DAYS = 30

const DAY_MAP = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

function* recurrenceInstances(rrule, startsOn, endsOn, count) {
  const freq      = rrule.freq ?? 'weekly'
  const interval  = Number(rrule.interval ?? 1)
  const byday     = (rrule.byday ?? []).map((d) => DAY_MAP[d]).filter((n) => n !== undefined)
  const [hh, mm]  = (rrule.time ?? '00:00').split(':').map(Number)
  const durationMin = Number(rrule.duration_minutes ?? 30)

  const startDate = new Date(startsOn + 'T00:00:00Z')
  const today     = new Date(); today.setUTCHours(0, 0, 0, 0)
  const horizon   = new Date(today.getTime() + HORIZON_DAYS * 24 * 60 * 60 * 1000)
  const hardStop  = endsOn ? new Date(endsOn + 'T23:59:59Z') : null

  let issued = 0
  let cursor = new Date(Math.max(startDate.getTime(), today.getTime()))

  if (freq === 'weekly' && byday.length) {
    // Walk forward day-by-day; emit when day-of-week matches and week-stride aligns.
    for (let d = new Date(cursor); d <= horizon; d.setUTCDate(d.getUTCDate() + 1)) {
      if (hardStop && d > hardStop) break
      if (count && issued >= count) break
      const weeksSinceStart = Math.floor((d - startDate) / (7 * 24 * 60 * 60 * 1000))
      if (weeksSinceStart % interval !== 0) continue
      if (!byday.includes(d.getUTCDay())) continue
      const start = new Date(d); start.setUTCHours(hh, mm, 0, 0)
      const end   = new Date(start.getTime() + durationMin * 60_000)
      yield { startsAt: start.toISOString(), endsAt: end.toISOString() }
      issued++
    }
  } else if (freq === 'daily') {
    for (let d = new Date(cursor); d <= horizon; d.setUTCDate(d.getUTCDate() + interval)) {
      if (hardStop && d > hardStop) break
      if (count && issued >= count) break
      const start = new Date(d); start.setUTCHours(hh, mm, 0, 0)
      const end   = new Date(start.getTime() + durationMin * 60_000)
      yield { startsAt: start.toISOString(), endsAt: end.toISOString() }
      issued++
    }
  }
}

export async function run({ db, logger }) {
  const { rows: recurrences } = await db.query(
    `SELECT id, app_id, tenant_id, rrule, starts_on, ends_on, count, metadata
     FROM platform_bookings.recurrences`,
  )
  let total = 0
  for (const r of recurrences) {
    const instances = [...recurrenceInstances(r.rrule, r.starts_on, r.ends_on, r.count)]
    if (!instances.length) continue
    for (const inst of instances) {
      // Take the seed booking (the first one created for this recurrence) to
      // copy service_id / resourceIds / client info onto each generated row.
      // If no seed exists yet, skip this recurrence — staff has to create
      // booking #1 manually with recurrence_id set, then the job clones the rest.
      const { rows: seed } = await db.query(
        `SELECT b.service_id, b.client_user_id, b.client_name, b.client_email, b.client_phone,
                b.notes, b.metadata, b.source
         FROM platform_bookings.bookings b
         WHERE b.app_id=$1 AND b.tenant_id=$2 AND b.recurrence_id=$3
         ORDER BY b.created_at ASC LIMIT 1`,
        [r.app_id, r.tenant_id, r.id],
      )
      if (!seed.length) continue
      const s = seed[0]

      // Has this exact instance already been materialized?
      const { rows: existing } = await db.query(
        `SELECT id FROM platform_bookings.bookings
         WHERE app_id=$1 AND tenant_id=$2 AND recurrence_id=$3 AND starts_at=$4`,
        [r.app_id, r.tenant_id, r.id, inst.startsAt],
      )
      if (existing.length) continue

      const newId = crypto.randomUUID()
      await db.query(
        `INSERT INTO platform_bookings.bookings
          (id, app_id, tenant_id, service_id, client_user_id, client_name, client_email, client_phone,
           starts_at, ends_at, status, notes, metadata, recurrence_id, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmed',$11,$12,$13,'recurrence')`,
        [
          newId, r.app_id, r.tenant_id, s.service_id, s.client_user_id, s.client_name, s.client_email, s.client_phone,
          inst.startsAt, inst.endsAt, s.notes ?? null, s.metadata ?? {}, r.id,
        ],
      )

      // Mirror booking_resources from the seed.
      await db.query(
        `INSERT INTO platform_bookings.booking_resources (app_id, tenant_id, booking_id, resource_id)
         SELECT $1, $2, $3, br.resource_id
         FROM platform_bookings.booking_resources br
         JOIN platform_bookings.bookings b ON b.id = br.booking_id
         WHERE b.app_id=$1 AND b.tenant_id=$2 AND b.recurrence_id=$4
         ORDER BY b.created_at ASC LIMIT 1`,
        [r.app_id, r.tenant_id, newId, r.id],
      )

      await db.query(
        `INSERT INTO platform_bookings.booking_events
          (app_id, tenant_id, booking_id, from_status, to_status, reason)
         VALUES ($1,$2,$3,NULL,'confirmed','expanded from recurrence')`,
        [r.app_id, r.tenant_id, newId],
      )
      total++
    }
  }
  if (total) logger.info({ count: total }, 'recurrence instances materialized')
  return { rowsAffected: total }
}
