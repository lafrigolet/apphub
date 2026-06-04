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

const restockBody = z.object({
  qty:      z.number().int().positive(),
  reason:   z.enum(['restock', 'return', 'found', 'adjust']).optional(),
  refType:  z.string().max(64).optional(),
  refId:    z.string().uuid().optional(),
})

// Query booleans arrive as strings; treat only the literal "true" as true so
// `?lowStock=false` doesn't silently become true (which z.coerce.boolean does).
// preprocess keeps the schema idempotent — re-parsing an already-coerced
// boolean (Fastify validates then the handler re-parses) is a no-op.
const boolFlag = z.preprocess(
  (v) => (typeof v === 'string' ? v === 'true' : v),
  z.boolean().optional(),
)

const listQuery = z.object({
  limit:          z.coerce.number().int().positive().max(500).optional(),
  offset:         z.coerce.number().int().min(0).optional(),
  lowStock:       boolFlag,
  rootOnly:       boolFlag,
  parentSku:      z.string().min(1).max(128).optional(),
  search:         z.string().min(1).max(128).optional(),
})

const movementsQuery = z.object({
  reason:   z.enum(['reserve', 'release', 'commit', 'adjust', 'restock', 'return', 'found']).optional(),
  refType:  z.string().max(64).optional(),
  refId:    z.string().uuid().optional(),
  from:     z.string().datetime().optional(),
  to:       z.string().datetime().optional(),
  limit:    z.coerce.number().int().positive().max(500).optional(),
  offset:   z.coerce.number().int().min(0).optional(),
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
  fastify.get('/v1/inventory', {
    schema: {
      tags,
      summary: 'List inventory items (filters: lowStock, rootOnly, parentSku, search; each row includes computed qty_available)',
      querystring: listQuery,
    },
  }, async (req) => {
    const q = listQuery.parse(req.query ?? {})
    return service.listItems(ctxFromRequest(req), {
      limit: q.limit, offset: q.offset,
      lowStock: q.lowStock, rootOnly: q.rootOnly,
      parentSku: q.parentSku, search: q.search,
    })
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

  fastify.post('/v1/inventory/:sku/restock', {
    schema: {
      tags,
      summary: 'Increment on-hand stock (reverse commit / return / found units)',
      params: skuParams, body: restockBody,
    },
  }, async (req) => {
    const body = restockBody.parse(req.body)
    return service.restockItem(ctxFromRequest(req), { sku: req.params.sku, ...body })
  })

  fastify.get('/v1/inventory/:sku/movements', {
    schema: {
      tags,
      summary: 'List ledger movements for a SKU (filter by reason, ref, date range; paginated)',
      params: skuParams, querystring: movementsQuery,
    },
  }, async (req) => {
    const q = movementsQuery.parse(req.query ?? {})
    return service.listMovements(ctxFromRequest(req), req.params.sku, q)
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
