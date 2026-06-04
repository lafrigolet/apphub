// Priority backend-only upgrades:
//   1. min_advance_minutes / max_advance_days → checkBookingWindow (pure)
//      + evaluateBookingWindow (DB-backed) + create/update persistence.
//   2. cancellation_policy validated shape → validateCancellationPolicy.
//   3. i18n service_translations → list/upsert/remove + localized public catalog.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/services.repository.js')
vi.mock('../repositories/service-sessions.repository.js')

import {
  validateCancellationPolicy, checkBookingWindow, evaluateBookingWindow,
  createService, updateService,
  listTranslations, upsertTranslation, removeTranslation,
} from '../services/services.service.js'
import { listPublicUpcoming } from '../services/service-sessions.service.js'
import { withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/services.repository.js'
import * as sessionsRepo from '../repositories/service-sessions.repository.js'

const ctx = { appId: 'wellness', tenantId: 't1', subTenantId: null }
const SVC = 'svc-1'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── 1. cancellation policy validation (pure) ───────────────────────────

describe('validateCancellationPolicy', () => {
  it('null / undefined → ok', () => {
    expect(() => validateCancellationPolicy(null)).not.toThrow()
    expect(() => validateCancellationPolicy(undefined)).not.toThrow()
  })

  it('free-form policy without canonical keys → ok', () => {
    expect(() => validateCancellationPolicy({ note: 'call us', whatever: 1 })).not.toThrow()
  })

  it('valid canonical policy → ok', () => {
    expect(() => validateCancellationPolicy({
      hours_before_cancel: 24, refund_pct: 50, no_show_fee_cents: 1000,
    })).not.toThrow()
  })

  it('rejects non-object', () => {
    expect(() => validateCancellationPolicy([1, 2])).toThrow(/object/)
    expect(() => validateCancellationPolicy('str')).toThrow(/object/)
  })

  it('rejects refund_pct out of [0,100]', () => {
    expect(() => validateCancellationPolicy({ refund_pct: -1 })).toThrow(/refund_pct/)
    expect(() => validateCancellationPolicy({ refund_pct: 101 })).toThrow(/refund_pct/)
  })

  it('rejects negative hours_before_cancel', () => {
    expect(() => validateCancellationPolicy({ hours_before_cancel: -5 })).toThrow(/hours_before_cancel/)
  })

  it('rejects non-integer / negative no_show_fee_cents', () => {
    expect(() => validateCancellationPolicy({ no_show_fee_cents: -1 })).toThrow(/no_show_fee_cents/)
    expect(() => validateCancellationPolicy({ no_show_fee_cents: 9.9 })).toThrow(/no_show_fee_cents/)
  })

  it('createService rejects an invalid policy before hitting the repo', async () => {
    await expect(createService(ctx, {
      code: 'X', name: 'X', durationMinutes: 30, cancellationPolicy: { refund_pct: 200 },
    })).rejects.toMatchObject({ statusCode: 422 })
    expect(repo.insert).not.toHaveBeenCalled()
  })

  it('updateService validates the policy when present', async () => {
    await expect(updateService(ctx, SVC, { cancellationPolicy: { refund_pct: -3 } }))
      .rejects.toMatchObject({ statusCode: 422 })
    expect(repo.update).not.toHaveBeenCalled()
  })
})

// ── 1b. booking window (pure) ──────────────────────────────────────────

describe('checkBookingWindow', () => {
  const now = new Date('2026-06-01T12:00:00Z')

  it('no limits → always ok', () => {
    const r = checkBookingWindow({ min_advance_minutes: 0, max_advance_days: null }, '2026-06-01T12:00:00Z', now)
    expect(r).toEqual({ ok: true, reason: null })
  })

  it('too soon → reason too_soon', () => {
    const svc = { min_advance_minutes: 120, max_advance_days: null }
    // start 1h ahead, but 2h advance required
    const r = checkBookingWindow(svc, '2026-06-01T13:00:00Z', now)
    expect(r).toEqual({ ok: false, reason: 'too_soon' })
  })

  it('exactly at min advance → ok (inclusive)', () => {
    const svc = { min_advance_minutes: 120, max_advance_days: null }
    const r = checkBookingWindow(svc, '2026-06-01T14:00:00Z', now)
    expect(r.ok).toBe(true)
  })

  it('too far → reason too_far', () => {
    const svc = { min_advance_minutes: 0, max_advance_days: 7 }
    const r = checkBookingWindow(svc, '2026-06-15T12:00:00Z', now)  // 14 days ahead
    expect(r).toEqual({ ok: false, reason: 'too_far' })
  })

  it('within max advance → ok', () => {
    const svc = { min_advance_minutes: 0, max_advance_days: 30 }
    const r = checkBookingWindow(svc, '2026-06-15T12:00:00Z', now)
    expect(r.ok).toBe(true)
  })

  it('invalid date → ValidationError', () => {
    expect(() => checkBookingWindow({}, 'not-a-date', now)).toThrow(/invalid/)
  })
})

describe('evaluateBookingWindow (DB-backed)', () => {
  it('service missing → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(evaluateBookingWindow(ctx, 'ghost', '2026-06-01T12:00:00Z'))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('resolves service then checks window', async () => {
    repo.findById.mockResolvedValue({ id: SVC, min_advance_minutes: 60, max_advance_days: null })
    const future = new Date(Date.now() + 5 * 60000).toISOString()  // 5 min ahead
    const r = await evaluateBookingWindow(ctx, SVC, future)
    expect(r).toEqual({ ok: false, reason: 'too_soon' })
  })
})

