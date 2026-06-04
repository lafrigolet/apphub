import crypto from 'node:crypto'
import { createStorageClient, presignPut, presignGet, headObject } from '@apphub/platform-sdk/storage'
import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import { getSettings } from '../lib/settings.js'
import * as repo from '../repositories/storage.repository.js'
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from '../utils/errors.js'
import { getKind } from '../kinds.js'

// Lazy: don't connect to S3 until the first request hits us so tests that
// mock the S3 client don't need to touch the SDK. Driven by the merged
// (DB+env) settings — call configureClient(null) after a settings change to
// force the next request to rebuild the client.
let _client = null
function ensureClient() {
  if (_client) return _client
  const s = getSettings()
  _client = createStorageClient({
    endpoint:        s.endpoint,
    region:          s.region,
    accessKey:       s.accessKey,
    secretKey:       s.secretKey,
    forcePathStyle:  s.forcePathStyle,
  })
  return _client
}
// For tests + integration AND for invalidation after admin PATCH.
export function configureClient(client) { _client = client }

// Public-facing endpoint. The browser hits `localhost:9000` even though Node
// resolves `minio:9000` — same MinIO, different DNS view. We rewrite the
// presigned URL host in-place if a public endpoint is configured.
function rewriteHost(presigned) {
  const s = getSettings()
  if (!s.publicEndpoint) return presigned
  return presigned.replace(s.endpoint, s.publicEndpoint)
}

function objectKey(appId, tenantId, id) {
  return `${appId}/${tenantId}/${id}`
}

function computeRetentionUntil(retentionDays) {
  if (retentionDays == null) return null
  return new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString()
}

// ── requestUpload ─────────────────────────────────────────────────────
// Validates kind / mime / size, INSERTs a 'pending' row, mints a presigned
// PUT URL bound to that exact (bucket, key, content-type, content-length).
export async function requestUpload(ctx, body) {
  const kindCfg = getKind(body.kind)
  if (!kindCfg) throw new ValidationError(`unknown kind: ${body.kind}`)
  if (!kindCfg.mime.includes(body.contentType)) {
    throw new ValidationError(`content-type ${body.contentType} not allowed for kind ${body.kind}`)
  }
  if (typeof body.sizeBytes !== 'number' || body.sizeBytes <= 0) {
    throw new ValidationError('sizeBytes must be a positive integer')
  }
  if (body.sizeBytes > kindCfg.maxBytes) {
    throw new ValidationError(`sizeBytes ${body.sizeBytes} exceeds limit ${kindCfg.maxBytes} for kind ${body.kind}`)
  }

  const id = crypto.randomUUID()
  const key = objectKey(ctx.appId, ctx.tenantId, id)
  const retentionUntil = computeRetentionUntil(kindCfg.retentionDays)

  const obj = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) =>
    repo.insert(c, ctx.appId, ctx.tenantId, {
      subTenantId: ctx.subTenantId,
      ownerUserId: ctx.userId,
      kind: body.kind,
      bucket: getSettings().bucket,
      key,
      filename: body.filename,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      retentionUntil,
      metadata: body.metadata,
    }),
  )
  // The repo defaults id from gen_random_uuid(); we re-fetch to get the row's
  // server-assigned id since we're not forcing the value above.

  const ttlSeconds = 600
  const rawUrl = await presignPut(ensureClient(), {
    bucket: getSettings().bucket,
    key: obj.key,
    contentType: body.contentType,
    contentLength: body.sizeBytes,
    ttlSeconds,
  })
  const uploadUrl = rewriteHost(rawUrl)
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()

  return {
    objectId: obj.id,
    uploadUrl,
    expiresAt,
    headers: {
      'Content-Type':   body.contentType,
      'Content-Length': String(body.sizeBytes),
    },
  }
}

