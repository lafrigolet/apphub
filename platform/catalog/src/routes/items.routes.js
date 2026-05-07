import { z } from 'zod'
import * as itemsService from '../services/items.service.js'

const createItemBody = z.object({
  name:        z.string().min(1).max(256),
  description: z.string().max(2048).optional(),
  priceCents:  z.number().int().min(0).optional(),
  currency:    z.string().length(3).optional(),
  category:    z.string().max(64).optional(),
  metadata:    z.record(z.unknown()).optional(),
})

const updateItemBody = z.object({
  name:        z.string().min(1).max(256).optional(),
  description: z.string().max(2048).optional(),
  priceCents:  z.number().int().min(0).optional(),
  currency:    z.string().length(3).optional(),
  category:    z.string().max(64).optional(),
  metadata:    z.record(z.unknown()).optional(),
  active:      z.boolean().optional(),
})

const statusBody = z.object({ status: z.enum(['draft', 'published', 'archived']) })
const imageBody  = z.object({
  objectId:     z.string().uuid(),
  altText:      z.string().max(256).optional(),
  displayOrder: z.number().int().min(0).max(100).optional(),
})
const idParams       = z.object({ id: z.string().uuid() })
const imageIdParams  = z.object({ id: z.string().uuid(), imageId: z.string().uuid() })

const tags        = ['catalog']
const versionTags = ['catalog · versioning']
const imageTags   = ['catalog · gallery']
const csvTags     = ['catalog · csv']

export async function itemsRoutes(fastify) {
  fastify.get('/v1/items', {
    schema: { tags, summary: 'List catalog items' },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    const activeOnly = req.query.activeOnly !== 'false'
    return itemsService.listItems({ appId, tenantId, subTenantId, activeOnly })
  })

  fastify.get('/v1/items/:id', {
    schema: { tags, summary: 'Get one catalog item', params: idParams },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    return itemsService.getItem({ appId, tenantId, subTenantId, id: req.params.id })
  })

  fastify.post('/v1/items', {
    schema: { tags, summary: 'Create a catalog item', body: createItemBody },
  }, async (req, reply) => {
    const { appId, tenantId, subTenantId } = req.identity
    const body = createItemBody.parse(req.body)
    const item = await itemsService.createItem({ appId, tenantId, subTenantId, ...body })
    return reply.status(201).send(item)
  })

  fastify.patch('/v1/items/:id', {
    schema: { tags, summary: 'Update a catalog item', params: idParams, body: updateItemBody },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    const body = updateItemBody.parse(req.body)
    return itemsService.updateItem({ appId, tenantId, subTenantId, id: req.params.id, ...body })
  })

  fastify.delete('/v1/items/:id', {
    schema: { tags, summary: 'Delete a catalog item', params: idParams },
  }, async (req, reply) => {
    const { appId, tenantId, subTenantId } = req.identity
    await itemsService.deleteItem({ appId, tenantId, subTenantId, id: req.params.id })
    return reply.status(204).send()
  })

  // ── Versioning ───────────────────────────────────────────────────────
  fastify.patch('/v1/items/:id/status', {
    schema: { tags: versionTags, summary: 'Move item between draft / published / archived', params: idParams, body: statusBody },
  }, async (req) => {
    const { appId, tenantId, subTenantId, userId } = req.identity
    const body = statusBody.parse(req.body)
    return itemsService.setItemStatus({ appId, tenantId, subTenantId, id: req.params.id, status: body.status, actorUserId: userId })
  })

  fastify.get('/v1/items/:id/versions', {
    schema: { tags: versionTags, summary: 'List published-version snapshots of an item', params: idParams },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    return { data: await itemsService.listItemVersions({ appId, tenantId, subTenantId, id: req.params.id }) }
  })

  // ── Image gallery ────────────────────────────────────────────────────
  fastify.get('/v1/items/:id/images', {
    schema: { tags: imageTags, summary: 'List images attached to an item', params: idParams },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    return { data: await itemsService.listImages({ appId, tenantId, subTenantId, id: req.params.id }) }
  })

  fastify.post('/v1/items/:id/images', {
    schema: { tags: imageTags, summary: 'Attach an image to an item (objectId from platform_storage)', params: idParams, body: imageBody },
  }, async (req, reply) => {
    const { appId, tenantId, subTenantId } = req.identity
    const body = imageBody.parse(req.body)
    const r = await itemsService.attachImage({ appId, tenantId, subTenantId, id: req.params.id, ...body })
    return reply.status(201).send(r)
  })

  fastify.delete('/v1/items/:id/images/:imageId', {
    schema: { tags: imageTags, summary: 'Detach an image from an item', params: imageIdParams },
  }, async (req, reply) => {
    const { appId, tenantId, subTenantId } = req.identity
    await itemsService.detachImage({ appId, tenantId, subTenantId, imageId: req.params.imageId })
    return reply.status(204).send()
  })

  // ── CSV import / export ──────────────────────────────────────────────
  fastify.get('/v1/items/export.csv', {
    schema: { tags: csvTags, summary: 'Export every catalog item as CSV (all statuses)' },
  }, async (req, reply) => {
    const { appId, tenantId, subTenantId } = req.identity
    const csv = await itemsService.exportCsv({ appId, tenantId, subTenantId })
    reply.header('content-type', 'text/csv; charset=utf-8')
    reply.header('content-disposition', `attachment; filename="catalog-${Date.now()}.csv"`)
    return csv
  })

  fastify.post('/v1/items/import.csv', {
    schema: {
      tags: csvTags,
      summary: 'Import catalog items from CSV. Matches by id (update) or creates a new row when id is empty.',
      body: z.object({ csv: z.string().min(8).max(10_000_000) }),
    },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    return itemsService.importCsv({ appId, tenantId, subTenantId, csv: req.body.csv })
  })
}
