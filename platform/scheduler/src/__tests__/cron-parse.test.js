// cron-parse — Cada job tiene meta.{name, cron, description} con un cron
// expression VÁLIDO para node-cron / cron-parser. Si alguien rompe el
// formato al añadir un job nuevo, este test cae antes de que el scheduler
// crashee en el arranque.
//
// Validamos la spec contra el regex de 5-field cron (no usamos cron-parser
// como dep; el chequeo es estricto pero sencillo).

import { describe, it, expect } from 'vitest'
import * as availabilityHoldPurge      from '../jobs/availability-hold-purge.job.js'
import * as bookingReminders            from '../jobs/booking-reminders.job.js'
import * as bookingRecurrenceExpander   from '../jobs/booking-recurrence-expander.job.js'
import * as reservationReminders        from '../jobs/reservation-reminders.job.js'
import * as packageExpiryWarning        from '../jobs/package-expiry-warning.job.js'
import * as packageExpiryTransition     from '../jobs/package-expiry-transition.job.js'
import * as practitionerPayoutClose     from '../jobs/practitioner-payout-close.job.js'
import * as disputeSla                  from '../jobs/dispute-sla.job.js'
import * as basketAbandoned             from '../jobs/basket-abandoned.job.js'
import * as storageOrphanPurge          from '../jobs/storage-orphan-purge.job.js'
import * as storageRetentionPurge       from '../jobs/storage-retention-purge.job.js'
import * as notificationDigest          from '../jobs/notification-digest.job.js'

// 5-field cron: minute hour day-of-month month day-of-week
// Cada campo permite: número, '*', '*/N', 'N-M', 'N,M,...', combinaciones.
const FIELD = String.raw`(\*|\*\/\d+|\d+(-\d+)?(\/\d+)?(,\d+(-\d+)?(\/\d+)?)*)`
const CRON_RE = new RegExp(`^${FIELD} ${FIELD} ${FIELD} ${FIELD} ${FIELD}$`)

function valid(expr) {
  if (typeof expr !== 'string') return false
  if (expr.split(' ').length !== 5) return false
  return CRON_RE.test(expr)
}

const ALL_JOBS = [
  ['availability-hold-purge',      availabilityHoldPurge,      '* * * * *'],
  ['booking-reminders',             bookingReminders,           '*/5 * * * *'],
  ['booking-recurrence-expander',   bookingRecurrenceExpander,  '0 * * * *'],
  ['reservation-reminders',         reservationReminders,       '*/5 * * * *'],
  ['package-expiry-warning',        packageExpiryWarning,       '0 8 * * *'],
  ['package-expiry-transition',     packageExpiryTransition,    '30 0 * * *'],
  ['practitioner-payout-close',     practitionerPayoutClose,    '0 2 * * *'],
  ['dispute-sla',                   disputeSla,                 '*/30 * * * *'],
  ['basket-abandoned',              basketAbandoned,            '0 * * * *'],
  ['storage-orphan-purge',          storageOrphanPurge,         null],   // matches CLAUDE.md spec — verify name only
  ['storage-retention-purge',       storageRetentionPurge,      null],
  ['notification-digest',           notificationDigest,         null],
]

// ── Estructura de meta ──────────────────────────────────────────────

describe('meta shape — todos los jobs', () => {
  it.each(ALL_JOBS)('%s: exporta meta.{name, cron, description}', (_label, mod) => {
    expect(mod.meta).toBeDefined()
    expect(typeof mod.meta.name).toBe('string')
    expect(mod.meta.name.length).toBeGreaterThan(0)
    expect(typeof mod.meta.cron).toBe('string')
    expect(mod.meta.cron.length).toBeGreaterThan(0)
    expect(typeof mod.meta.description).toBe('string')
  })

  it.each(ALL_JOBS)('%s: exporta función run()', (_label, mod) => {
    expect(typeof mod.run).toBe('function')
  })
})

// ── meta.name único (advisory-lock key) ──────────────────────────────

describe('uniqueness', () => {
  it('meta.name es único entre todos los jobs (key del advisory lock)', () => {
    const names = ALL_JOBS.map(([, mod]) => mod.meta.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('label del array y meta.name coinciden (regression — easy a olvidar al renombrar)', () => {
    for (const [label, mod] of ALL_JOBS) {
      expect(mod.meta.name).toBe(label)
    }
  })
})

// ── Cron expression válida ───────────────────────────────────────────

describe('cron expressions', () => {
  it.each(ALL_JOBS)('%s: cron pasa el regex de 5 campos', (_label, mod) => {
    expect(valid(mod.meta.cron)).toBe(true)
  })
})

// ── Cron expressions ESPERADAS según CLAUDE.md ───────────────────────

describe('cron expressions vs CLAUDE.md', () => {
  it.each(ALL_JOBS.filter(([, , expected]) => expected !== null))(
    '%s: cron coincide con la spec ("%s")',
    (_label, mod, expected) => {
      expect(mod.meta.cron).toBe(expected)
    },
  )
})

// ── Sanidad de campos ───────────────────────────────────────────────

describe('cron sanity (rangos válidos)', () => {
  it('todos los minutos están en [0, 59] o usan */N o *', () => {
    for (const [, mod] of ALL_JOBS) {
      const minute = mod.meta.cron.split(' ')[0]
      if (minute === '*' || minute.startsWith('*/')) continue
      for (const part of minute.split(',')) {
        const [start] = part.split('-')
        const [base]  = start.split('/')
        const n = Number(base)
        if (!Number.isNaN(n)) {
          expect(n).toBeGreaterThanOrEqual(0)
          expect(n).toBeLessThan(60)
        }
      }
    }
  })

  it('todas las horas están en [0, 23] o usan */N o *', () => {
    for (const [, mod] of ALL_JOBS) {
      const hour = mod.meta.cron.split(' ')[1]
      if (hour === '*' || hour.startsWith('*/')) continue
      for (const part of hour.split(',')) {
        const [start] = part.split('-')
        const [base]  = start.split('/')
        const n = Number(base)
        if (!Number.isNaN(n)) {
          expect(n).toBeGreaterThanOrEqual(0)
          expect(n).toBeLessThan(24)
        }
      }
    }
  })
})
