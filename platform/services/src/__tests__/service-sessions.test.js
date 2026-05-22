// service-sessions.service — sesiones (clases programadas, talleres) de un service.
// Contrato:
//   - validateWindow: startsAt/endsAt válidos; endsAt > startsAt → ValidationError.
//   - createSession: service no existe → 404; publish 'service.session.scheduled'.
//   - listSessionsByService: 404 si service no existe.
//   - getSession: 404 si session no existe.
//   - updateSession:
//       · Si patch incluye AMBOS startsAt + endsAt → revalidate window.
//       · Si solo uno se pasa → NO revalidate (parche parcial confía en DB).
//       · NotFound si update devuelve null.
//   - cancelSession:
//       · 404 si no existe.
//       · status='cancelled' (idempotente — re-cancel devuelve row).
//       · status='completed' → ConflictError "cannot cancel completed".
//       · happy → publish 'service.session.cancelled'.
//   - listPublicUpcoming: appId/tenantId requeridos (else ValidationError).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../lib/env.js', () => ({
  env: { NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: 'postgresql://x@y/z', REDIS_URL: 'redis://localhost' },
}))
vi.mock('../lib/db.js', () => ({ pool: {}, withTenantTransaction: vi.fn() }))
vi.mock('../lib/redis.js', () => ({ publish: vi.fn() }))
vi.mock('../repositories/service-sessions.repository.js')
vi.mock('../repositories/services.repository.js')

