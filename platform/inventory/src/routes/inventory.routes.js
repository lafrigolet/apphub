import { z } from 'zod'
import * as service from '../services/inventory.service.js'

const upsertBody = z.object({
  qtyOnHand:          z.number().int().min(0),
  lowStockThreshold:  z.number().int().min(0).optional(),
  parentSku:          z.string().min(1).max(128).optional().nullable(),
  optionValues:       z.record(z.string()).optional(),
  displayName:        z.string().max(256).optional(),
})

const moveBody = z.object({
  qty:      z.number().int().positive(),
  refType:  z.string().max(64).optional(),
  refId:    z.string().uuid().optional(),
})

const variantBody = z.object({
  sku:                z.string().min(1).max(128),
  optionValues:       z.record(z.string()),
  qtyOnHand:          z.number().int().min(0).optional(),
  lowStockThreshold:  z.number().int().min(0).optional(),
  displayName:        z.string().max(256).optional(),
})

const skuParams = z.object({ sku: z.string().min(1).max(128) })

const tags        = ['inventory']
const variantTags = ['inventory · variants']

function ctxFromRequest(req) {
  return {
    appId:       req.identity.appId,
    tenantId:    req.identity.tenantId,
    subTenantId: req.identity.subTenantId ?? null,
    userId:      req.identity.userId,
  }
}

export async function inventoryRoutes(fastify) {
  fastify.get('/v1/inventory', { schema: { tags, summary: 'List inventory items' } }, async (req) => {
    const limit  = req.query?.limit  ? Number(req.query.limit)  : undefined
    const offset = req.query?.offset ? Number(req.query.offset) : undefined
    return service.listItems(ctxFromRequest(req), { limit, offset })
  })

  fastify.get('/v1/inventory/:sku', {
    schema: { tags, summary: 'Get one SKU (parent or variant)', params: skuParams },
  }, async (req, reply) => {
    const item = await service.getItem(ctxFromRequest(req), req.params.sku)
    if (!item) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'inventory item not found' } })
    return item
  })

  fastify.put('/v1/inventory/:sku', {
    schema: { tags, summary: 'Upsert an SKU (parent or variant)', params: skuParams, body: upsertBody },
  }, async (req) => {
    const body = upsertBody.parse(req.body)
    return service.upsertItem(ctxFromRequest(req), { sku: req.params.sku, ...body })
  })

  fastify.post('/v1/inventory/:sku/reserve', {
    schema: { tags, summary: 'Reserve stock for a pending order', params: skuParams, body: moveBody },
  }, async (req) => {
    const body = moveBody.parse(req.body)
    return service.reserveItem(ctxFromRequest(req), { sku: req.params.sku, ...body })
  })

  fastify.post('/v1/inventory/:sku/release', {
    schema: { tags, summary: 'Release a previously reserved quantity', params: skuParams, body: moveBody },
  }, async (req) => {
    const body = moveBody.parse(req.body)
    return service.releaseItem(ctxFromRequest(req), { sku: req.params.sku, ...body })
  })

  fastify.post('/v1/inventory/:sku/commit', {
    schema: { tags, summary: 'Commit a reservation (decrements on-hand)', params: skuParams, body: moveBody },
  }, async (req) => {
    const body = moveBody.parse(req.body)
    return service.commitItem(ctxFromRequest(req), { sku: req.params.sku, ...body })
  })

  // ── Variants ─────────────────────────────────────────────────────────
  fastify.get('/v1/inventory/:sku/variants', {
    schema: { tags: variantTags, summary: 'List variants of a parent SKU', params: skuParams },
  }, async (req) => {
    return service.listVariants(ctxFromRequest(req), req.params.sku)
  })

  fastify.post('/v1/inventory/:sku/variants', {
    schema: {
      tags: variantTags,
      summary: 'Create a variant SKU under a parent (option_values must be unique within the parent)',
      params: skuParams, body: variantBody,
    },
  }, async (req, reply) => {
    const body = variantBody.parse(req.body)
    const r = await service.addVariant(ctxFromRequest(req), req.params.sku, body)
    return reply.status(201).send(r)
  })
}
