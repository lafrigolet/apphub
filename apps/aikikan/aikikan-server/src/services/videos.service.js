import { ForbiddenError, NotFoundError, ValidationError } from '@apphub/platform-sdk/errors'
import { pool, withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/videos.repository.js'

const APP_ID      = 'aikikan'
const ADMIN_ROLES = new Set(['owner', 'admin'])

export async function listVideos(tenantId) {
  if (!tenantId) throw new ValidationError('tenantId requerido')
  return withTenantTransaction(
    pool, APP_ID, tenantId, null,
    (client) => repo.findAll(client),
  )
}

export async function createVideo(identity, { youtubeId, label, name }) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only owner/admin can create videos')
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    (client) => repo.insert(client, {
      appId:       identity.appId,
      tenantId:    identity.tenantId,
      subTenantId: identity.subTenantId ?? null,
      youtubeId, label, name,
    }),
  )
}

export async function deleteVideo(identity, id) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) throw new ForbiddenError('Only owner/admin can delete videos')
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    async (client) => {
      const ok = await repo.deleteById(client, id)
      if (!ok) throw new NotFoundError('Video')
    },
  )
}
