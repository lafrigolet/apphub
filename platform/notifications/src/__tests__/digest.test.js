// digest.service — buffer eventos no-urgentes y enviar 1 email/usuario/día.
// Contrato:
//   - DIGESTABLE = whitelist explícito (booking.confirmed, booking.cancelled,
//     booking.rescheduled, reservation.created, reservation.cancelled,
//     package.exhausted, payout.paid). Time-critical (reminders, OTP) NUNCA.
//   - shouldDigest: false si no en whitelist; false si mode != 'daily'.
//   - enqueueDigest:
//       · userId o to ausente → no-op.
//       · RPUSH al list `nd:digest:<userId>` + EXPIRE 7d.
//   - flushAll:
//       · Requiere send callback (else throw).
//       · SCAN cursor + rename atomic (race-safe entre workers).
//       · No items en queue → continue, no envío.
//       · Subject EN/ES diferenciado por locale.
//       · Errores en send se loguean (entries perdidas, deliberado).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const fakeRedis = vi.hoisted(() => ({
  scan: vi.fn(),
  rename: vi.fn(),
  lrange: vi.fn(),
  del: vi.fn(),
  multi: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({ redis: fakeRedis }))
const fakeClient = vi.hoisted(() => ({ release: vi.fn() }))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn().mockResolvedValue(fakeClient) },
}))
const configRepoMock = vi.hoisted(() => ({ getValue: vi.fn() }))
vi.mock('../repositories/config.repository.js', () => configRepoMock)
vi.mock('../services/template-renderer.js', () => ({
  renderTemplate: vi.fn().mockResolvedValue(null),
}))

import {
  shouldDigest, enqueueDigest, flushAll, invalidateDigestModeCache,
} from '../services/digest.service.js'

beforeEach(() => {
  vi.clearAllMocks()
  invalidateDigestModeCache()
})

// ── shouldDigest — whitelist + mode ────────────────────────────────

describe('shouldDigest — whitelist', () => {
  it.each([
    'booking.confirmed', 'booking.cancelled', 'booking.rescheduled',
    'reservation.created', 'reservation.cancelled',
    'package.exhausted', 'payout.paid',
  ])('whitelist + mode="daily" → true (%s)', async (eventType) => {
    configRepoMock.getValue.mockResolvedValue('daily')
    expect(await shouldDigest(eventType)).toBe(true)
  })

  it.each([
    'booking.reminder.due', 'auth.password_reset', 'splitpay.invoice.paid',
    'random.event',
  ])('time-critical o no-whitelist → false (%s)', async (eventType) => {
    configRepoMock.getValue.mockResolvedValue('daily')
    expect(await shouldDigest(eventType)).toBe(false)
  })

  it('mode != "daily" → false aunque esté en whitelist', async () => {
    configRepoMock.getValue.mockResolvedValue('off')
    expect(await shouldDigest('booking.confirmed')).toBe(false)
  })

  it('mode null (config ausente) → default "off" → false', async () => {
    configRepoMock.getValue.mockResolvedValue(null)
    expect(await shouldDigest('booking.confirmed')).toBe(false)
  })
})

// ── enqueueDigest ───────────────────────────────────────────────────

describe('enqueueDigest', () => {
  function setupMulti() {
    const pipe = {
      rpush: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    }
    fakeRedis.multi.mockReturnValue(pipe)
    return pipe
  }

  it('userId ausente → no-op (no Redis writes)', async () => {
    await enqueueDigest({ to: 'a@b.com', eventType: 'booking.confirmed', payload: {} })
    expect(fakeRedis.multi).not.toHaveBeenCalled()
  })

  it('to ausente → no-op', async () => {
    await enqueueDigest({ userId: 'u1', eventType: 'booking.confirmed', payload: {} })
    expect(fakeRedis.multi).not.toHaveBeenCalled()
  })

  it('happy: RPUSH al list "nd:digest:<userId>" + EXPIRE 7d', async () => {
    const pipe = setupMulti()
    await enqueueDigest({
      userId: 'u1', to: 'a@b.com',
      eventType: 'booking.confirmed', payload: { startsAt: '2026-05-22T10:00:00Z' },
      locale: 'es',
    })
    expect(pipe.rpush).toHaveBeenCalledWith('nd:digest:u1', expect.any(String))
    expect(pipe.expire).toHaveBeenCalledWith('nd:digest:u1', 7 * 86400)
  })

  it('entry serializada incluye eventType + payload + locale + ts', async () => {
    const pipe = setupMulti()
    await enqueueDigest({
      userId: 'u1', to: 'a@b.com',
      eventType: 'booking.confirmed', payload: { x: 1 },
      locale: 'en',
    })
    const entry = JSON.parse(pipe.rpush.mock.calls[0][1])
    expect(entry).toMatchObject({
      to: 'a@b.com', eventType: 'booking.confirmed',
      payload: { x: 1 }, locale: 'en',
    })
    expect(entry.ts).toBeTypeOf('number')
  })

  it('locale default = "es"', async () => {
    const pipe = setupMulti()
    await enqueueDigest({ userId: 'u1', to: 'a@b.com', eventType: 'booking.confirmed', payload: {} })
    const entry = JSON.parse(pipe.rpush.mock.calls[0][1])
    expect(entry.locale).toBe('es')
  })
})

