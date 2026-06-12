import { z } from 'zod'
import * as addresses from '../services/addresses.service.js'
import * as easypost from '../services/easypost.service.js'

function ctxFromRequest(req) {
  return {
    appId: req.identity.appId,
    tenantId: req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId: req.identity.userId,
  }
}

const addressTags = ['shipping · addresses']
const epTags = ['shipping · carrier (EasyPost)']
const pickupTags = ['shipping · pickups']

const idParams = z.object({ id: z.string().uuid() })

// ── addresses ────────────────────────────────────────────────────────────────
const addressBody = z.object({
  role:      z.enum(['origin', 'destination']).optional(),
  label:     z.string().max(128).optional(),
  name:      z.string().max(256).optional(),
  company:   z.string().max(256).optional(),
  phone:     z.string().max(64).optional(),
  email:     z.string().email().max(256).optional(),
  street1:   z.string().min(1).max(256),
  street2:   z.string().max(256).optional(),
  city:      z.string().min(1).max(128),
  region:    z.string().max(128).optional(),
  zip:       z.string().max(32).optional(),
  country:   z.string().length(2),
  isDefault: z.boolean().optional(),
  metadata:  z.record(z.any()).optional(),
})

const addressPatchBody = addressBody.partial()
const addressListQuery = z.object({ role: z.enum(['origin', 'destination']).optional() })

// Inline address shape accepted by rate-shop / buy-label (EasyPost field names).
const inlineAddress = z.object({
  name:    z.string().max(256).optional(),
  company: z.string().max(256).optional(),
  street1: z.string().min(1).max(256),
  street2: z.string().max(256).optional(),
  city:    z.string().min(1).max(128),
  state:   z.string().max(128).optional(),
  zip:     z.string().max(32).optional(),
  country: z.string().length(2),
  phone:   z.string().max(64).optional(),
  email:   z.string().email().max(256).optional(),
})

const parcelBody = z.object({
  weightG:  z.number().int().positive(),
  lengthMm: z.number().int().min(0).optional(),
  widthMm:  z.number().int().min(0).optional(),
  heightMm: z.number().int().min(0).optional(),
})

const rateShopBody = z.object({
  fromAddressId: z.string().uuid().optional(),
  from:          inlineAddress.optional(),
  toAddressId:   z.string().uuid().optional(),
  to:            inlineAddress.optional(),
  parcel:        parcelBody,
})

const buyLabelBody = z.object({
  fromAddressId: z.string().uuid().optional(),
  from:          inlineAddress.optional(),
  toAddressId:   z.string().uuid().optional(),
  to:            inlineAddress.optional(),
  strategy:      z.enum(['cheapest', 'fastest']).optional(),
  carrier:       z.string().max(64).optional(),
  service:       z.string().max(64).optional(),
})

const pickupBody = z.object({
  addressId:          z.string().uuid().optional(),
  shipmentIds:        z.array(z.string().uuid()).optional(),
  easypostShipmentId: z.string().max(128).optional(),
  minDatetime:        z.string().datetime(),
  maxDatetime:        z.string().datetime(),
  instructions:       z.string().max(512).optional(),
  carrier:            z.string().max(64).optional(),
  service:            z.string().max(64).optional(),
})

const pickupListQuery = z.object({
  status: z.enum(['scheduled', 'confirmed', 'cancelled', 'failed']).optional(),
  limit:  z.coerce.number().int().min(1).max(200).optional(),
})

export async function easypostRoutes(fastify) {
  // ── addresses CRUD ─────────────────────────────────────────────────────
  fastify.get('/v1/shipping/addresses', {
    schema: { tags: addressTags, summary: 'List origin/destination addresses', querystring: addressListQuery },
  }, async (req) => ({ data: await addresses.listAddresses(ctxFromRequest(req), addressListQuery.parse(req.query ?? {})) }))

  fastify.post('/v1/shipping/addresses', {
    schema: { tags: addressTags, summary: 'Create an address (origin warehouse or destination)', body: addressBody },
  }, async (req, reply) => {
    const body = addressBody.parse(req.body)
    return reply.status(201).send(await addresses.createAddress(ctxFromRequest(req), body))
  })

  fastify.get('/v1/shipping/addresses/:id', {
    schema: { tags: addressTags, summary: 'Get an address', params: idParams },
  }, async (req) => addresses.getAddress(ctxFromRequest(req), req.params.id))

  fastify.patch('/v1/shipping/addresses/:id', {
    schema: { tags: addressTags, summary: 'Update an address', params: idParams, body: addressPatchBody },
  }, async (req) => addresses.updateAddress(ctxFromRequest(req), req.params.id, addressPatchBody.parse(req.body ?? {})))

  fastify.delete('/v1/shipping/addresses/:id', {
    schema: { tags: addressTags, summary: 'Delete an address', params: idParams },
  }, async (req) => addresses.deleteAddress(ctxFromRequest(req), req.params.id))

  fastify.post('/v1/shipping/addresses/:id/verify', {
    schema: { tags: addressTags, summary: 'Verify + normalize an address against EasyPost', params: idParams },
  }, async (req) => addresses.verifyAddress(ctxFromRequest(req), req.params.id))

  // ── rate-shopping (live multi-carrier) ─────────────────────────────────
  fastify.post('/v1/shipping/rate-shop', {
    schema: { tags: epTags, summary: 'Live multi-carrier rates for a parcel (EasyPost)', body: rateShopBody },
  }, async (req) => easypost.rateShop(ctxFromRequest(req), rateShopBody.parse(req.body)))

  // ── label purchase ─────────────────────────────────────────────────────
  fastify.post('/v1/shipping/shipments/:id/buy-label', {
    schema: {
      tags: epTags,
      summary: 'Buy carrier labels for every package of a shipment (EasyPost) + archive PDFs',
      params: idParams, body: buyLabelBody,
    },
  }, async (req, reply) => {
    const body = buyLabelBody.parse(req.body ?? {})
    return reply.status(201).send(await easypost.buyLabel(ctxFromRequest(req), req.params.id, body))
  })

  // ── pickups ────────────────────────────────────────────────────────────
  fastify.post('/v1/shipping/pickups', {
    schema: { tags: pickupTags, summary: 'Schedule a carrier pickup for an origin address (EasyPost)', body: pickupBody },
  }, async (req, reply) => {
    const body = pickupBody.parse(req.body)
    return reply.status(201).send(await easypost.schedulePickup(ctxFromRequest(req), body))
  })

  fastify.get('/v1/shipping/pickups', {
    schema: { tags: pickupTags, summary: 'List pickups', querystring: pickupListQuery },
  }, async (req) => ({ data: await easypost.listPickups(ctxFromRequest(req), pickupListQuery.parse(req.query ?? {})) }))

  fastify.get('/v1/shipping/pickups/:id', {
    schema: { tags: pickupTags, summary: 'Get a pickup', params: idParams },
  }, async (req) => easypost.getPickup(ctxFromRequest(req), req.params.id))

  fastify.post('/v1/shipping/pickups/:id/cancel', {
    schema: { tags: pickupTags, summary: 'Cancel a pickup', params: idParams },
  }, async (req) => easypost.cancelPickup(ctxFromRequest(req), req.params.id))
}
