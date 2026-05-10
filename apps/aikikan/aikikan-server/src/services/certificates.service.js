import { ForbiddenError, NotFoundError, AppError } from '@apphub/platform-sdk/errors'
import { pool, withTenantTransaction } from '../lib/db.js'
import * as repo from '../repositories/certificates.repository.js'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'

const ADMIN_ROLES = new Set(['owner', 'admin'])

// Admin emite un certificado tras pre-subir el PDF a platform/storage.
// El admin recibe del flujo de upload un `file_object_id` y lo pasa
// aquí junto a los metadatos. Validamos el kind contra el catálogo de
// platform/storage haciendo una llamada de lectura (no estrictamente
// necesario — la subida ya validó — pero detectamos refs rotos pronto).
export async function issue(identity, body) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) {
    throw new ForbiddenError('Only owner/admin can issue certificates')
  }
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    (client) => repo.insert(client, {
      appId:           identity.appId,
      tenantId:        identity.tenantId,
      subTenantId:     identity.subTenantId ?? null,
      userId:          body.userId,
      issuedByUserId:  identity.userId,
      kind:            body.kind,
      title:           body.title,
      gradeValue:      body.gradeValue,
      eventId:         body.eventId,
      fileObjectId:    body.fileObjectId,
      issuedAt:        body.issuedAt,
      notes:           body.notes,
    }),
  )
}

export async function listMine(identity) {
  if (!identity?.userId) throw new ForbiddenError()
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    (client) => repo.findActiveByUser(client, identity.userId),
  )
}

// Pide a platform/storage un download URL temporal y lo devuelve al
// cliente. El JWT del usuario se reenvía vía Authorization para que
// platform/storage haga su propio check de boundary (mismo app/tenant).
export async function getDownloadUrl(identity, bearerToken, certificateId) {
  if (!identity?.userId) throw new ForbiddenError()
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    async (client) => {
      const cert = await repo.findById(client, certificateId)
      if (!cert) throw new NotFoundError('Certificate')
      // Sólo el propio receptor o un admin pueden descargar.
      const isOwner = cert.user_id === identity.userId
      const isAdmin = ADMIN_ROLES.has(identity.role)
      if (!isOwner && !isAdmin) throw new ForbiddenError()
      if (cert.revoked_at) throw new AppError('CERTIFICATE_REVOKED', 'Certificado revocado', 410)

      const url = `${env.PLATFORM_CORE_URL}/v1/storage/objects/${encodeURIComponent(cert.file_object_id)}/download-url`
      let res
      try {
        res = await fetch(url, { headers: { Authorization: `Bearer ${bearerToken}` } })
      } catch (err) {
        logger.error({ err, url }, 'Failed to reach platform/storage')
        throw new AppError('STORAGE_UNREACHABLE', 'No se pudo obtener el enlace de descarga', 502)
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new AppError(
          json?.error?.code    ?? 'STORAGE_ERROR',
          json?.error?.message ?? 'Error pidiendo el download URL',
          res.status,
        )
      }
      return {
        certificateId: cert.id,
        url:           json?.data?.url ?? json?.url,
        expiresAt:     json?.data?.expiresAt ?? json?.expiresAt,
      }
    },
  )
}

export async function revoke(identity, id) {
  if (!identity?.userId) throw new ForbiddenError()
  if (!ADMIN_ROLES.has(identity.role)) {
    throw new ForbiddenError('Only owner/admin can revoke certificates')
  }
  return withTenantTransaction(
    pool, identity.appId, identity.tenantId, identity.subTenantId ?? null,
    async (client) => {
      const r = await repo.revoke(client, id)
      if (!r) throw new NotFoundError('Certificate')
      return r
    },
  )
}
