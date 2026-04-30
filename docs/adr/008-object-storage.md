# ADR 008 — Object storage: MinIO + `storage` module of platform-core

## Status

Accepted — 2026-04-30.

## Context

12 modules across the 4 platform monoliths reference uploaded files (photos,
PDFs, signatures, attachments, recordings, QR codes, invoices, payout reports)
either as `TEXT URL` or buried inside `JSONB metadata`. None of them have a
multipart handler, an S3 client, or a way to enforce MIME / size / retention.
`TODO.md` lists object storage as priority #2 — "alta — fotos, PDFs,
attachments, recordings".

We need a single source of truth for "an uploaded blob owned by a tenant"
that every module can reference by UUID, and a way to issue short-lived
upload/download URLs without ever streaming bytes through Node.

## Decision

Two-piece architecture, both pieces required:

### Piece A — MinIO container (the byte store)

Run `minio/minio:latest` as a sixth infrastructure container (peer of
`postgres` and `redis`). Single bucket `apphub` with prefix `<app_id>/<tenant_id>/<object_id>`.
A one-shot `minio-init` service creates the bucket on first boot.

In production, `S3_ENDPOINT` swaps to AWS S3 / Cloudflare R2 / Backblaze B2
with zero code change. The S3 protocol is the contract.

### Piece B — `storage` module inside platform-core (the metadata + presigner)

Module of `platform-core` (not a separate container — see "Why a module"
below). Owns `platform_storage.objects` (id, app_id, tenant_id,
owner_user_id, kind, bucket, key, content_type, size_bytes, sha256, status,
retention_until, …). Endpoints under `/v1/storage/`:

- `POST /uploads` — validates `kind` (allowlist of MIMEs + `maxBytes`),
  inserts a `pending` row, mints a presigned PUT URL bound to that exact
  bucket/key/content-type/content-length.
- `POST /objects/:id/finalize` — HEADs MinIO, transitions to `uploaded`,
  publishes `storage.object.uploaded`. Idempotent.
- `GET /objects/:id/download-url` — presigned GET, default 5 min TTL.
- `DELETE /objects/:id` — soft-delete (status='deleted', `deleted_at=now()`).
- `GET /objects` and `GET /kinds` for staff inspection.

The `kinds` catalogue (`storage/src/kinds.js`) is the single place where MIME
allowlists, size caps, and retention policies are defined. Adding a new
consumer = adding one entry in `kinds.js` + one column on the consumer's
table.

## Why a module of platform-core (not a sixth Node container)

The argument from ADR 007 (single-runner cron → separate container) does
**not** apply here:

1. **Bytes never go through Node.** Clients PUT directly to MinIO via the
   presigned URL. Node only signs URLs and writes metadata rows. Payload size
   doesn't affect the platform-core process.
2. **No exactly-once concern.** The storage module is purely request/response
   — multiple replicas of platform-core would both serve `/uploads` correctly.
3. **Storage is the same level of horizontal infra as `auth`, `notifications`,
   and `payments`.** It belongs next to them, not in its own silo.

If we ever add image processing (resize, EXIF strip, transcoding) that does
hold real bytes in memory, we extract `storage` to its own container — the
ready-to-split pattern that ADR 004 makes a one-line operation.

## Why not "SDK-only, no central table"

Rejected. Without `platform_storage.objects` there's no:

- **Audit trail** — who uploaded what, when, with which retention policy.
- **Quotas** — counting bytes per tenant requires a central table.
- **GDPR right-to-be-forgotten** — retention purges and tenant-data exports
  need a queryable index of all objects.
- **MIME / size enforcement** — a SDK-only model lets every module set its
  own (or no) limits, with no audit.
- **Antivirus hook (V2)** — needs a single place to mark objects as
  pending-scan.

The 1ms cost of an INSERT into a metadata table is worth all of those.

## Decisiones tomadas (acordadas con el usuario)

| Decisión | Valor | Razón |
|---|---|---|
| Lógica Node | Módulo de `platform-core` | Storage es infra horizontal; sin carga real para justificar contenedor propio |
| Almacén de objetos | Contenedor `minio` | Igual nivel que postgres/redis |
| Producción | `S3_ENDPOINT` agnóstico | AWS S3 / Cloudflare R2 / Backblaze B2 / MinIO self-hosted con cero cambios de código |
| Buckets | Uno solo (`apphub`) con prefijo `<app>/<tenant>/<id>` | Simplifica IAM y backups |
| Controles V1 | MIME allowlist + maxBytes + retentionDays por `kind` | Audit + GDPR + safety |
| Antivirus | V2 (anotado en TODO) | Añade complejidad operativa |
| Eventos | `storage.object.uploaded`, `storage.object.deleted` | Patrón existente |
| GC | 2 jobs nuevos en platform-scheduler (`storage-orphan-purge`, `storage-retention-purge`) | El scheduler ya maneja todos los crons |

## Consequences

- **Producción**: 1 contenedor extra (`minio` ~150 MB). En prod se sustituye
  por S3/R2 sin cambiar código.
- **Operaciones**: la consola web de MinIO (`localhost:9001` con creds
  `apphub` / `apphub_minio_secret`) permite ver buckets y objetos en dev. En
  prod se usa la consola del proveedor.
- **Coste de añadir un nuevo consumidor**: un entry en `kinds.js` + una
  columna `*_object_id UUID` en la tabla del módulo cliente.
- **Back-compat**: `menu.menu_items.photo_url` y
  `intake_forms.submissions.signature_url` se mantienen. Datos viejos siguen
  funcionando; uploads nuevos pasan por storage.

## Alcance NO incluido (V1)

- **Antivirus** (ClamAV scan post-finalize) — V2.
- **Image processing** (resize, thumbnails, EXIF strip) — V2.
- **Multipart uploads >5GB** — el presigned PUT actual es single-part hasta
  5GB; suficiente para V1.
- **CDN signed URLs** (Cloudflare R2 + custom domain) — sin cambios de
  código en prod.
- **Hard-delete real de bytes en MinIO** — V1 sólo soft-deletea la fila DB;
  los bytes se quedan en MinIO hasta que un job futuro `storage-bytes-purge`
  los limpie. Esto impacta GDPR right-to-be-forgotten — anotado en TODO.md.
- **Cuotas por tenant** — defer.
- **10 consumidores restantes del TODO** (reviews, messaging, disputes,
  catalog, services, resources, telehealth, practitioner-payouts,
  floor-plan, orders) — cada equipo cablea cuando lo necesite, copiando el
  patrón menu/intake-forms.

## Notas de seguridad

- Los presigned URLs PUT firman `Content-Length` y `Content-Type`; MinIO
  rechaza uploads que no coincidan.
- El bucket `apphub` no es público (`mc anonymous set none`). Sin presigned
  URL no se accede a nada.
- TTLs cortos: 10 min PUT, 5 min GET por defecto.
- `svc_platform_storage` no necesita `BYPASSRLS` (sólo accede a
  `platform_storage.objects` con session vars seteadas).
- En prod, las credenciales S3 viven en secret manager. En dev, MinIO acepta
  las credenciales del root user.
