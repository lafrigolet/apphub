// FSM de bookings (platform-appointments). Mapa autoritativo en
// bookings.service.js#TRANSITIONS:
//
//   requested    → confirmed | cancelled | rescheduled
//   confirmed    → reminded | checked_in | cancelled | no_show | rescheduled
//   reminded     → checked_in | cancelled | no_show | rescheduled
//   checked_in   → in_progress | cancelled | no_show
//   in_progress  → completed | cancelled
//   completed    → (terminal)
//   cancelled    → (terminal)
//   no_show      → (terminal)
//   rescheduled  → (terminal: el clon vive en una row nueva con status='requested' o 'confirmed')

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../lib/db.js', () => ({
  pool: { connect: vi.fn() },
  withTenantTransaction: vi.fn(),
}))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/bookings.repository.js')

import { changeStatus } from '../services/bookings.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo from '../repositories/bookings.repository.js'

const ctx = { appId: 'yoga', tenantId: '00000000-0000-0000-0000-000000000001', subTenantId: null, userId: 'u1', role: 'admin' }
const ID  = 'b-1'

function mockClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn(mockClient()))
  repo.setStatus.mockImplementation(async (_c, _a, _t, _id, s) => ({
    id: ID, status: s, service_id: 'svc', client_user_id: 'cli', starts_at: '2026-06-01T09:00:00Z', ends_at: '2026-06-01T10:00:00Z',
  }))
  repo.listResources.mockResolvedValue([])
})

// ── Allowed transitions ──────────────────────────────────────────────

const ALLOWED = [
  ['requested',   'confirmed'],
  ['requested',   'cancelled'],
  ['requested',   'rescheduled'],
  ['confirmed',   'reminded'],
  ['confirmed',   'checked_in'],
  ['confirmed',   'cancelled'],
  ['confirmed',   'no_show'],
  ['confirmed',   'rescheduled'],
  ['reminded',    'checked_in'],
  ['reminded',    'cancelled'],
  ['reminded',    'no_show'],
  ['reminded',    'rescheduled'],
  ['checked_in',  'in_progress'],
  ['checked_in',  'cancelled'],
  ['checked_in',  'no_show'],
  ['in_progress', 'completed'],
  ['in_progress', 'cancelled'],
]

describe('transiciones permitidas', () => {
  for (const [from, to] of ALLOWED) {
    it(`${from} → ${to} ✓`, async () => {
      repo.findById.mockResolvedValue({ id: ID, status: from })
      await expect(changeStatus(ctx, ID, to, 'test')).resolves.toBeDefined()
      expect(repo.setStatus).toHaveBeenCalledWith(expect.anything(), ctx.appId, ctx.tenantId, ID, to)
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: `booking.${to}` }),
      )
    })
  }
})

// ── Forbidden transitions ────────────────────────────────────────────

const FORBIDDEN = [
  // No saltar a estados imposibles desde requested
  ['requested',   'reminded'],
  ['requested',   'checked_in'],
  ['requested',   'in_progress'],
  ['requested',   'completed'],
  ['requested',   'no_show'],
  // No volver atrás
  ['confirmed',   'requested'],
  ['checked_in',  'confirmed'],
  ['in_progress', 'checked_in'],
  // Saltos imposibles
  ['confirmed',   'in_progress'],
  ['confirmed',   'completed'],
  ['checked_in',  'completed'],
  // Terminales no salen
  ['completed',   'cancelled'],
  ['completed',   'rescheduled'],
  ['cancelled',   'confirmed'],
  ['no_show',     'completed'],
  ['rescheduled', 'confirmed'],
]

describe('transiciones prohibidas → 409 ConflictError', () => {
  for (const [from, to] of FORBIDDEN) {
    it(`${from} → ${to} ✗`, async () => {
      repo.findById.mockResolvedValue({ id: ID, status: from })
      await expect(changeStatus(ctx, ID, to)).rejects.toMatchObject({ statusCode: 409 })
      expect(repo.setStatus).not.toHaveBeenCalled()
      expect(publish).not.toHaveBeenCalled()
    })
  }
})

// ── Terminal states ────────────────────────────────────────────────

describe('estados terminales', () => {
  for (const terminal of ['completed', 'cancelled', 'no_show', 'rescheduled']) {
    it(`${terminal} es terminal — cualquier transición → 409`, async () => {
      repo.findById.mockResolvedValue({ id: ID, status: terminal })
      for (const target of ['confirmed', 'checked_in', 'completed', 'cancelled']) {
        if (target === terminal) continue
        repo.setStatus.mockClear()
        await expect(changeStatus(ctx, ID, target)).rejects.toMatchObject({ statusCode: 409 })
        expect(repo.setStatus).not.toHaveBeenCalled()
      }
    })
  }
})

describe('not-found', () => {
  it('booking inexistente → NotFoundError 404', async () => {
    repo.findById.mockResolvedValue(null)
    await expect(changeStatus(ctx, 'ghost', 'confirmed')).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('record event histórico', () => {
  it('cada transición persiste un event con from, to, actor y reason', async () => {
    repo.findById.mockResolvedValue({ id: ID, status: 'confirmed' })
    await changeStatus(ctx, ID, 'checked_in', 'cliente se presentó 10min antes')
    expect(repo.recordEvent).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, ID,
      'confirmed', 'checked_in', ctx.userId, 'cliente se presentó 10min antes',
    )
  })
})
