// Live S3 settings. Merges the DB (platform_storage.settings) over env vars,
// preferring the DB. Cached after first load — call invalidate() after a
// PATCH /admin/config so the next call re-reads the DB.
import { env } from './env.js'
import { pool } from './db.js'
import * as repo from '../repositories/settings.repository.js'

let cached = null

function fromEnv() {
  return {
    endpoint:        env.S3_ENDPOINT,
    publicEndpoint:  env.S3_PUBLIC_ENDPOINT ?? null,
    region:          env.S3_REGION,
    bucket:          env.S3_BUCKET,
    accessKey:       env.S3_ACCESS_KEY,
    secretKey:       env.S3_SECRET_KEY,
    forcePathStyle:  env.S3_FORCE_PATH_STYLE,
  }
}

export async function loadSettings() {
  const client = await pool.connect()
  let db
  try { db = await repo.getAll(client) } finally { client.release() }
  const e = fromEnv()
  cached = {
    endpoint:        db.s3_endpoint        ?? e.endpoint,
    publicEndpoint:  db.s3_public_endpoint ?? e.publicEndpoint,
    region:          db.s3_region          ?? e.region,
    bucket:          db.s3_bucket          ?? e.bucket,
    accessKey:       db.s3_access_key      ?? e.accessKey,
    secretKey:       db.s3_secret_key      ?? e.secretKey,
    forcePathStyle:  db.s3_force_path_style != null ? db.s3_force_path_style === 'true' : e.forcePathStyle,
  }
  return cached
}

// Sync access for callers that already awaited loadSettings() at boot. Falls
// back to env if the cache hasn't been populated yet (e.g. unit tests that
// don't call loadSettings).
export function getSettings() {
  return cached ?? fromEnv()
}

export function invalidate() { cached = null }
