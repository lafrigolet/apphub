import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import * as repo         from '../repositories/service-sessions.repository.js'
import * as servicesRepo from '../repositories/services.repository.js'
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js'

function validateWindow(startsAt, endsAt) {
  const s = new Date(startsAt), e = new Date(endsAt)
  if (Number.isNaN(+s) || Number.isNaN(+e)) throw new ValidationError('invalid date')
  if (e <= s) throw new ValidationError('endsAt must be after startsAt')
}

export async function createSession(ctx, serviceId, body) {
  validateWindow(body.startsAt, body.endsAt)
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const svc = await servicesRepo.findById(c, ctx.appId, ctx.tenantId, serviceId)
    if (!svc) throw new NotFoundError('service')
    const session = await repo.insert(c, ctx.appId, ctx.tenantId, {
      ...body, serviceId, subTenantId: ctx.subTenantId,
    })
    await publish({
      type: 'service.session.scheduled',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        serviceId, sessionId: session.id,
        startsAt: session.starts_at, endsAt: session.ends_at,
      },
    })
    return session
  })
}

export async function listSessionsByService(ctx, serviceId, opts = {}) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const svc = await servicesRepo.findById(c, ctx.appId, ctx.tenantId, serviceId)
    if (!svc) throw new NotFoundError('service')
    return repo.listByService(c, ctx.appId, ctx.tenantId, serviceId, opts)
  })
}

export async function getSession(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const s = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!s) throw new NotFoundError('session')
    return s
  })
}

export async function updateSession(ctx, id, patch) {
  if (patch.startsAt !== undefined && patch.endsAt !== undefined) {
    validateWindow(patch.startsAt, patch.endsAt)
  }
  const updated = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.update(c, ctx.appId, ctx.tenantId, id, patch),
  )
  if (!updated) throw new NotFoundError('session')
  return updated
}

// Cancela la sesión. Las bookings ligadas a `session_id = this` siguen
// vivas — el cleanup lo dispara el subscriber del evento. Aquí solo
// marcamos la session como cancelada y emitimos `service.session.cancelled`
// para que bookings cancele las inscripciones colgantes (Fase 2 wiring).
export async function cancelSession(ctx, id) {
  const cancelled = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const cur = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!cur) throw new NotFoundError('session')
    if (cur.status === 'cancelled') return cur
    if (cur.status === 'completed') throw new ConflictError('cannot cancel a completed session')
    return repo.cancel(c, ctx.appId, ctx.tenantId, id)
  })
  await publish({
    type: 'service.session.cancelled',
    payload: {
      appId: ctx.appId, tenantId: ctx.tenantId, sessionId: cancelled.id,
      serviceId: cancelled.service_id, startsAt: cancelled.starts_at,
    },
  })
  return cancelled
}

// Catálogo público: requiere appId+tenantId explícitos en query (no
// JWT). Filtra a servicios con public_catalog=TRUE. Aplicamos el
// contexto RLS con el (appId, tenantId) que viene del caller — no
// concedemos bypass: si alguien pide otro tenant, RLS lo bloquea
// automáticamente y la query devuelve vacío.
export async function listPublicUpcoming({ appId, tenantId }, opts = {}) {
  if (!appId || !tenantId) throw new ValidationError('appId and tenantId required')
  const { locale, ...listOpts } = opts
  return withTenantTransaction(pool, appId, tenantId, null, async (c) => {
    const rows = await repo.listUpcomingPublic(c, appId, tenantId, listOpts)
    if (!locale || rows.length === 0) return rows
    // Overlay the requested locale onto service_name/service_description.
    // Falls back to the base (tenant-default) text when a translation is
    // missing for a given service.
    const serviceIds = [...new Set(rows.map((r) => r.service_id))]
    const tr = await servicesRepo.translationsForServices(
      c, appId, tenantId, serviceIds, locale.toLowerCase(),
    )
    return rows.map((r) => {
      const t = tr.get(r.service_id)
      if (!t) return r
      return {
        ...r,
        service_name:        t.name ?? r.service_name,
        service_description: t.description ?? r.service_description,
      }
    })
  })
}
