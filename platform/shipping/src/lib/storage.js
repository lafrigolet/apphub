// S3/MinIO client for archiving carrier label PDFs. Same values the storage
// module reads (both live in the platform-core container). The bytes go through
// @apphub/platform-sdk/storage — a permitted cross-module channel; we never
// touch platform_storage's schema. Optional: when S3 isn't configured (dev/
// test), label purchase still works — we just skip the archived copy and keep
// the carrier-hosted label_url.
import { createStorageClient, putObject, presignGet } from '@apphub/platform-sdk/storage'
import { env } from './env.js'

let _s3 = null
function client() {
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

// Exposed for tests.
export function resetStorageClientCache() { _s3 = null }

export function isStorageConfigured() { return client() != null }

// Archive a label PDF/PNG under labels/<tenant>/<packageId>.<ext>. Returns the
// S3 key, or null when storage isn't configured (caller keeps the carrier URL).
export async function archiveLabel({ appId, tenantId, packageId, buf, contentType }) {
  const s3 = client()
  if (!s3) return null
  const ext = contentType.includes('png') ? 'png' : contentType.includes('zpl') ? 'zpl' : 'pdf'
  const key = `labels/${appId}/${tenantId}/${packageId}.${ext}`
  await putObject(s3, {
    bucket: env.S3_BUCKET,
    key,
    body: buf,
    contentType,
    contentDisposition: `attachment; filename="label-${packageId}.${ext}"`,
  })
  return key
}

// Mint a short-lived download URL for an archived label.
export async function labelDownloadUrl(key, ttlSeconds = 300) {
  const s3 = client()
  if (!s3 || !key) return null
  return presignGet(s3, { bucket: env.S3_BUCKET, key, ttlSeconds })
}