// ── finalize ─────────────────────────────────────────────────────────
// HEAD the bucket object to verify the upload landed; transition pending →
// uploaded. Idempotent — calling twice on an already-uploaded row returns
// the same row.
export async function finalize(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const obj = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!obj) throw new NotFoundError('object')
    if (obj.status === 'uploaded') return obj                  // idempotent
    if (obj.status === 'deleted')  throw new ConflictError('object is deleted')

    let head
    try {
      head = await headObject(ensureClient(), { bucket: obj.bucket, key: obj.key })
    } catch (err) {
      if (err.$metadata?.httpStatusCode === 404) {
        throw new ConflictError('upload not yet visible in storage')
      }
      throw err
    }

    const sizeBytes = Number(head.ContentLength)
    if (obj.size_bytes != null && Number(obj.size_bytes) !== sizeBytes) {
      throw new ConflictError(`size mismatch: declared ${obj.size_bytes}, found ${sizeBytes}`)
    }
    const sha256 = (head.ETag ?? '').replaceAll('"', '') || null

    const updated = await repo.markUploaded(c, ctx.appId, ctx.tenantId, id, { sizeBytes, sha256 })
    await publish({
      type: 'storage.object.uploaded',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        objectId: updated.id, kind: updated.kind,
        sizeBytes, contentType: updated.content_type,
      },
    })
    return updated
  })
}

// ── getObject ───────────────────────────────────────────────────────
export async function getObject(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const obj = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!obj) throw new NotFoundError('object')
    return obj
  })
}

// ── getDownloadUrl ─────────────────────────────────────────────────
export async function getDownloadUrl(ctx, id, ttlSeconds = 300) {
  const obj = await getObject(ctx, id)
  if (obj.status !== 'uploaded') {
    throw new ConflictError(`object is ${obj.status}, no download available`)
  }
  const rawUrl = await presignGet(ensureClient(), {
    bucket: obj.bucket, key: obj.key, ttlSeconds,
  })
  return {
    downloadUrl: rewriteHost(rawUrl),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  }
}

// ── getPublicDownloadUrl ───────────────────────────────────────────
// Variante anónima de getDownloadUrl para kinds marcados `public: true`
// (descargables de landings). El caller aporta appId/tenantId por query —
// el UUID del objeto no es adivinable y el RLS sigue aplicando.
export async function getPublicDownloadUrl({ appId, tenantId }, id, ttlSeconds = 300) {
  const obj = await withTenantTransaction(pool, appId, tenantId, null, async (c) => {
    const row = await repo.findById(c, appId, tenantId, id)
    if (!row) throw new NotFoundError('object')
    return row
  })
  const kindCfg = getKind(obj.kind)
  if (!kindCfg?.public) throw new ForbiddenError('object is not publicly downloadable')
  if (obj.status !== 'uploaded') {
    throw new ConflictError(`object is ${obj.status}, no download available`)
  }
  const rawUrl = await presignGet(ensureClient(), {
    bucket: obj.bucket, key: obj.key, ttlSeconds,
  })
  return {
    downloadUrl: rewriteHost(rawUrl),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  }
}

// ── listObjects ────────────────────────────────────────────────────
export async function listObjects(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listByTenant(c, ctx.appId, ctx.tenantId, opts),
  )
}

// ── softDelete ─────────────────────────────────────────────────────
// Owners can delete their own objects; staff can delete anything in their tenant.
export async function deleteObject(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const obj = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!obj) throw new NotFoundError('object')
    const isStaff = ['staff', 'super_admin'].includes(ctx.role)
    if (!isStaff && obj.owner_user_id !== ctx.userId) {
      throw new ForbiddenError('only the owner or staff can delete this object')
    }
    if (obj.status === 'deleted') return obj                   // idempotent
    const updated = await repo.softDelete(c, ctx.appId, ctx.tenantId, id)
    await publish({
      type: 'storage.object.deleted',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId,
        objectId: updated.id, kind: updated.kind,
      },
    })
    return updated
  })
}

export { logger }
