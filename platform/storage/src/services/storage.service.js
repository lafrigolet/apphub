import crypto from 'node:crypto'
import { createStorageClient, presignPut, headObject, deleteObject as s3DeleteObject } from '@apphub/platform-sdk/storage'
import { presignGetWithDisposition, headBucket as s3HeadBucket } from '../lib/s3-extra.js'
import { pool, withTenantTransaction } from '../lib/db.js'
import { publish } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import { getSettings } from '../lib/settings.js'
import * as repo from '../repositories/storage.repository.js'
import { ConflictError, NotFoundError, ValidationError, ForbiddenError, QuotaExceededError } from '../utils/errors.js'
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

  const obj = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    // Quota enforcement (anti-abuse / cost protection). A tenant with a quota
    // row may not request an upload that would push declared usage past it.
    const quota = await repo.getQuota(c, ctx.appId, ctx.tenantId)
    if (quota != null) {
      const { bytesUsed } = await repo.usageByTenant(c, ctx.appId, ctx.tenantId)
      if (bytesUsed + body.sizeBytes > quota) {
        throw new QuotaExceededError(
          `storage quota exceeded: ${bytesUsed + body.sizeBytes} > ${quota} bytes`,
        )
      }
    }
    return repo.insert(c, ctx.appId, ctx.tenantId, {
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
    })
  })
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
// Presigned GET carries Content-Disposition so the browser saves the object
// under its original `filename` rather than the opaque S3 key. Minting a
// download URL is treated as an access event: we append an access_log row and
// publish storage.object.downloaded so compliance modules can trace who
// fetched sensitive kinds (signature, telehealth_recording, payout_report, …).
export async function getDownloadUrl(ctx, id, ttlSeconds = 300, access = {}) {
  const obj = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const found = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!found) throw new NotFoundError('object')
    if (found.status !== 'uploaded') {
      throw new ConflictError(`object is ${found.status}, no download available`)
    }
    await repo.insertAccessLog(c, ctx.appId, ctx.tenantId, {
      objectId: found.id, kind: found.kind, action: 'download',
      userId: ctx.userId ?? null, ip: access.ip ?? null, userAgent: access.userAgent ?? null,
    })
    return found
  })

  const rawUrl = await presignGetWithDisposition(ensureClient(), {
    bucket: obj.bucket, key: obj.key, ttlSeconds, filename: obj.filename ?? null,
  })
  await publish({
    type: 'storage.object.downloaded',
    payload: {
      appId: ctx.appId, tenantId: ctx.tenantId, objectId: obj.id, kind: obj.kind,
      userId: ctx.userId ?? null, ip: access.ip ?? null, userAgent: access.userAgent ?? null,
    },
  })
  return {
    downloadUrl: rewriteHost(rawUrl),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  }
}

// ── access log read ─────────────────────────────────────────────────
// Staff-facing: cursor-paginated download history for the tenant (or one object).
export async function listAccessLog(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listAccessLog(c, ctx.appId, ctx.tenantId, opts),
  )
}

// ── listObjects ────────────────────────────────────────────────────
export async function listObjects(ctx, opts) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.listByTenant(c, ctx.appId, ctx.tenantId, opts),
  )
}

// ── softDelete / hardDelete ────────────────────────────────────────
// Owners can delete their own objects; staff can delete anything in their tenant.
// When `hard` is true (staff-only at the route layer) the bytes are physically
// removed from the bucket and the metadata row is purged — required for GDPR
// art. 17. Otherwise it's a reversible soft-delete.
export async function deleteObject(ctx, id, { hard = false } = {}) {
  const { obj, action } = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const found = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!found) throw new NotFoundError('object')
    const isStaff = ['staff', 'super_admin'].includes(ctx.role)
    if (!isStaff && found.owner_user_id !== ctx.userId) {
      throw new ForbiddenError('only the owner or staff can delete this object')
    }
    if (hard) {
      // Physically drop the bytes, then the metadata row, inside the txn so a
      // bucket failure rolls the row back.
      await s3DeleteObject(ensureClient(), { bucket: found.bucket, key: found.key })
      await repo.purgeRow(c, ctx.appId, ctx.tenantId, id)
      return { obj: { ...found, status: 'purged' }, action: 'hard' }
    }
    if (found.status === 'deleted') return { obj: found, action: 'noop' }   // idempotent
    return { obj: await repo.softDelete(c, ctx.appId, ctx.tenantId, id), action: 'soft' }
  })

  if (action === 'soft' || action === 'hard') {
    await publish({
      type: 'storage.object.deleted',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, objectId: obj.id, kind: obj.kind,
        ...(action === 'hard' ? { hard: true } : {}),
      },
    })
  }
  return obj
}

