import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '@apphub/platform-sdk/errors'
import { withTenantTransaction } from '../lib/db.js'
import { publishEvent } from '../lib/redis.js'
import * as sessionsRepo from '../repositories/cash-sessions.repository.js'
import * as movementsRepo from '../repositories/cash-movements.repository.js'
import * as countsRepo from '../repositories/cash-counts.repository.js'
import * as devicesRepo from '../repositories/devices.repository.js'
import * as settingsRepo from '../repositories/settings.repository.js'
import * as zReportsRepo from '../repositories/z-reports.repository.js'
import { buildSessionAggregates } from './reports.service.js'

const MANAGER_ROLES = ['manager', 'owner', 'admin', 'staff', 'super_admin']

export async function openSession(identity, { deviceId, openingFloatCents = 0 }) {
  const session = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const device = await devicesRepo.findById(c, deviceId)
    if (!device) throw new NotFoundError('Device not found')
    if (!device.active) throw new ConflictError('Device is deactivated')
    try {
      const s = await sessionsRepo.insert(c, {
        appId: identity.appId,
        tenantId: identity.tenantId,
        subTenantId: identity.subTenantId ?? null,
        deviceId,
        openedBy: identity.userId,
        openingFloatCents,
      })
      if (openingFloatCents > 0) {
        await movementsRepo.insert(c, {
          appId: identity.appId,
          tenantId: identity.tenantId,
          subTenantId: identity.subTenantId ?? null,
          sessionId: s.id,
          kind: 'opening_float',
          amountCents: openingFloatCents,
          reason: 'Fondo inicial de caja',
          actorId: identity.userId,
          source: 'manual',
        })
      }
      return s
    } catch (err) {
      // índice parcial uq_tpv_sessions_open_per_device
      if (err.code === '23505') throw new ConflictError('Device already has an open session')
      throw err
    }
  })
  await publishEvent('tpv.session.opened', {
    appId: identity.appId, tenantId: identity.tenantId, subTenantId: identity.subTenantId ?? null,
    sessionId: session.id, deviceId, openedBy: identity.userId, openingFloatCents,
  })
  return session
}

export async function listSessions(identity, filters) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, (c) =>
    sessionsRepo.list(c, filters))
}

export async function getSession(identity, id) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const session = await sessionsRepo.findById(c, id)
    if (!session) throw new NotFoundError('Session not found')
    const [movements, counts, theoreticalCashCents] = await Promise.all([
      movementsRepo.listBySession(c, id),
      countsRepo.listBySession(c, id),
      movementsRepo.sumCashBySession(c, id),
    ])
    return { ...session, movements, counts, theoreticalCashCents }
  })
}

// Cierre: el cajero declara el conteo por método; el teórico de efectivo sale
// de los movimientos. La variance solo compara efectivo (el resto de métodos
// se concilia contra pasarela/banco, no contra el cajón).
export async function closeSession(identity, id, { declared, varianceReason }) {
  const { closed, zReport } = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const session = await sessionsRepo.findById(c, id)
    if (!session) throw new NotFoundError('Session not found')
    if (session.status !== 'open') throw new ConflictError(`Session is ${session.status}`)
    const theoreticalCashCents = await movementsRepo.sumCashBySession(c, id)
    const declaredCashCents = Number(declared?.cash ?? 0)
    const varianceCents = declaredCashCents - theoreticalCashCents
    const closed = await sessionsRepo.close(c, id, {
      closedBy: identity.userId,
      declaredClose: declared ?? {},
      theoreticalClose: { cash: theoreticalCashCents },
      varianceCents,
      varianceReason,
    })
    if (!closed) throw new ConflictError('Session is no longer open')

    // Informe Z: snapshot inmutable del cierre, en la misma transacción.
    const aggregates = await buildSessionAggregates(c, closed)
    const snapshot = {
      kind: 'Z',
      ...aggregates,
      closedAt: closed.closed_at,
      closedBy: identity.userId,
      declaredClose: declared ?? {},
      varianceCents,
      varianceReason: varianceReason ?? null,
    }
    const number = await zReportsRepo.nextNumber(c, identity.appId, identity.tenantId)
    const zReport = await zReportsRepo.insert(c, {
      appId: identity.appId,
      tenantId: identity.tenantId,
      subTenantId: identity.subTenantId ?? null,
      sessionId: id,
      number,
      snapshot,
    })
    return { closed, zReport }
  })
  await publishEvent('tpv.session.closed', {
    appId: identity.appId, tenantId: identity.tenantId, subTenantId: identity.subTenantId ?? null,
    sessionId: closed.id, deviceId: closed.device_id, closedBy: identity.userId,
    varianceCents: Number(closed.variance_cents), zReportId: zReport.id,
  })
  await publishEvent('tpv.zreport.generated', {
    appId: identity.appId, tenantId: identity.tenantId, subTenantId: identity.subTenantId ?? null,
    zReportId: zReport.id, sessionId: closed.id, number: Number(zReport.number),
  })
  return { ...closed, zReport }
}

