import { z } from 'zod'
import { requireRole } from '@apphub/platform-sdk/app-guard'
import * as service from '../services/devices.service.js'

const tags = ['tpv · devices']

const createBody = z.object({
  name:            z.string().min(1).max(128),
  location:        z.string().max(256).optional().nullable(),
  defaultSeriesId: z.string().uuid().optional().nullable(),
  metadata:        z.record(z.any()).optional(),
})

const patchBody = z.object({
  name:            z.string().min(1).max(128).optional(),
  location:        z.string().max(256).optional().nullable(),
  defaultSeriesId: z.string().uuid().optional().nullable(),
  metadata:        z.record(z.any()).optional(),
  active:          z.boolean().optional(),
})

const idParams = z.object({ id: z.string().uuid() })

const listQuery = z.object({
  active: z.coerce.boolean().optional(),
})

export async function devicesRoutes(fastify) {
  fastify.addHook('preHandler', requireRole('manager', 'owner', 'admin', 'staff', 'super_admin'))

  fastify.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Register a TPV device (terminal / SIF emitter)',
        body: createBody,
      },
    },
    async (req, reply) => {
      const body = createBody.parse(req.body ?? {})
      reply.code(201)
      return { data: await service.createDevice(req.identity, body) }
    },
  )

  fastify.get(
    '/',
    {
      schema: {
        tags,
        summary: 'List TPV devices of the tenant',
        querystring: listQuery,
      },
    },
    async (req) => {
      const q = listQuery.parse(req.query ?? {})
      return { data: await service.listDevices(req.identity, q) }
    },
  )

  fastify.get(
    '/:id',
    {
      schema: { tags, summary: 'Get a TPV device', params: idParams },
    },
    async (req) => ({ data: await service.getDevice(req.identity, req.params.id) }),
  )

  fastify.patch(
    '/:id',
    {
      schema: { tags, summary: 'Update a TPV device', params: idParams, body: patchBody },
    },
    async (req) => {
      const body = patchBody.parse(req.body ?? {})
      return { data: await service.updateDevice(req.identity, req.params.id, body) }
    },
  )

  fastify.delete(
    '/:id',
    {
      schema: { tags, summary: 'Deactivate a TPV device (soft delete)', params: idParams },
    },
    async (req) => ({ data: await service.deactivateDevice(req.identity, req.params.id) }),
  )
}
