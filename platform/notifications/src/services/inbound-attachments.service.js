// Inbound attachments (§25) — download from the provider immediately (their
// signed download_url expires), enforce the tenant-configurable policy
// (allowed content-types, max size), dedup by sha256, and persist the bytes in
// the shared S3 bucket under inbound/<emailId>/…. Only metadata lives in
// Postgres; the bytes go through @apphub/platform-sdk/storage — the SDK is a
// permitted cross-module channel, platform_storage's schema is not touched.
import crypto from 'node:crypto'
import { createStorageClient, putObject } from '@apphub/platform-sdk/storage'
import { env } from '../lib/env.js'
import { logger } from '../lib/logger.js'
import * as inboundRepo from '../repositories/inbound-emails.repository.js'
import { downloadAttachment } from './resend-inbound.service.js'

let _s3 = null
function s3() {
  if (_s3) return _s3
  if (!env.S3_ENDPOINT || !env.S3_ACCESS_KEY || !env.S3_SECRET_KEY) return null
  _s3 = createStorageClient({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKey: env.S3_ACCESS_KEY,
    secretKey: env.S3_SECRET_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  })
  return _s3
}

// Exported for tests.
export function resetS3ClientCache() { _s3 = null }

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
// Prefix match against the attachment's content-type.
const DEFAULT_ALLOWED_TYPES = [
  'image/', 'application/pdf', 'text/plain', 'text/csv', 'application/zip',
  'application/msword', 'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel',
]

export function attachmentPolicy(cfg = {}) {
  const maxBytes = Number(cfg.inbound_attachment_max_bytes) > 0
    ? Number(cfg.inbound_attachment_max_bytes)
    : DEFAULT_MAX_BYTES
  const allowed = cfg.inbound_attachment_allowed_types
    ? String(cfg.inbound_attachment_allowed_types).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_ALLOWED_TYPES
  return { maxBytes, allowed }
}

function typeAllowed(contentType, allowed) {
  const ct = String(contentType ?? '').toLowerCase()
  return allowed.some((prefix) => ct.startsWith(prefix))
}

function safeFilename(name) {
  return String(name ?? 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

// Best-effort S3 cleanup for GDPR deletes / retention purge. Object keys may
// be shared by dedup'd rows — deleting a still-referenced key is acceptable
// for an erasure flow (the duplicate row's email is usually purged too).
export async function deleteStoredObjects(objectKeys = []) {
  const client3 = s3()
  if (!client3) return 0
  const { deleteObject } = await import('@apphub/platform-sdk/storage')
  let deleted = 0
  for (const { bucket, object_key: key } of objectKeys) {
    try {
      await deleteObject(client3, { bucket: bucket ?? env.S3_BUCKET, key })
      deleted += 1
    } catch (err) {
      logger.warn({ err, key }, 'inbound attachment object delete failed')
    }
  }
  return deleted
}

// Signed download URL for the staff console. Null when S3 is unconfigured.
export async function attachmentDownloadUrl(att, ttlSeconds = 300) {
  const client3 = s3()
  if (!client3 || !att?.object_key) return null
  const { presignGet } = await import('@apphub/platform-sdk/storage')
  return presignGet(client3, { bucket: att.bucket ?? env.S3_BUCKET, key: att.object_key, ttlSeconds })
}

// Stores every attachment of an inbound email. Per-attachment failures are
// recorded (status 'failed'/'skipped') and never abort the pipeline — a broken
// attachment must not lose the message. Returns the stored/skipped rows.
//
// `inline` (dev-stub / admin inject): [{ filename, contentType, contentBase64 }]
// bypasses the provider download.
export async function storeAttachments(client, { email, attachments = [], inline = false, apiKey, cfg = {} }) {
  const { maxBytes, allowed } = attachmentPolicy(cfg)
  const out = []
  for (const att of attachments) {
    const base = {
      emailId: email.id,
      providerAttachmentId: att.id ?? null,
      filename: att.filename ?? null,
      contentType: att.contentType ?? null,
      contentId: att.contentId ?? null,
    }
    try {
      if (!typeAllowed(att.contentType, allowed)) {
        out.push(await inboundRepo.insertAttachment(client, {
          ...base, status: 'skipped', skipReason: `content-type not allowed: ${att.contentType}`,
        }))
        continue
      }
      const bytes = inline
        ? Buffer.from(att.contentBase64 ?? '', 'base64')
        : await downloadAttachment({ apiKey, emailId: email.provider_email_id, attachment: att })
      if (bytes.length > maxBytes) {
        out.push(await inboundRepo.insertAttachment(client, {
          ...base, sizeBytes: bytes.length, status: 'skipped', skipReason: `too large: ${bytes.length} > ${maxBytes}`,
        }))
        continue
      }
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')

      // Dedup: identical bytes already stored → reuse the object, skip the write.
      const existing = await inboundRepo.findStoredBySha(client, sha256)
      if (existing) {
        out.push(await inboundRepo.insertAttachment(client, {
          ...base, sizeBytes: bytes.length, sha256,
          bucket: existing.bucket, objectKey: existing.object_key, status: 'stored',
        }))
        continue
      }

      const client3 = s3()
      if (!client3) {
        // No S3 configured (tests / local without MinIO): metadata only.
        logger.info({ emailId: email.id, filename: att.filename }, '[dev] inbound attachment not stored (S3 unconfigured)')
        out.push(await inboundRepo.insertAttachment(client, {
          ...base, sizeBytes: bytes.length, sha256, status: 'skipped', skipReason: 'storage_unconfigured',
        }))
        continue
      }
      const objectKey = `inbound/${email.id}/${crypto.randomUUID()}/${safeFilename(att.filename)}`
      await putObject(client3, {
        bucket: env.S3_BUCKET,
        key: objectKey,
        body: bytes,
        contentType: att.contentType ?? 'application/octet-stream',
        contentDisposition: `attachment; filename="${safeFilename(att.filename)}"`,
      })
      out.push(await inboundRepo.insertAttachment(client, {
        ...base, sizeBytes: bytes.length, sha256, bucket: env.S3_BUCKET, objectKey, status: 'stored',
      }))
    } catch (err) {
      logger.error({ err, emailId: email.id, attachment: att.id }, 'inbound attachment failed')
      out.push(await inboundRepo.insertAttachment(client, {
        ...base, status: 'failed', skipReason: String(err.message).slice(0, 500),
      }))
    }
  }
  return out
}
