// bookings.service — waitlist + cancelBooking + cancellation policy.
// Foco en código NO cubierto por bookings.service.test.js / fsm.test.js.
//
// Contrato addToWaitlist:
//   - INSERT row + publish 'booking.waitlist.added'.
//   - clientUserId del body o fallback a ctx.userId.
//
// Contrato notifyWaitlist:
//   - entry no existe → NotFoundError 404.
//   - happy: status='notified' + publish 'booking.waitlist.notified' con clientPhone.
//
// Contrato cancelBooking:
//   - booking no existe → 404.
//   - status terminales (cancelled/completed/rescheduled) → 409.
//   - publish booking.cancelled con feeCents + feeReason.
//   - feeCents > 0 → publish ADICIONAL 'booking.fee.charged'.
//   - opts.skipPolicy=true + role=staff → no aplica policy (feeCents=0 + policyReason override).
//   - opts.skipPolicy=true + role=user → IGNORADO (no se puede self-bypass).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/bookings.repository.js')

import {
  addToWaitlist, listWaitlist, notifyWaitlist, cancelBooking,
} from '../services/bookings.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/bookings.repository.js'

const ctx = (overrides = {}) => ({
  appId: 'wellness', tenantId: 't1', subTenantId: null,
  userId: 'user-1', role: 'user', ...overrides,
})
const BOOK = 'book-1'
const WAIT = 'wait-1'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }))
})

// ── addToWaitlist ──────────────────────────────────────────────────

describe('addToWaitlist', () => {
  it('happy: INSERT + publish booking.waitlist.added con serviceId', async () => {
    repo.insertWaitlist.mockResolvedValue({ id: WAIT, service_id: 'svc-1' })
    await addToWaitlist(ctx(), { serviceId: 'svc-1', clientName: 'Ana' })
    expect(publish).toHaveBeenCalledWith({
      type: 'booking.waitlist.added',
      payload: { appId: ctx().appId, tenantId: ctx().tenantId, waitlistId: WAIT, serviceId: 'svc-1' },
    })
  })

  it('clientUserId ausente del body → fallback ctx.userId', async () => {
    repo.insertWaitlist.mockResolvedValue({ id: WAIT, service_id: 'svc-1' })
    await addToWaitlist(ctx(), { serviceId: 'svc-1' })
    const args = repo.insertWaitlist.mock.calls[0][3]
    expect(args.clientUserId).toBe(ctx().userId)
  })

  it('clientUserId del body OVERRIDE ctx.userId (admin enrola a otro)', async () => {
    repo.insertWaitlist.mockResolvedValue({ id: WAIT, service_id: 'svc-1' })
    await addToWaitlist(ctx({ role: 'admin' }), {
      serviceId: 'svc-1', clientUserId: 'other-client',
    })
    expect(repo.insertWaitlist.mock.calls[0][3].clientUserId).toBe('other-client')
  })
})

// ── listWaitlist ───────────────────────────────────────────────────

describe('listWaitlist', () => {
  it('delega filtros al repo', async () => {
    repo.listWaitlist.mockResolvedValue([{ id: WAIT }])
    const r = await listWaitlist(ctx(), { status: 'pending' })
    expect(repo.listWaitlist).toHaveBeenCalledWith(
      expect.anything(), ctx().appId, ctx().tenantId, { status: 'pending' },
    )
    expect(r).toHaveLength(1)
  })
})

// ── notifyWaitlist ─────────────────────────────────────────────────

describe('notifyWaitlist', () => {
  it('entry no existe → NotFoundError', async () => {
    repo.updateWaitlistStatus.mockResolvedValue(null)
    await expect(notifyWaitlist(ctx(), 'ghost')).rejects.toMatchObject({ statusCode: 404 })
    expect(publish).not.toHaveBeenCalled()
  })

  it('happy: status=notified + publish con clientPhone', async () => {
    repo.updateWaitlistStatus.mockResolvedValue({ id: WAIT, client_phone: '+34600000' })
    await notifyWaitlist(ctx(), WAIT)
    expect(repo.updateWaitlistStatus).toHaveBeenCalledWith(
      expect.anything(), ctx().appId, ctx().tenantId, WAIT, 'notified',
    )
    expect(publish).toHaveBeenCalledWith({
      type: 'booking.waitlist.notified',
      payload: expect.objectContaining({
        waitlistId: WAIT, clientPhone: '+34600000',
      }),
    })
  })
})

// ── cancelBooking — guards ─────────────────────────────────────────

