// digest.service — cobertura de summarize() para los 7 tipos digestables +
// default. summarize se llama sin locale en flushAll → siempre rama ES.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
const fakeRedis = vi.hoisted(() => ({
  scan: vi.fn(), rename: vi.fn(), lrange: vi.fn(), del: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({ redis: fakeRedis }))
vi.mock('../lib/db.js', () => ({ pool: { connect: vi.fn().mockResolvedValue({ release: vi.fn() }) } }))
vi.mock('../repositories/config.repository.js', () => ({ getValue: vi.fn() }))
vi.mock('../services/template-renderer.js', () => ({ renderTemplate: vi.fn().mockResolvedValue(null) }))

import { flushAll } from '../services/digest.service.js'

beforeEach(() => vi.clearAllMocks())

it('summarize cubre los 7 tipos + default en una flush', async () => {
  const entries = [
    { to: 'a@x', eventType: 'booking.confirmed', payload: { startsAt: 'd1' }, locale: 'es' },
    { to: 'a@x', eventType: 'booking.cancelled', payload: { startsAt: 'd2' }, locale: 'es' },
    { to: 'a@x', eventType: 'booking.rescheduled', payload: { startsAt: 'd3' }, locale: 'es' },
    { to: 'a@x', eventType: 'reservation.created', payload: { reservedFor: 'd4', partySize: 2 }, locale: 'es' },
    { to: 'a@x', eventType: 'reservation.cancelled', payload: { reservedFor: 'd5' }, locale: 'es' },
    { to: 'a@x', eventType: 'package.exhausted', payload: {}, locale: 'es' },
    { to: 'a@x', eventType: 'payout.paid', payload: { amount: '10', periodLabel: 'May' }, locale: 'es' },
    { to: 'a@x', eventType: 'unknown.event', payload: {}, locale: 'es' },
  ]
  fakeRedis.scan.mockResolvedValueOnce(['0', ['nd:digest:u1']])
  fakeRedis.rename.mockResolvedValue('OK')
  fakeRedis.lrange.mockResolvedValue(entries.map((e) => JSON.stringify(e)))
  fakeRedis.del.mockResolvedValue(1)

  const send = vi.fn().mockResolvedValue()
  const r = await flushAll({ send })
  expect(r).toEqual({ usersFlushed: 1, eventsSent: 8 })
  const body = send.mock.calls[0][0]
  expect(body.text).toContain('Cita confirmada')
  expect(body.text).toContain('Reserva recibida')
  expect(body.text).toContain('Liquidación')
  expect(body.text).toContain('unknown.event')
})

it('entradas todas malformadas → eventos vacíos, no envía (continue)', async () => {
  fakeRedis.scan.mockResolvedValueOnce(['0', ['nd:digest:u2']])
  fakeRedis.rename.mockResolvedValue('OK')
  fakeRedis.lrange.mockResolvedValue(['{bad', 'also-bad'])
  fakeRedis.del.mockResolvedValue(1)
  const send = vi.fn()
  const r = await flushAll({ send })
  expect(send).not.toHaveBeenCalled()
  expect(r).toEqual({ usersFlushed: 0, eventsSent: 0 })
})
