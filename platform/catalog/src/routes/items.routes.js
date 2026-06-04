import { z } from 'zod'
import * as itemsService from '../services/items.service.js'

const itemType = z.enum(['physical', 'digital', 'service', 'bundle', 'subscription'])

const createItemBody = z.object({
  name:            z.string().min(1).max(256),
  description:     z.string().max(2048).optional(),
  priceCents:      z.number().int().min(0).optional(),
  currency:        z.string().length(3).optional(),
  category:        z.string().max(64).optional(),
  metadata:        z.record(z.unknown()).optional(),
  slug:            z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case').optional(),
  metaTitle:       z.string().max(256).optional(),
  metaDescription: z.string().max(512).optional(),
  itemType:        itemType.optional(),
})

const updateItemBody = z.object({
  name:            z.string().min(1).max(256).optional(),
  description:     z.string().max(2048).optional(),
  priceCents:      z.number().int().min(0).optional(),
  currency:        z.string().length(3).optional(),
  category:        z.string().max(64).optional(),
  metadata:        z.record(z.unknown()).optional(),
  active:          z.boolean().optional(),
  slug:            z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case').optional(),
  metaTitle:       z.string().max(256).optional(),
  metaDescription: z.string().max(512).optional(),
  itemType:        itemType.optional(),
})

const listQuery = z.object({
  q:            z.string().optional(),
  activeOnly:   z.enum(['true', 'false']).optional(),
  includeDeleted: z.enum(['true', 'false']).optional(),
  limit:        z.coerce.number().int().min(1).max(200).optional(),
  offset:       z.coerce.number().int().min(0).optional(),
})

const statusBody = z.object({ status: z.enum(['draft', 'published', 'archived']) })
const imageBody  = z.object({
  objectId:     z.string().uuid(),
  altText:      z.string().max(256).optional(),
  displayOrder: z.number().int().min(0).max(100).optional(),
})
const categoryBody = z.object({
  parentId:     z.string().uuid().nullable().optional(),
  name:         z.string().min(1).max(160),
  slug:         z.string().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be kebab-case'),
  description:  z.string().max(2048).optional(),
  displayOrder: z.number().int().min(0).max(10000).optional(),
})
const categoryUpdateBody = categoryBody.partial()
const assignBody = z.object({ categoryId: z.string().uuid() })

const idParams           = z.object({ id: z.string().uuid() })
const imageIdParams      = z.object({ id: z.string().uuid(), imageId: z.string().uuid() })
const categoryIdParams   = z.object({ id: z.string().uuid() })
const itemCategoryParams = z.object({ id: z.string().uuid(), categoryId: z.string().uuid() })

const tags         = ['catalog']
const versionTags  = ['catalog · versioning']
const imageTags    = ['catalog · gallery']
const csvTags      = ['catalog · csv']
const categoryTags = ['catalog · categories']

export async function itemsRoutes(fastify) {
  fastify.get('/v1/items', {
    schema: { tags, summary: 'List catalog items (?q= busca; ?limit/?offset paginan; ?includeDeleted)', querystring: listQuery },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    const activeOnly = req.query.activeOnly !== 'false'
    const includeDeleted = req.query.includeDeleted === 'true'
    const limit = req.query.limit != null ? Number(req.query.limit) : null
    const offset = req.query.offset != null ? Number(req.query.offset) : 0
    const q = (req.query.q ?? '').trim()
    if (q) return itemsService.searchItems({ appId, tenantId, subTenantId, q, activeOnly, includeDeleted, limit, offset })
    return itemsService.listItems({ appId, tenantId, subTenantId, activeOnly, includeDeleted, limit, offset })
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
    schema: { tags, summary: 'Hard-delete a catalog item (permanent)', params: idParams },
  }, async (req, reply) => {
    const { appId, tenantId, subTenantId } = req.identity
    await itemsService.deleteItem({ appId, tenantId, subTenantId, id: req.params.id })
    return reply.status(204).send()
  })

  // ── Soft delete + restore ─────────────────────────────────────────────
  fastify.post('/v1/items/:id/soft-delete', {
    schema: { tags, summary: 'Soft-delete a catalog item (sets deleted_at; preserves history)', params: idParams },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    return itemsService.softDeleteItem({ appId, tenantId, subTenantId, id: req.params.id })
  })

  fastify.post('/v1/items/:id/restore', {
    schema: { tags, summary: 'Restore a previously soft-deleted catalog item', params: idParams },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    return itemsService.restoreItem({ appId, tenantId, subTenantId, id: req.params.id })
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

  // ── Categories (tree) ─────────────────────────────────────────────────
  fastify.get('/v1/categories', {
    schema: { tags: categoryTags, summary: 'List all categories (flat; use parent_id to build the tree)' },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    return { data: await itemsService.listCategories({ appId, tenantId, subTenantId }) }
  })

  fastify.post('/v1/categories', {
    schema: { tags: categoryTags, summary: 'Create a category (optionally nested via parentId)', body: categoryBody },
  }, async (req, reply) => {
    const { appId, tenantId, subTenantId } = req.identity
    const body = categoryBody.parse(req.body)
    const cat = await itemsService.createCategory({ appId, tenantId, subTenantId, ...body })
    return reply.status(201).send(cat)
  })

  fastify.patch('/v1/categories/:id', {
    schema: { tags: categoryTags, summary: 'Update a category', params: categoryIdParams, body: categoryUpdateBody },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    const body = categoryUpdateBody.parse(req.body)
    return itemsService.updateCategory({ appId, tenantId, subTenantId, id: req.params.id, ...body })
  })

  fastify.delete('/v1/categories/:id', {
    schema: { tags: categoryTags, summary: 'Delete a category (children re-parented to NULL)', params: categoryIdParams },
  }, async (req, reply) => {
    const { appId, tenantId, subTenantId } = req.identity
    await itemsService.deleteCategory({ appId, tenantId, subTenantId, id: req.params.id })
    return reply.status(204).send()
  })

  fastify.get('/v1/categories/:id/items', {
    schema: { tags: categoryTags, summary: 'List items assigned to a category', params: categoryIdParams },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    const activeOnly = req.query.activeOnly !== 'false'
    return { data: await itemsService.listItemsByCategory({ appId, tenantId, subTenantId, categoryId: req.params.id, activeOnly }) }
  })

  // ── Item ↔ category assignment ────────────────────────────────────────
  fastify.get('/v1/items/:id/categories', {
    schema: { tags: categoryTags, summary: 'List the categories an item belongs to', params: idParams },
  }, async (req) => {
    const { appId, tenantId, subTenantId } = req.identity
    return { data: await itemsService.listItemCategories({ appId, tenantId, subTenantId, id: req.params.id }) }
  })

  fastify.post('/v1/items/:id/categories', {
    schema: { tags: categoryTags, summary: 'Assign an item to a category', params: idParams, body: assignBody },
  }, async (req, reply) => {
    const { appId, tenantId, subTenantId } = req.identity
    const body = assignBody.parse(req.body)
    const data = await itemsService.assignCategory({ appId, tenantId, subTenantId, id: req.params.id, categoryId: body.categoryId })
    return reply.status(201).send({ data })
  })

  fastify.delete('/v1/items/:id/categories/:categoryId', {
    schema: { tags: categoryTags, summary: 'Remove an item from a category', params: itemCategoryParams },
  }, async (req, reply) => {
    const { appId, tenantId, subTenantId } = req.identity
    await itemsService.unassignCategory({ appId, tenantId, subTenantId, id: req.params.id, categoryId: req.params.categoryId })
    return reply.status(204).send()
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
