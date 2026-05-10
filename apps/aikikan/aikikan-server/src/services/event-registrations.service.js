import { ForbiddenError, NotFoundError, AppError } from '@apphub/platform-sdk/errors'
import { pool, withTenantTransaction } from '../lib/db.js'
import * as regRepo   from '../repositories/event-registrations.repository.js'
import * as eventRepo from '../repositories/events.repository.js'

const ADMIN_ROLES = new Set(['owner', 'admin'])

// Inscripciones del socio (con datos del evento embebidos).
export async function listMine(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    (client) => regRepo.findByUser(client, identity.userId),
  )
}

// Inscripciones de un evento (admin only — listado para gestionar
// asistencia).
export async function listForEvent(identity, eventId) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) {
    throw new ForbiddenError('Only owner/admin can list registrations')
  }
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    (client) => regRepo.findByEvent(client, eventId),
  )
}

// Auto-inscripción del socio. Validación: el evento debe existir y
// estar en el futuro. Idempotente: re-inscribirse tras cancelar
// reactiva la fila.
export async function register(identity, eventId) {
  if (!identity?.userId) throw new ForbiddenError()
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    async (client) => {
      const ev = await eventRepo.findById?.(client, eventId)
        ?? await fallbackFindEvent(client, eventId)
      if (!ev) throw new NotFoundError('Event')
      const today = new Date(); today.setHours(0, 0, 0, 0)
      if (new Date(ev.date) < today) {
        throw new AppError('EVENT_PAST', 'No te puedes inscribir a un evento pasado', 409)
      }
      return regRepo.register(client, {
        appId:       identity.appId,
        tenantId:    identity.tenantId,
        subTenantId: identity.subTenantId ?? null,
        eventId,
        userId:      identity.userId,
      })
    },
  )
}

// Cancelación por el propio socio. Falla si no estaba inscrito.
export async function cancel(identity, eventId) {
  if (!identity?.userId) throw new ForbiddenError()
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    async (client) => {
      const updated = await regRepo.cancel(client, eventId, identity.userId)
      if (!updated) {
        throw new NotFoundError('Registration')
      }
      return updated
    },
  )
}

// Marcar asistencia (admin). Idempotente — si ya estaba 'attended' devuelve la fila.
export async function markAttended(identity, registrationId) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) {
    throw new ForbiddenError('Only owner/admin can mark attendance')
  }
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    async (client) => {
      const r = await regRepo.markAttended(client, registrationId)
      if (!r) throw new NotFoundError('Registration')
      return r
    },
  )
}

// El events.repository actual sólo expone findAll/insert/deleteById. Para
// validar que el evento existe en register() hacemos un SELECT directo
// hasta que el repo se extienda — es un cambio menor que se haría en el
// mismo PR si vale la pena.
async function fallbackFindEvent(client, eventId) {
  const { rows } = await client.query(
    `SELECT id, date FROM app_aikikan.events WHERE id = $1`, [eventId],
  )
  return rows[0] ?? null
}
