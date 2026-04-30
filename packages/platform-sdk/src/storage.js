// S3-compatible client + presigned URL helpers. Used by platform/storage to
// mint upload URLs without ever streaming bytes through Node. Production
// swaps endpoint to AWS S3 / Cloudflare R2 / Backblaze B2 with no code change.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export function createStorageClient({ endpoint, region, accessKey, secretKey, forcePathStyle = true }) {
  if (!endpoint) throw new Error('createStorageClient: endpoint is required')
  if (!region)   throw new Error('createStorageClient: region is required')
  if (!accessKey || !secretKey) throw new Error('createStorageClient: accessKey/secretKey are required')
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    forcePathStyle,                                        // required for MinIO
  })
}

// Presigned PUT — the URL is single-use; client must include the same
// Content-Type and Content-Length headers when uploading.
export async function presignPut(client, { bucket, key, contentType, contentLength, ttlSeconds = 600 }) {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  })
  return getSignedUrl(client, cmd, { expiresIn: ttlSeconds })
}

// Presigned GET — short-lived download URL the frontend can serve directly
// (no proxy through Node).
export async function presignGet(client, { bucket, key, ttlSeconds = 300 }) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key })
  return getSignedUrl(client, cmd, { expiresIn: ttlSeconds })
}

// HEAD — validates that an upload landed and returns Content-Length / ETag.
export async function headObject(client, { bucket, key }) {
  return client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
}

// Hard-delete from the bucket (separate from the soft-delete in the DB).
export async function deleteObject(client, { bucket, key }) {
  return client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}