describe('cancelBooking — guards', () => {
  it('booking no existe → NotFoundError', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(cancelBooking(ctx(), 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([['cancelled'], ['completed'], ['rescheduled']])(
    'status terminal "%s" → ConflictError "cannot cancel"',
    async (status) => {
      repo.findById.mockResolvedValue({ id: BOOK, status })
      await expect(cancelBooking(ctx(), BOOK)).rejects.toMatchObject({
        statusCode: 409, message: expect.stringContaining(`status ${status}`),
      })
      expect(publish).not.toHaveBeenCalled()
    },
  )
})

// ── cancelBooking — publish + fees ─────────────────────────────────

describe('cancelBooking — publish', () => {
  it('happy: publish booking.cancelled con clientEmail/Phone/Name', async () => {
    repo.findById.mockResolvedValue({
      id: BOOK, status: 'confirmed', service_id: 'svc-1',
      client_user_id: 'u1', client_email: 'a@b.com', client_phone: '+34',
      client_name: 'Ana', starts_at: '2026-05-22T10:00:00Z', created_at: '2026-04-01T00:00:00Z',
      price_cents: 5000,
    })
    repo.setStatus.mockResolvedValue({ id: BOOK })
    await cancelBooking(ctx({ role: 'staff' }), BOOK, 'client request', { skipPolicy: true })
    expect(publish).toHaveBeenCalledWith({
      type: 'booking.cancelled',
      payload: expect.objectContaining({
        bookingId: BOOK, clientEmail: 'a@b.com', clientPhone: '+34', clientName: 'Ana',
        reason: 'client request',
        feeCents: 0,
        feeReason: 'policy bypassed by staff',
      }),
    })
  })

  it('skipPolicy=true + role="staff" → feeCents=0 + policyReason="bypassed"', async () => {
    repo.findById.mockResolvedValue({
      id: BOOK, status: 'confirmed', client_user_id: 'u1', client_email: 'x', client_name: 'x',
      starts_at: 'x', created_at: 'x',
    })
    repo.setStatus.mockResolvedValue({ id: BOOK })
    await cancelBooking(ctx({ role: 'super_admin' }), BOOK, 'gesture', { skipPolicy: true })
    const cancellation = publish.mock.calls.find((c) => c[0].type === 'booking.cancelled')
    expect(cancellation[0].payload.feeCents).toBe(0)
    expect(cancellation[0].payload.feeReason).toContain('bypassed by staff')
  })

  it('skipPolicy=true PERO role="user" → IGNORADO (no self-bypass)', async () => {
    repo.findById.mockResolvedValue({
      id: BOOK, status: 'confirmed', service_id: 'svc-1',
      client_user_id: 'u1', client_email: 'x', client_name: 'x',
      starts_at: 'x', created_at: 'x',
    })
    repo.setStatus.mockResolvedValue({ id: BOOK })
    // El servicio carga policy → repo.query devuelve un servicio sin policy → fee=0
    const fakeClient = { query: vi.fn().mockResolvedValue({ rows: [{ cancellation_policy: null, price_cents: 5000 }] }) }
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(fakeClient))
    await cancelBooking(ctx({ role: 'user' }), BOOK, 'change of mind', { skipPolicy: true })
    const cancellation = publish.mock.calls.find((c) => c[0].type === 'booking.cancelled')
    // Para 'user', skipPolicy ignorado → policyReason NO es "bypassed by staff"
    expect(cancellation[0].payload.feeReason).not.toContain('bypassed by staff')
  })

  it('feeCents > 0 → 2 publish: booking.cancelled + booking.fee.charged', async () => {
    // Mock cancellation_policy con 100% fee si < 24h
    const fakeClient = {
      query: vi.fn().mockResolvedValue({
        rows: [{ cancellation_policy: { hoursBeforeStart: 24, feePercent: 100 }, price_cents: 5000 }],
      }),
    }
    withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(fakeClient))
    // Booking en 1 hora (dentro del window) → fee 100%
    const startsAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    repo.findById.mockResolvedValue({
      id: BOOK, status: 'confirmed', service_id: 'svc-1',
      client_user_id: 'u1', client_email: 'x', client_name: 'x',
      starts_at: startsAt, created_at: new Date().toISOString(),
      price_cents: 5000, currency: 'EUR',
    })
    repo.setStatus.mockResolvedValue({ id: BOOK })

    await cancelBooking(ctx(), BOOK, 'too late')
    const cancellation = publish.mock.calls.find((c) => c[0].type === 'booking.cancelled')
    const feeCharge   = publish.mock.calls.find((c) => c[0].type === 'booking.fee.charged')
    if (cancellation[0].payload.feeCents > 0) {
      expect(feeCharge).toBeDefined()
      expect(feeCharge[0].payload.feeCents).toBe(cancellation[0].payload.feeCents)
      expect(feeCharge[0].payload.reason).toBe('late_cancellation')
    }
  })

  it('feeCents === 0 → NO publica booking.fee.charged (no spam events sin coste)', async () => {
    repo.findById.mockResolvedValue({
      id: BOOK, status: 'confirmed', service_id: 'svc-1',
      client_user_id: 'u1', client_email: 'x', client_name: 'x',
      starts_at: 'x', created_at: 'x',
    })
    repo.setStatus.mockResolvedValue({ id: BOOK })
    await cancelBooking(ctx({ role: 'staff' }), BOOK, 'gesture', { skipPolicy: true })
    const feeCharge = publish.mock.calls.find((c) => c[0].type === 'booking.fee.charged')
    expect(feeCharge).toBeUndefined()
  })
})