export async function reopenSession(identity, id) {
  const session = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    try {
      const reopened = await sessionsRepo.reopen(c, id)
      if (!reopened) throw new NotFoundError('Session not found or not closed')
      return reopened
    } catch (err) {
      if (err.code === '23505') throw new ConflictError('Device already has an open session')
      throw err
    }
  })
  await publishEvent('tpv.session.reopened', {
    appId: identity.appId, tenantId: identity.tenantId, subTenantId: identity.subTenantId ?? null,
    sessionId: session.id, deviceId: session.device_id, reopenedBy: identity.userId,
  })
  return session
}

// Arqueo intermedio (recuento ciego): deja constancia, no cierra.
export async function addCount(identity, sessionId, { counted, note }) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const session = await sessionsRepo.findById(c, sessionId)
    if (!session) throw new NotFoundError('Session not found')
    if (session.status !== 'open') throw new ConflictError(`Session is ${session.status}`)
    const expectedCents = await movementsRepo.sumCashBySession(c, sessionId)
    const countedCashCents = Number(counted?.cash ?? 0)
    return countsRepo.insert(c, {
      appId: identity.appId,
      tenantId: identity.tenantId,
      subTenantId: identity.subTenantId ?? null,
      sessionId,
      countedBy: identity.userId,
      counted,
      expectedCents,
      varianceCents: countedCashCents - expectedCents,
      note,
    })
  })
}

export async function addMovement(identity, sessionId, { kind, amountCents, reason }) {
  if (!['cash_in', 'cash_out'].includes(kind)) {
    throw new ValidationError('kind must be cash_in or cash_out')
  }
  const movement = await withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const session = await sessionsRepo.findById(c, sessionId)
    if (!session) throw new NotFoundError('Session not found')
    if (session.status !== 'open') throw new ConflictError(`Session is ${session.status}`)
    if (kind === 'cash_out') {
      const settings = await settingsRepo.getOrDefaults(c)
      const threshold = Number(settings.cash_out_manager_threshold_cents)
      if (amountCents > threshold && !MANAGER_ROLES.includes(identity.role)) {
        throw new ForbiddenError(`Cash-out above ${threshold} cents requires a manager`)
      }
    }
    return movementsRepo.insert(c, {
      appId: identity.appId,
      tenantId: identity.tenantId,
      subTenantId: identity.subTenantId ?? null,
      sessionId,
      kind,
      // importes con signo: salidas en negativo (CHECK en BD)
      amountCents: kind === 'cash_out' ? -Math.abs(amountCents) : Math.abs(amountCents),
      reason,
      actorId: identity.userId,
      source: 'manual',
    })
  })
  await publishEvent('tpv.cash.moved', {
    appId: identity.appId, tenantId: identity.tenantId, subTenantId: identity.subTenantId ?? null,
    sessionId, movementId: movement.id, kind, amountCents: Number(movement.amount_cents),
    reason: reason ?? null, actorId: identity.userId,
  })
  return movement
}

export async function listMovements(identity, sessionId) {
  return withTenantTransaction(identity.appId, identity.tenantId, identity.subTenantId, async (c) => {
    const session = await sessionsRepo.findById(c, sessionId)
    if (!session) throw new NotFoundError('Session not found')
    return movementsRepo.listBySession(c, sessionId)
  })
}