describe('createService persists booking-window fields', () => {
  it('passes minAdvanceMinutes / maxAdvanceDays to the repo', async () => {
    repo.insert.mockResolvedValue({ id: SVC, code: 'C', modality: 'in_person' })
    await createService(ctx, {
      code: 'C', name: 'C', durationMinutes: 30,
      minAdvanceMinutes: 120, maxAdvanceDays: 30,
    })
    expect(repo.insert).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId,
      expect.objectContaining({ minAdvanceMinutes: 120, maxAdvanceDays: 30 }),
    )
  })
})

// ── 3. translations ────────────────────────────────────────────────────

describe('translations service', () => {
  it('listTranslations: service missing → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(listTranslations(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('listTranslations: delegates to repo', async () => {
    repo.findById.mockResolvedValue({ id: SVC })
    repo.listTranslations.mockResolvedValue([{ locale: 'es' }])
    const r = await listTranslations(ctx, SVC)
    expect(r).toEqual([{ locale: 'es' }])
  })

  it('upsertTranslation: lowercases locale and delegates', async () => {
    repo.findById.mockResolvedValue({ id: SVC })
    repo.upsertTranslation.mockResolvedValue({ id: 'tr1', locale: 'pt-br' })
    await upsertTranslation(ctx, SVC, { locale: 'PT-BR', name: 'Massagem' })
    expect(repo.upsertTranslation).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, SVC,
      expect.objectContaining({ locale: 'pt-br', name: 'Massagem' }),
    )
  })

  it('upsertTranslation: service missing → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(upsertTranslation(ctx, 'ghost', { locale: 'es' }))
      .rejects.toMatchObject({ statusCode: 404 })
  })

  it('removeTranslation: not found → NotFoundError', async () => {
    repo.deleteTranslation.mockResolvedValue(false)
    await expect(removeTranslation(ctx, SVC, 'es')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('removeTranslation: ok lowercases locale', async () => {
    repo.deleteTranslation.mockResolvedValue(true)
    await removeTranslation(ctx, SVC, 'ES')
    expect(repo.deleteTranslation).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, SVC, 'es',
    )
  })
})

// ── 3b. localized public catalog ───────────────────────────────────────

describe('listPublicUpcoming — i18n overlay', () => {
  const rows = [
    { service_id: 's1', service_name: 'Yoga', service_description: 'base' },
    { service_id: 's2', service_name: 'Pilates', service_description: 'base2' },
  ]

  it('no locale → returns rows unchanged, no translation lookup', async () => {
    sessionsRepo.listUpcomingPublic.mockResolvedValue(rows)
    const r = await listPublicUpcoming({ appId: 'a', tenantId: 't' }, { limit: 10 })
    expect(r).toEqual(rows)
    expect(repo.translationsForServices).not.toHaveBeenCalled()
  })

  it('locale → overlays translated name/description, falls back when missing', async () => {
    sessionsRepo.listUpcomingPublic.mockResolvedValue(rows)
    repo.translationsForServices.mockResolvedValue(
      new Map([['s1', { name: 'Yoga ES', description: 'desc ES' }]]),
    )
    const r = await listPublicUpcoming({ appId: 'a', tenantId: 't' }, { locale: 'ES', limit: 10 })
    expect(r[0]).toMatchObject({ service_name: 'Yoga ES', service_description: 'desc ES' })
    // s2 had no translation → unchanged
    expect(r[1]).toMatchObject({ service_name: 'Pilates', service_description: 'base2' })
    // locale lowercased before lookup
    expect(repo.translationsForServices).toHaveBeenCalledWith(
      expect.anything(), 'a', 't', ['s1', 's2'], 'es',
    )
  })

  it('locale but empty rows → no lookup', async () => {
    sessionsRepo.listUpcomingPublic.mockResolvedValue([])
    const r = await listPublicUpcoming({ appId: 'a', tenantId: 't' }, { locale: 'es' })
    expect(r).toEqual([])
    expect(repo.translationsForServices).not.toHaveBeenCalled()
  })

  it('translation present but null fields → keeps base text', async () => {
    sessionsRepo.listUpcomingPublic.mockResolvedValue([rows[0]])
    repo.translationsForServices.mockResolvedValue(
      new Map([['s1', { name: null, description: null }]]),
    )
    const r = await listPublicUpcoming({ appId: 'a', tenantId: 't' }, { locale: 'es' })
    expect(r[0]).toMatchObject({ service_name: 'Yoga', service_description: 'base' })
  })
})
