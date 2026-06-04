// S3 helpers the shared @apphub/platform-sdk/storage doesn't expose yet, kept
// local to the storage module so we don't reach outside platform/storage.
// When these stabilise they're candidates to fold back into the SDK.
import { GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

// Presigned GET that forces a download filename via Content-Disposition so the
// browser saves the object under its original `filename` instead of the opaque
// S3 key. Falls back to no disposition when filename is absent.
export async function presignGetWithDisposition(client, { bucket, key, ttlSeconds = 300, filename }) {
  const params = { Bucket: bucket, Key: key }
  if (filename) {
    // RFC 5987 / 6266 — quote and percent-encode for non-ASCII filenames.
    const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
    const encoded = encodeURIComponent(filename)
    params.ResponseContentDisposition = `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
  }
  return getSignedUrl(client, new GetObjectCommand(params), { expiresIn: ttlSeconds })
}

// Connectivity probe used before accepting new S3 settings — HEAD the bucket to
// confirm the credentials + endpoint actually reach a reachable bucket.
export async function headBucket(client, { bucket }) {
  return client.send(new HeadBucketCommand({ Bucket: bucket }))
}
