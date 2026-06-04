#!/usr/bin/env node
// Seed one-off: sube los descargables pesados (>10 MB) de la sección
// Grafocaligrafía de aulavera a MinIO y registra las filas `uploaded` en
// platform_storage.objects con UUIDs FIJOS (referenciados desde
// apps/aulavera/aulavera-portal/src/data/grafocaligrafia/descargables.js).
// Idempotente: ON CONFLICT (id) no duplica; el PUT a S3 sobreescribe.
//
// Uso (desde la raíz del repo, con minio y postgres levantados):
//   node platform/storage/scripts/seed-grafocaligrafia-downloads.mjs --dir /tmp/grafo/files
//
// Env (defaults = entorno docker-compose de dev):
//   DATABASE_URL  postgresql://splitpay:splitpay@localhost:5432/splitpay (superuser)
//   S3_ENDPOINT   http://localhost:9000
//   S3_ACCESS_KEY / S3_SECRET_KEY   apphub / apphub_minio_secret
//   S3_BUCKET     apphub

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import pg from 'pg'
import { createStorageClient, putObject } from '@apphub/platform-sdk/storage'

const APP_ID    = 'aulavera'
const TENANT_ID = '70000000-0000-0000-0000-000000000001' // Fundación AulaVera (seed dev)
const OWNER_ID  = '00000000-0000-0000-0000-000000000000' // system/seed
const KIND      = 'public_download'

// UUIDs fijos — deben coincidir con data/grafocaligrafia/descargables.js.
const FILES = [
  {
    id: '3a0f0000-0000-4000-8000-000000000001',
    file: 'los-dibujos-en-la-arena-de-vanuatu.zip',
    filename: 'los-dibujos-en-la-arena-de-vanuatu.zip',
    contentType: 'application/zip',
  },
  {
    id: '3a0f0000-0000-4000-8000-000000000002',
    file: 'primera-sesion-nuevo_001.pdf',
    filename: 'primera-sesion-001.pdf',
    contentType: 'application/pdf',
  },
  {
    id: '3a0f0000-0000-4000-8000-000000000003',
    file: 'nishi-undo-aikido-wageningen-at-kenkon-2016.zip',
    filename: 'nishi-undo-aikido-wageningen-at-kenkon-2016.zip',
    contentType: 'application/zip',
  },
]

const dirIdx = process.argv.indexOf('--dir')
const DIR = dirIdx > -1 ? process.argv[dirIdx + 1] : '/tmp/grafo/files'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://splitpay:splitpay@localhost:5432/splitpay'
const S3_ENDPOINT  = process.env.S3_ENDPOINT ?? 'http://localhost:9000'
const S3_BUCKET    = process.env.S3_BUCKET ?? 'apphub'

const s3 = createStorageClient({
  endpoint: S3_ENDPOINT,
  region: process.env.S3_REGION ?? 'us-east-1',
  accessKey: process.env.S3_ACCESS_KEY ?? 'apphub',
  secretKey: process.env.S3_SECRET_KEY ?? 'apphub_minio_secret',
})

const db = new pg.Client({ connectionString: DATABASE_URL })
await db.connect()

for (const f of FILES) {
  const path = join(DIR, f.file)
  const bytes = await readFile(path)
  const { size } = await stat(path)
  const key = `${APP_ID}/${TENANT_ID}/${f.id}`

  await putObject(s3, {
    bucket: S3_BUCKET,
    key,
    body: bytes,
    contentType: f.contentType,
    contentDisposition: `attachment; filename="${f.filename}"`,
  })

  // GUCs de tenant por si se ejecuta con un rol sujeto a RLS (con el
  // superuser son inocuos).
  await db.query('BEGIN')
  await db.query("SELECT set_config('app.app_id', $1, true), set_config('app.tenant_id', $2, true)", [APP_ID, TENANT_ID])
  await db.query(
    `INSERT INTO platform_storage.objects
       (id, app_id, tenant_id, owner_user_id, kind, bucket, key,
        filename, content_type, size_bytes, status, finalized_at, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'uploaded',now(),
             '{"seed":"grafocaligrafia"}'::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET size_bytes = EXCLUDED.size_bytes, status = 'uploaded', deleted_at = NULL`,
    [f.id, APP_ID, TENANT_ID, OWNER_ID, KIND, S3_BUCKET, key, f.filename, f.contentType, size],
  )
  await db.query('COMMIT')

  console.log(`✓ ${f.filename} → s3://${S3_BUCKET}/${key} (${(size / 1024 / 1024).toFixed(1)} MB)`)
}

await db.end()
console.log('Seed grafocaligrafia downloads: done.')