// ── restore ────────────────────────────────────────────────────────
// Reverse a soft-delete back to 'uploaded'. Only works while the bytes still
// exist in the bucket (i.e. before a hard-delete). Owner-or-staff, same rule.
export async function restoreObject(ctx, id) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const found = await repo.findById(c, ctx.appId, ctx.tenantId, id)
    if (!found) throw new NotFoundError('object')
    const isStaff = ['staff', 'super_admin'].includes(ctx.role)
    if (!isStaff && found.owner_user_id !== ctx.userId) {
      throw new ForbiddenError('only the owner or staff can restore this object')
    }
    if (found.status === 'uploaded') return found             // idempotent
    if (found.status !== 'deleted') throw new ConflictError(`object is ${found.status}, cannot restore`)
    const restored = await repo.restore(c, ctx.appId, ctx.tenantId, id)
    if (!restored) throw new ConflictError('object could not be restored')
    return restored
  })
}

// ── usage ──────────────────────────────────────────────────────────
// Bytes consumed + object count + the configured quota (null = unlimited).
export async function getUsage(ctx) {
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const { bytesUsed, objectCount } = await repo.usageByTenant(c, ctx.appId, ctx.tenantId)
    const quotaBytes = await repo.getQuota(c, ctx.appId, ctx.tenantId)
    return {
      bytesUsed,
      objectCount,
      quotaBytes,
      bytesRemaining: quotaBytes == null ? null : Math.max(0, quotaBytes - bytesUsed),
    }
  })
}

// Staff: set/replace the tenant's storage quota in bytes.
export async function setQuota(ctx, maxBytes) {
  if (typeof maxBytes !== 'number' || maxBytes < 0) {
    throw new ValidationError('maxBytes must be a non-negative integer')
  }
  return withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
    const v = await repo.upsertQuota(c, ctx.appId, ctx.tenantId, maxBytes)
    return { quotaBytes: v }
  })
}

// ── connectivity test ──────────────────────────────────────────────
// HEAD the configured bucket so a broken endpoint/credentials combination is
// caught before (or right after) the admin PATCH lands. Returns { ok } or
// throws ConflictError with the underlying reason.
export async function testConnectivity() {
  const bucket = getSettings().bucket
  try {
    await s3HeadBucket(ensureClient(), { bucket })
    return { ok: true, bucket }
  } catch (err) {
    const code = err.$metadata?.httpStatusCode
    throw new ConflictError(`storage connectivity check failed for bucket "${bucket}"${code ? ` (HTTP ${code})` : ''}: ${err.message}`)
  }
}

// ── retention purge ─────────────────────────────────────────────────
// Hard-delete (bytes + metadata row) every object for this tenant whose
// retention_until has passed. Idempotent and bounded by `limit`. Each purged
// object emits storage.object.deleted with { hard:true, reason:'retention' }.
// NOTE: cross-cutting pending — a platform-scheduler job
// `storage-retention-purge` (cron, e.g. '30 3 * * *') should fan this out per
// tenant. This service method is the unit of work it would call.
export async function purgeExpired(ctx, { limit = 500 } = {}) {
  const purged = []
  const expired = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.findExpired(c, ctx.appId, ctx.tenantId, { limit }),
  )
  for (const obj of expired) {
    try {
      await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, async (c) => {
        await s3DeleteObject(ensureClient(), { bucket: obj.bucket, key: obj.key })
        await repo.purgeRow(c, ctx.appId, ctx.tenantId, obj.id)
      })
      await publish({
        type: 'storage.object.deleted',
        payload: {
          appId: ctx.appId, tenantId: ctx.tenantId, objectId: obj.id, kind: obj.kind,
          hard: true, reason: 'retention',
        },
      })
      purged.push(obj.id)
    } catch (err) {
      logger.error({ err, objectId: obj.id }, 'retention purge failed for object')
    }
  }
  return { purged: purged.length, objectIds: purged }
}

// ── expiry warning ──────────────────────────────────────────────────
// Publish storage.object.expiring_soon for uploaded objects whose
// retention_until falls within `windowDays`. Lets owners archive before the
// purge sweep removes the bytes. NOTE: cross-cutting pending — the same
// platform-scheduler that runs the purge should call this on a wider window
// (e.g. T-30d / T-7d) and route the events to platform/notifications.
export async function notifyExpiringSoon(ctx, { windowDays = 30, limit = 1000 } = {}) {
  const rows = await withTenantTransaction(pool, ctx.appId, ctx.tenantId, ctx.subTenantId, (c) =>
    repo.findExpiringSoon(c, ctx.appId, ctx.tenantId, { windowDays, limit }),
  )
  for (const obj of rows) {
    await publish({
      type: 'storage.object.expiring_soon',
      payload: {
        appId: ctx.appId, tenantId: ctx.tenantId, objectId: obj.id, kind: obj.kind,
        ownerUserId: obj.owner_user_id ?? null,
        retentionUntil: obj.retention_until ? new Date(obj.retention_until).toISOString() : null,
      },
    })
  }
  return { notified: rows.length, objectIds: rows.map((r) => r.id) }
}

export { logger }