// ── flushAll ────────────────────────────────────────────────────────

describe('flushAll', () => {
  it('send callback ausente → throw (DI requirement)', async () => {
    await expect(flushAll({})).rejects.toThrow(/requires a send/)
    await expect(flushAll()).rejects.toThrow(/requires a send/)
  })

  it('queue vacía → 0 users, 0 events', async () => {
    fakeRedis.scan.mockResolvedValue(['0', []])
    const r = await flushAll({ send: vi.fn() })
    expect(r).toEqual({ usersFlushed: 0, eventsSent: 0 })
  })

  it('happy: 1 user con 3 eventos → 1 send, eventsSent=3', async () => {
    fakeRedis.scan.mockResolvedValue(['0', ['nd:digest:u1']])
    fakeRedis.rename.mockResolvedValue('OK')
    fakeRedis.lrange.mockResolvedValue([
      JSON.stringify({ to: 'a@b.com', eventType: 'booking.confirmed', payload: { startsAt: '2026-05-22T10:00:00Z' }, locale: 'es' }),
      JSON.stringify({ to: 'a@b.com', eventType: 'booking.cancelled', payload: { startsAt: '2026-05-23T10:00:00Z' }, locale: 'es' }),
      JSON.stringify({ to: 'a@b.com', eventType: 'package.exhausted', payload: {}, locale: 'es' }),
    ])
    const send = vi.fn().mockResolvedValue(undefined)
    const r = await flushAll({ send })
    expect(r).toEqual({ usersFlushed: 1, eventsSent: 3 })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'a@b.com',
      subject: expect.stringContaining('resumen de AppHub'),
    }))
  })

  it('locale="en" → subject inglés', async () => {
    fakeRedis.scan.mockResolvedValue(['0', ['nd:digest:u1']])
    fakeRedis.rename.mockResolvedValue('OK')
    fakeRedis.lrange.mockResolvedValue([
      JSON.stringify({ to: 'a@b.com', eventType: 'booking.confirmed', payload: { startsAt: 'x' }, locale: 'en' }),
    ])
    const send = vi.fn().mockResolvedValue()
    await flushAll({ send })
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      subject: expect.stringContaining('AppHub digest'),
    }))
  })

  it('rename falla (race con otro worker) → skip ese key, continúa', async () => {
    fakeRedis.scan.mockResolvedValue(['0', ['nd:digest:u1', 'nd:digest:u2']])
    fakeRedis.rename
      .mockRejectedValueOnce(new Error('no such key'))
      .mockResolvedValueOnce('OK')
    fakeRedis.lrange.mockResolvedValue([
      JSON.stringify({ to: 'b@c.com', eventType: 'booking.confirmed', payload: { startsAt: 'x' }, locale: 'es' }),
    ])
    const send = vi.fn().mockResolvedValue()
    const r = await flushAll({ send })
    expect(send).toHaveBeenCalledTimes(1)
    expect(r.usersFlushed).toBe(1)
  })

  it('items malformados (JSON inválido) se skipen, válidos siguen', async () => {
    fakeRedis.scan.mockResolvedValue(['0', ['nd:digest:u1']])
    fakeRedis.rename.mockResolvedValue('OK')
    fakeRedis.lrange.mockResolvedValue([
      '{not json',                                                           // skip
      JSON.stringify({ to: 'a@b.com', eventType: 'booking.confirmed', payload: { startsAt: 'x' }, locale: 'es' }),
    ])
    const send = vi.fn().mockResolvedValue()
    const r = await flushAll({ send })
    expect(r.eventsSent).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('send falla → log.error, NO crashea (entries lost — deliberado V1)', async () => {
    fakeRedis.scan.mockResolvedValue(['0', ['nd:digest:u1']])
    fakeRedis.rename.mockResolvedValue('OK')
    fakeRedis.lrange.mockResolvedValue([
      JSON.stringify({ to: 'a@b.com', eventType: 'booking.confirmed', payload: { startsAt: 'x' }, locale: 'es' }),
    ])
    const send = vi.fn().mockRejectedValue(new Error('SMTP down'))
    const log = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const r = await flushAll({ send, logger: log })
    expect(log.error).toHaveBeenCalled()
    expect(r).toEqual({ usersFlushed: 0, eventsSent: 0 })
  })

  it('lista vacía (después de rename) → continue, no send', async () => {
    fakeRedis.scan.mockResolvedValue(['0', ['nd:digest:u1']])
    fakeRedis.rename.mockResolvedValue('OK')
    fakeRedis.lrange.mockResolvedValue([])
    const send = vi.fn().mockResolvedValue()
    const r = await flushAll({ send })
    expect(send).not.toHaveBeenCalled()
    expect(r).toEqual({ usersFlushed: 0, eventsSent: 0 })
  })
})