import {
  createSession, listSessionsByService, getSession,
  updateSession, cancelSession, listPublicUpcoming,
} from '../services/service-sessions.service.js'
import { withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as sessionRepo from '../repositories/service-sessions.repository.js'
import * as servicesRepo from '../repositories/services.repository.js'

const ctx = { appId: 'wellness', tenantId: 't1', subTenantId: null }
const SVC = 'svc-1'
const SESS = 'sess-1'

beforeEach(() => {
  vi.clearAllMocks()
  withTenantTransaction.mockImplementation(async (_p, _a, _t, _s, fn) => fn({}))
})

// ── validateWindow ──────────────────────────────────────────────────

describe('createSession — validate window', () => {
  it('startsAt no-fecha → ValidationError', async () => {
    await expect(createSession(ctx, SVC, {
      startsAt: 'banana', endsAt: '2026-05-22T11:00:00Z',
    })).rejects.toMatchObject({ statusCode: 422, message: expect.stringContaining('invalid date') })
  })

  it('endsAt no-fecha → ValidationError', async () => {
    await expect(createSession(ctx, SVC, {
      startsAt: '2026-05-22T10:00:00Z', endsAt: 'no-date',
    })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('endsAt < startsAt → ValidationError "must be after"', async () => {
    await expect(createSession(ctx, SVC, {
      startsAt: '2026-05-22T11:00:00Z', endsAt: '2026-05-22T10:00:00Z',
    })).rejects.toMatchObject({
      statusCode: 422, message: expect.stringContaining('after startsAt'),
    })
  })

  it('endsAt === startsAt → ValidationError (window debe ser positiva)', async () => {
    await expect(createSession(ctx, SVC, {
      startsAt: '2026-05-22T10:00:00Z', endsAt: '2026-05-22T10:00:00Z',
    })).rejects.toMatchObject({ statusCode: 422 })
  })
})

// ── createSession ───────────────────────────────────────────────────

describe('createSession', () => {
  it('service no existe → NotFoundError', async () => {
    servicesRepo.findById.mockResolvedValue(null)
    await expect(createSession(ctx, 'ghost', {
      startsAt: '2026-05-22T10:00:00Z', endsAt: '2026-05-22T11:00:00Z',
    })).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: persiste + publish service.session.scheduled', async () => {
    servicesRepo.findById.mockResolvedValue({ id: SVC })
    sessionRepo.insert.mockResolvedValue({
      id: SESS, starts_at: '2026-05-22T10:00:00Z', ends_at: '2026-05-22T11:00:00Z',
    })
    await createSession(ctx, SVC, {
      startsAt: '2026-05-22T10:00:00Z', endsAt: '2026-05-22T11:00:00Z',
      capacity: 10,
    })
    expect(publish).toHaveBeenCalledWith({
      type: 'service.session.scheduled',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        serviceId: SVC, sessionId: SESS,
        startsAt: '2026-05-22T10:00:00Z', endsAt: '2026-05-22T11:00:00Z',
      },
    })
  })
})

// ── listSessionsByService + getSession ─────────────────────────────

describe('listSessionsByService', () => {
  it('service no existe → NotFoundError', async () => {
    servicesRepo.findById.mockResolvedValue(null)
    await expect(listSessionsByService(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('happy: delega filtros al repo', async () => {
    servicesRepo.findById.mockResolvedValue({ id: SVC })
    sessionRepo.listByService.mockResolvedValue([{ id: SESS }])
    const r = await listSessionsByService(ctx, SVC, { upcoming: true })
    expect(sessionRepo.listByService).toHaveBeenCalledWith(
      expect.anything(), ctx.appId, ctx.tenantId, SVC, { upcoming: true },
    )
    expect(r).toHaveLength(1)
  })
})

describe('getSession', () => {
  it('session no existe → 404', async () => {
    sessionRepo.findById.mockResolvedValue(null)
    await expect(getSession(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── updateSession ───────────────────────────────────────────────────

describe('updateSession', () => {
  it('startsAt + endsAt JUNTOS → revalidate; window invalida → ValidationError', async () => {
    await expect(updateSession(ctx, SESS, {
      startsAt: '2026-05-22T11:00:00Z', endsAt: '2026-05-22T10:00:00Z',
    })).rejects.toMatchObject({ statusCode: 422 })
    expect(sessionRepo.update).not.toHaveBeenCalled()
  })

  it('solo startsAt (sin endsAt) → NO revalidate; delega', async () => {
    sessionRepo.update.mockResolvedValue({ id: SESS })
    await updateSession(ctx, SESS, { startsAt: '2026-05-22T10:00:00Z' })
    expect(sessionRepo.update).toHaveBeenCalled()
  })

  it('return null del repo → NotFoundError 404', async () => {
    sessionRepo.update.mockResolvedValue(null)
    await expect(updateSession(ctx, 'ghost', { capacity: 20 })).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ── cancelSession ───────────────────────────────────────────────────

describe('cancelSession', () => {
  it('session no existe → 404', async () => {
    sessionRepo.findById.mockResolvedValue(null)
    await expect(cancelSession(ctx, 'ghost')).rejects.toMatchObject({ statusCode: 404 })
    expect(publish).not.toHaveBeenCalled()
  })

  it('status="cancelled" (re-cancel) → idempotent, NO llama cancel(), pero publica', async () => {
    sessionRepo.findById.mockResolvedValue({ id: SESS, status: 'cancelled', service_id: SVC, starts_at: 'x' })
    await cancelSession(ctx, SESS)
    expect(sessionRepo.cancel).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'service.session.cancelled' }))
  })

  it('status="completed" → ConflictError "cannot cancel completed"', async () => {
    sessionRepo.findById.mockResolvedValue({ id: SESS, status: 'completed' })
    await expect(cancelSession(ctx, SESS)).rejects.toMatchObject({
      statusCode: 409, message: expect.stringContaining('completed'),
    })
    expect(publish).not.toHaveBeenCalled()
  })

  it('happy: status="scheduled" → cancel + publish con sessionId/serviceId/startsAt', async () => {
    sessionRepo.findById.mockResolvedValue({ id: SESS, status: 'scheduled' })
    sessionRepo.cancel.mockResolvedValue({
      id: SESS, service_id: SVC, starts_at: '2026-05-22T10:00:00Z',
    })
    await cancelSession(ctx, SESS)
    expect(publish).toHaveBeenCalledWith({
      type: 'service.session.cancelled',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        sessionId: SESS, serviceId: SVC, startsAt: '2026-05-22T10:00:00Z',
      },
    })
  })
})

// ── listPublicUpcoming ─────────────────────────────────────────────

describe('listPublicUpcoming', () => {
  it('appId/tenantId requeridos → ValidationError', async () => {
    await expect(listPublicUpcoming({})).rejects.toMatchObject({ statusCode: 422 })
    await expect(listPublicUpcoming({ appId: 'a' })).rejects.toMatchObject({ statusCode: 422 })
    await expect(listPublicUpcoming({ tenantId: 't' })).rejects.toMatchObject({ statusCode: 422 })
  })

  it('happy: scope = (appId, tenantId, sub=null) explícitos del param', async () => {
    sessionRepo.listUpcomingPublic.mockResolvedValue([{ id: SESS }])
    const r = await listPublicUpcoming({ appId: 'aulavera', tenantId: 't1' }, { limit: 10 })
    expect(withTenantTransaction).toHaveBeenCalledWith(
      expect.anything(), 'aulavera', 't1', null, expect.any(Function),
    )
    expect(r).toHaveLength(1)
  })
})
