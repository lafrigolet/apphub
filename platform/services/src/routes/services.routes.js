import { z } from 'zod'
import * as service from '../services/services.service.js'
import * as sessions from '../services/service-sessions.service.js'

// Canonical cancellation policy. Extra keys are allowed (.passthrough) for
// app-specific flags; the service layer validates the canonical numeric
// ranges and the DB CHECK guards them defensively.
const cancellationPolicySchema = z.object({
  hours_before_cancel: z.number().min(0).optional(),
  refund_pct:          z.number().min(0).max(100).optional(),
  no_show_fee_cents:   z.number().int().min(0).optional(),
}).passthrough()

const serviceBody = z.object({
  code:                 z.string().min(1).max(64),
  name:                 z.string().min(1).max(256),
  description:          z.string().max(2048).optional(),
  category:             z.string().max(128).optional(),
  modality:             z.enum(['in_person','telehealth','at_home','hybrid']).optional(),
  durationMinutes:      z.number().int().positive(),
  bufferBeforeMinutes:  z.number().int().min(0).optional(),
  bufferAfterMinutes:   z.number().int().min(0).optional(),
  priceCents:           z.number().int().min(0).optional(),
  currency:             z.string().length(3).optional(),
  cancellationPolicy:   cancellationPolicySchema.optional(),
  requiresIntakeForm:   z.boolean().optional(),
  intakeFormId:         z.string().uuid().optional(),
  capacity:             z.number().int().min(1).optional(),
  minAge:               z.number().int().min(0).optional(),
  metadata:             z.record(z.any()).optional(),
  isActive:             z.boolean().optional(),
  // 'appointment' (default) = recurrente vía availability + slots.
  // 'event' = sólo se reserva contra service_sessions (sin slot grid).
  kind:                 z.enum(['appointment', 'event']).optional(),
  // Si TRUE, las sesiones de este servicio aparecen en el listado
  // público /v1/services/sessions/upcoming (consumido por landings).
  publicCatalog:        z.boolean().optional(),
  // Ventana de reserva. min_advance_minutes evita reservas de último
  // minuto; max_advance_days limita cuán lejos en el futuro se reserva.
  // platform/services SÓLO almacena/valida; el rechazo en el momento de
  // reservar lo aplica platform/bookings leyendo estas columnas.
  minAdvanceMinutes:    z.number().int().min(0).optional(),
  maxAdvanceDays:       z.number().int().positive().optional(),
})

const sessionBody = z.object({
  startsAt:               z.string().datetime(),
  endsAt:                 z.string().datetime(),
  capacity:               z.number().int().positive().optional(),
  resourceId:             z.string().uuid().optional(),
  priceCents:             z.number().int().min(0).optional(),
  currency:               z.string().length(3).optional(),
  location:               z.string().max(256).optional(),
  description:            z.string().max(2048).optional(),
  registrationClosesAt:   z.string().datetime().optional(),
  metadata:               z.record(z.any()).optional(),
})

const sessionUpdateBody = sessionBody.partial().extend({
  status: z.enum(['scheduled', 'cancelled', 'completed']).optional(),
})

const sessionIdParams = z.object({ sessionId: z.string().uuid() })
const localeSchema = z.string().regex(/^[a-z]{2}(-[a-z0-9]{2,8})?$/i)
const publicUpcomingQuery = z.object({
  appId:    z.string().min(1),
  tenantId: z.string().uuid(),
  kind:     z.enum(['appointment', 'event']).optional(),
  limit:    z.coerce.number().int().min(1).max(500).optional(),
  // Devuelve name/description en este locale si hay traducción; si no,
  // cae al texto base del servicio.
  locale:   localeSchema.optional(),
})

const updateBody = serviceBody.partial().omit({ code: true })

const categoryBody = z.object({
  name:         z.string().min(1).max(128),
  displayOrder: z.number().int().optional(),
})

const imageBody = z.object({
  objectId:     z.string().uuid(),
  altText:      z.string().max(256).optional(),
  displayOrder: z.number().int().min(0).max(100).optional(),
})

const tierBody = z.object({
  label:        z.string().min(1).max(128),
  daysOfWeek:   z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  startMinute:  z.number().int().min(0).max(1440).optional(),
  endMinute:    z.number().int().min(0).max(1440).optional(),
  priceCents:   z.number().int().min(0),
  enabled:      z.boolean().optional(),
})

const quoteQuery   = z.object({ at: z.string().datetime() })
const bookingWindowQuery = z.object({ at: z.string().datetime() })
const idParams     = z.object({ id: z.string().uuid() })
const imageIdParams = z.object({ id: z.string().uuid(), imageId: z.string().uuid() })
const tierIdParams  = z.object({ id: z.string().uuid(), tierId: z.string().uuid() })
const localeParams  = z.object({ id: z.string().uuid(), locale: localeSchema })

const translationBody = z.object({
  locale:      localeSchema,
  name:        z.string().min(1).max(256).optional(),
  description: z.string().max(2048).optional(),
})

const tags         = ['services']
const galleryTags  = ['services · gallery']
const pricingTags  = ['services · pricing']
const i18nTags     = ['services · i18n']

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
    role:        req.identity.role,
  }
}

export async function servicesRoutes(fastify) {
  fastify.post('/v1/services', {
    schema: { tags, summary: 'Create a service', body: serviceBody },
  }, async (req, reply) => {
    const body = serviceBody.parse(req.body)
    return reply.status(201).send(await service.createService(ctxFromRequest(req), body))
  })

  fastify.get('/v1/services', { schema: { tags, summary: 'List services' } },
    async (req) => service.listServices(ctxFromRequest(req), {
      onlyActive: req.query?.onlyActive !== 'false',
      category:   req.query?.category,
    }),
  )

  fastify.get('/v1/services/:id', {
    schema: { tags, summary: 'Get one service', params: idParams },
  }, async (req) => service.getService(ctxFromRequest(req), req.params.id))

  fastify.patch('/v1/services/:id', {
    schema: { tags, summary: 'Update a service', params: idParams, body: updateBody },
  }, async (req) => {
    const body = updateBody.parse(req.body)
    return service.updateService(ctxFromRequest(req), req.params.id, body)
  })

  fastify.post('/v1/services/:id/deactivate', {
    schema: { tags, summary: 'Deactivate a service', params: idParams },
  }, async (req) => service.deactivateService(ctxFromRequest(req), req.params.id))

  fastify.post('/v1/services/categories', {
    schema: { tags, summary: 'Create a service category', body: categoryBody },
  }, async (req, reply) => {
    const body = categoryBody.parse(req.body)
    return reply.status(201).send(await service.createCategory(ctxFromRequest(req), body))
  })

  fastify.get('/v1/services/categories', {
    schema: { tags, summary: 'List service categories' },
  }, async (req) => service.listCategories(ctxFromRequest(req)))

  // ── Photo gallery ────────────────────────────────────────────────────
  fastify.get('/v1/services/:id/images', {
    schema: { tags: galleryTags, summary: 'List images attached to a service', params: idParams },
  }, async (req) => ({ data: await service.listImages(ctxFromRequest(req), req.params.id) }))

  fastify.post('/v1/services/:id/images', {
    schema: {
      tags: galleryTags,
      summary: 'Attach an image to a service (objectId from platform_storage)',
      params: idParams, body: imageBody,
    },
  }, async (req, reply) => {
    const body = imageBody.parse(req.body)
    return reply.status(201).send(await service.attachImage(ctxFromRequest(req), req.params.id, body))
  })

  fastify.delete('/v1/services/:id/images/:imageId', {
    schema: { tags: galleryTags, summary: 'Detach an image from a service', params: imageIdParams },
  }, async (req, reply) => {
    await service.detachImage(ctxFromRequest(req), req.params.imageId)
    return reply.status(204).send()
  })

  // ── Pricing tiers ────────────────────────────────────────────────────
  fastify.get('/v1/services/:id/pricing-tiers', {
    schema: { tags: pricingTags, summary: 'List the pricing tiers of a service', params: idParams },
  }, async (req) => ({ data: await service.listPricingTiers(ctxFromRequest(req), req.params.id) }))

  fastify.post('/v1/services/:id/pricing-tiers', {
    schema: {
      tags: pricingTags,
      summary: 'Create a pricing tier (day-of-week + minute-of-day window)',
      params: idParams, body: tierBody,
    },
  }, async (req, reply) => {
    const body = tierBody.parse(req.body)
    return reply.status(201).send(await service.addPricingTier(ctxFromRequest(req), req.params.id, body))
  })

  fastify.delete('/v1/services/:id/pricing-tiers/:tierId', {
    schema: { tags: pricingTags, summary: 'Delete a pricing tier', params: tierIdParams },
  }, async (req, reply) => {
    await service.removePricingTier(ctxFromRequest(req), req.params.tierId)
    return reply.status(204).send()
  })

  fastify.get('/v1/services/:id/quote', {
    schema: {
      tags: pricingTags,
      summary: 'Resolve the price for a given booking start (most-specific tier wins, falls back to row price)',
      params: idParams,
    },
  }, async (req) => {
    const { at } = quoteQuery.parse(req.query ?? {})
    return service.quotePrice(ctxFromRequest(req), req.params.id, at)
  })

  // ── Booking window check ─────────────────────────────────────────────
  // Evaluates min_advance_minutes / max_advance_days for a candidate start.
  // platform/bookings (and portals) call this before creating a booking;
  // the actual rejection is enforced by bookings. Returns { ok, reason }.
  fastify.get('/v1/services/:id/booking-window', {
    schema: {
      tags,
      summary: 'Check whether a candidate start respects the service booking window (min_advance/max_advance)',
      params: idParams,
    },
  }, async (req) => {
    const { at } = bookingWindowQuery.parse(req.query ?? {})
    return service.evaluateBookingWindow(ctxFromRequest(req), req.params.id, at)
  })

  // ── i18n translations ────────────────────────────────────────────────
  fastify.get('/v1/services/:id/translations', {
    schema: { tags: i18nTags, summary: 'List a service translations', params: idParams },
  }, async (req) => ({ data: await service.listTranslations(ctxFromRequest(req), req.params.id) }))

  fastify.put('/v1/services/:id/translations', {
    schema: {
      tags: i18nTags,
      summary: 'Create or replace a service translation for a locale',
      params: idParams, body: translationBody,
    },
  }, async (req, reply) => {
    const body = translationBody.parse(req.body)
    return reply.status(201).send(await service.upsertTranslation(ctxFromRequest(req), req.params.id, body))
  })

  fastify.delete('/v1/services/:id/translations/:locale', {
    schema: { tags: i18nTags, summary: 'Delete a service translation for a locale', params: localeParams },
  }, async (req, reply) => {
    await service.removeTranslation(ctxFromRequest(req), req.params.id, req.params.locale)
    return reply.status(204).send()
  })

  // ── Service sessions (instancias fechadas; pieza para "eventos") ─────
  const sessionTags = ['services · sessions']

  // Público: landings consumen este endpoint sin JWT para pintar la
  // agenda de eventos. Requiere appId+tenantId por query string; RLS
  // hace cumplir el aislamiento. Sólo lista sessions de servicios con
  // public_catalog=TRUE.
  fastify.get('/v1/services/sessions/upcoming', {
    schema: {
      tags: sessionTags,
      summary: 'Public listing of upcoming sessions for a given (appId, tenantId)',
    },
    config: { public: true },
  }, async (req) => {
    const { appId, tenantId, kind, limit, locale } = publicUpcomingQuery.parse(req.query ?? {})
    return { data: await sessions.listPublicUpcoming({ appId, tenantId }, { kind, limit, locale }) }
  })

  fastify.post('/v1/services/:id/sessions', {
    schema: {
      tags: sessionTags,
      summary: 'Schedule a new session for a service',
      params: idParams, body: sessionBody,
    },
  }, async (req, reply) => {
    const body = sessionBody.parse(req.body)
    return reply.status(201).send(await sessions.createSession(ctxFromRequest(req), req.params.id, body))
  })

  fastify.get('/v1/services/:id/sessions', {
    schema: {
      tags: sessionTags,
      summary: 'List sessions of a service (admin / tenant member)',
      params: idParams,
    },
  }, async (req) => ({
    data: await sessions.listSessionsByService(ctxFromRequest(req), req.params.id, {
      fromDate: req.query?.fromDate,
      includeCancelled: req.query?.includeCancelled === 'true',
    }),
  }))

  fastify.get('/v1/services/sessions/:sessionId', {
    schema: { tags: sessionTags, summary: 'Get a single session', params: sessionIdParams },
  }, async (req) => sessions.getSession(ctxFromRequest(req), req.params.sessionId))

  fastify.patch('/v1/services/sessions/:sessionId', {
    schema: {
      tags: sessionTags,
      summary: 'Update a session',
      params: sessionIdParams, body: sessionUpdateBody,
    },
  }, async (req) => {
    const body = sessionUpdateBody.parse(req.body)
    return sessions.updateSession(ctxFromRequest(req), req.params.sessionId, body)
  })

  fastify.delete('/v1/services/sessions/:sessionId', {
    schema: { tags: sessionTags, summary: 'Cancel a session', params: sessionIdParams },
  }, async (req) => sessions.cancelSession(ctxFromRequest(req), req.params.sessionId))
}
