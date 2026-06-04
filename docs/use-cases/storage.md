# Casos de uso — `platform/storage` (platform-core)

> Dominio: almacenamiento de objetos S3-compatible vía MinIO (o cualquier backend compatible: AWS S3, Cloudflare R2, Backblaze B2). Presigned URLs de carga y descarga sin proxying de bytes por Node; registro de metadatos y auditoría en PostgreSQL; aislamiento por `(app_id, tenant_id)` con RLS.

## Estado actual (implementado)

Registro de metadatos en `platform_storage.objects` con campos `kind, bucket, key, filename, content_type, size_bytes, sha256, status (pending|uploaded|deleted), retention_until, metadata JSONB, finalized_at, deleted_at`; catálogo de tipos (*kinds*) con límites de MIME y tamaño definidos en código; presigned PUT de 10 minutos con reescritura de host para el navegador; finalización con HEAD al bucket para verificar la carga y capturar tamaño real + ETag/SHA-256; presigned GET configurable (30 s–1 h, por defecto 5 min); soft-delete con control owner-vs-staff; listado filtrable por `kind`, `owner_user_id`, `status`; configuración de credenciales S3 cifrada en BD + fallback a env; eventos Redis `storage.object.uploaded` y `storage.object.deleted`; RLS en PostgreSQL por `(app_id, tenant_id)`; guard `requireRole('super_admin','staff')` en rutas de administración.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Solicitud de URL de carga (*presigned PUT*)

- ✅ `POST /v1/storage/uploads` — cliente autenticado declara `kind`, `contentType`, `sizeBytes`, `filename?`, `metadata?`.
- ✅ Validación de MIME contra lista blanca del *kind* (Zod + `KINDS`).
- ✅ Validación de tamaño (`sizeBytes > 0` y `≤ kind.maxBytes`).
- ✅ Inserción de fila `status='pending'` con `retention_until` calculado del *kind*.
- ✅ Presigned PUT firmado con Content-Type + Content-Length, TTL 600 s.
- ✅ Reescritura del host de la URL para el navegador (`S3_PUBLIC_ENDPOINT`).
- ✅ Respuesta `{ objectId, uploadUrl, expiresAt, headers }`.
- 🔧 TTL de la URL de carga fijo en 600 s — no configurable por *kind* ni por la llamada.
- ❌ Retorno de headers de `Content-Disposition` en el PUT para forzar nombre de fichero.
- ❌ Server-side encryption headers (`x-amz-server-side-encryption`) en la URL firmada.
- ❌ Cuota de uploads concurrentes pendientes por usuario/tenant (anti-abuso).

## 2. Finalización y verificación de carga

- ✅ `POST /v1/storage/objects/:id/finalize` — HEAD al bucket para confirmar que los bytes llegaron.
- ✅ Idempotente: si el objeto ya está `uploaded`, devuelve la fila sin duplicar eventos.
- ✅ Validación de tamaño real vs. declarado (conflicto si difieren).
- ✅ Captura de SHA-256/ETag del `ETag` de MinIO.
- ✅ Transición `pending → uploaded`, sello `finalized_at`.
- ✅ Publicación del evento `storage.object.uploaded` en `platform.events`.
- 🔧 ETag de MinIO no es siempre SHA-256 puro (multipart → ETag compuesto `hash-N`); el campo `sha256` puede contener el ETag compuesto sin validar que sea SHA-256 real.
- ❌ Llamada a finalización desde un webhook S3/MinIO (modelo push) — hoy requiere llamada explícita del cliente.
- ❌ Reintento automático si el HEAD devuelve 404 durante una ventana de propagación (graceful retry).
- ❌ Comprobación de integridad real (recalcular SHA-256 de los bytes descargados) en vez de confiar en el ETag.

## 3. Descarga (*presigned GET*)

- ✅ `GET /v1/storage/objects/:id/download-url` — devuelve URL firmada para GET directo al bucket.
- ✅ TTL configurable por query `ttl` (30–3600 s), por defecto 300 s.
- ✅ Reescritura del host para el navegador.
- ✅ Guard: el objeto debe estar en estado `uploaded`; rechaza `pending` y `deleted`.
- ✅ `Content-Disposition` en la URL firmada con el `filename` original (RFC 5987/6266; `lib/s3-extra.js → presignGetWithDisposition`).
- ❌ Acceso público anónimo a objetos marcados como públicos (sin firma).
- ❌ Token de descarga de un solo uso o con número máximo de accesos.
- ❌ Descarga de rango de bytes (`Content-Range` / streaming parcial).
- ❌ Caché CDN: la URL firmada expira antes de que un CDN pueda beneficiarse de ella; falta integración con CloudFront/Cloudflare para URLs con caché.

## 4. Catálogo de tipos de objeto (*kinds*)

- ✅ Catálogo definido en código (`platform/storage/src/kinds.js`) con MIME, `maxBytes` y `retentionDays` por *kind*.
- ✅ *Kinds* actuales: `menu_photo`, `signature`, `intake_attachment`, `dispute_evidence`, `message_attachment`, `review_media`, `catalog_image`, `service_image`, `resource_attachment`, `telehealth_recording`, `payout_report`, `invoice`, `qr_code`, `aikikan_certificate`.
- ✅ `GET /v1/storage/kinds` público para que los frontends sepan qué kinds están permitidos.
- ✅ `GET /v1/storage/admin/kinds` con detalles completos (MIME, maxBytes) para staff.
- 🔧 Los *kinds* son inmutables en código; añadir uno requiere un despliegue.
- ❌ Kinds configurables por tenant en BD (tenant-custom kinds con sus propias políticas).
- ❌ Soporte para `application/octet-stream` genérico con validación adicional de magic bytes.
- ❌ Verificación de tipo real (magic bytes / libmagic) en el servidor — hoy se confía en el `Content-Type` declarado por el cliente.

## 5. Metadatos y etiquetas

- ✅ Campo `metadata JSONB` libre en la fila del objeto (pasado por el cliente al solicitar la carga).
- ✅ Campos de auditoría: `owner_user_id`, `created_at`, `finalized_at`, `deleted_at`.
- ✅ Campos técnicos: `filename`, `content_type`, `size_bytes`, `sha256`, `bucket`, `key`.
- 🔧 `metadata` no tiene validación de esquema por *kind* — cualquier JSONB es aceptado.
- ❌ Actualización de `metadata` tras la finalización (PATCH de metadatos sin re-subir el fichero).
- ❌ Etiquetas/tags estructurados (lista de pares clave-valor) independientes de `metadata` para búsquedas O(1).
- ❌ Campo `description` o `alt_text` para imágenes (accesibilidad + SEO).
- ❌ Historial de cambios de metadatos (audit log de metadatos).

## 6. Listado y búsqueda de objetos

- ✅ `GET /v1/storage/objects` — lista objetos del tenant con filtros `kind`, `ownerUserId`, `status`, `limit` (máx. 500).
- ✅ Ordenación por `created_at DESC` implícita.
- 🔧 Sin paginación real (cursor/offset) — solo `limit`; en tenants con muchos objetos la respuesta se trunca silenciosamente.
- ❌ Búsqueda full-text por `filename` o campos de `metadata`.
- ❌ Filtros por rango de fechas (`created_at between …`), `size_bytes`, `content_type`.
- ❌ Vista de objetos pendientes expirados (limpieza de cargas abandonadas).
- ❌ Admin list cross-tenant para `super_admin` (hoy el listado está siempre scoped al tenant del JWT).

## 7. Eliminación y papelera (*soft-delete*)

- ✅ `DELETE /v1/storage/objects/:id` — soft-delete (`status='deleted'`, `deleted_at=now()`).
- ✅ Control de acceso: owner puede borrar su propio objeto; staff puede borrar cualquier objeto del tenant.
- ✅ Idempotente: si ya está `deleted`, devuelve la fila sin duplicar eventos.
- ✅ Evento `storage.object.deleted` en Redis.
- 🔧 El objeto sigue en el bucket S3 tras el soft-delete; el hard-delete del bucket no se realiza (la función `deleteObject` del SDK existe pero no se llama).
- ❌ Hard-delete real del bucket como paso opcional/configurable tras el soft-delete.
- ❌ Periodo de gracia configurable antes del hard-delete (papelera de 30 días).
- ❌ Restauración de objetos borrados antes del hard-delete.
- ❌ Job de scheduler para hard-delete en lote de objetos con `deleted_at` antiguo.

## 8. Retención y expiración (TTL)

- ✅ `retention_until TIMESTAMPTZ` calculado al insertar según `retentionDays` del *kind* (null = sin expiración).
- ✅ Índice parcial `idx_storage_objects_retention` para consultas eficientes de expirados.
- ✅ Valores de retención por *kind*: `signature` 7 años, `intake_attachment` 5 años, `telehealth_recording` 1 año, `payout_report`/`invoice` 7 años, `aikikan_certificate` 10 años, etc.
- ✅ Purga real (hard-delete bytes + fila) de objetos con `retention_until` vencido: servicio `purgeExpired` + repo `findExpired` + endpoint staff `POST /v1/storage/admin/retention/purge`; cada purga publica `storage.object.deleted { hard:true, reason:'retention' }`. Es la unidad de trabajo que el cron invocaría.
- 🔧 Job `storage-retention-purge` en `platform-scheduler` — **cross-cutting pendiente**: la lógica vive en `purgeExpired`; falta una entrada de cron en `platform/scheduler` (p.ej. `'30 3 * * *'`) que la dispare por tenant.
- ❌ Retención configurable por tenant (un tenant con obligaciones legales distintas podría necesitar valores diferentes).
- ✅ Notificación previa a la expiración (`storage.object.expiring_soon`) para que el propietario archive: servicio `notifyExpiringSoon` + repo `findExpiringSoon(windowDays)` + endpoint staff `POST /v1/storage/admin/retention/notify-expiring`. **Cross-cutting pendiente**: el scheduler debería llamarlo en ventanas T-30d/T-7d y `platform/notifications` consumir el evento.

## 9. Cuotas y límites por tenant

- ✅ Límite de tamaño por fichero por *kind* (`maxBytes`).
- ❌ Cuota de almacenamiento total por tenant (GB/mes).
- ❌ Cuota de número de objetos por tenant o por *kind*.
- ❌ Contabilización de bytes consumidos (`SUM(size_bytes) WHERE status='uploaded'`) expuesta en API.
- ❌ Alertas de cuota (80 %, 100 %) vía evento o notificación.
- ❌ Bloqueo de nuevas cargas al superar la cuota (`402 Payment Required` o `429`).
- ❌ Planes de cuota configurables desde la consola de administración.

## 10. Control de acceso y visibilidad (público/privado/firmado)

- ✅ Por defecto todos los objetos son privados — solo accesibles mediante presigned GET.
- ✅ Guard de tenant en cada operación: RLS + filtro explícito `app_id+tenant_id` en cada query.
- ✅ `appGuard` del SDK garantiza que un JWT de app A no accede a objetos de app B.
- ❌ Objetos marcados como públicos (URL pública sin firma, bucket ACL `public-read`).
- ❌ Compartición de objeto entre tenants del mismo `app_id` (cross-tenant share con token).
- ❌ URLs de descarga con token temporal independiente del JWT (compartir con usuario no autenticado).
- ❌ Control de acceso por rol dentro del tenant (solo `owner` puede descargar; staff puede ver metadatos pero no descargar).
- ❌ Restricción de descarga por IP o dominio de referencia.

## 11. Cargas multiparte y reanudables (*resumable uploads*)

- ❌ Multipart Upload de S3 (para ficheros >5 GB o cargas interrumpibles) — el SDK tiene `PutObjectCommand` pero no `CreateMultipartUploadCommand`.
- ❌ API para iniciar, completar y abortar multipart (`POST /uploads/:id/multipart`, `PUT /uploads/:id/parts/:n`, `POST /uploads/:id/complete`).
- ❌ Reanudación de carga tras interrupción de red (soporte frontend TUS o S3 multipart).
- ❌ Progress reporting por parte (webhooks o polling de `UploadedParts`).

## 12. Procesamiento posterior a la carga (*post-upload processing*)

- ❌ Generación de thumbnails de imágenes (180×180, 640×480) al recibir `storage.object.uploaded`.
- ❌ Conversión de formato (WebP de imágenes JPEG/PNG; HLS de vídeo MP4 para streaming adaptativo).
- ❌ Extracción de metadatos de imagen (EXIF: dimensiones, orientación, GPS si existe).
- ❌ Extracción de metadatos de vídeo (duración, resolución, codecs).
- ❌ OCR de documentos PDF/imagen para búsqueda full-text.
- ❌ Generación de vista previa de PDF (imagen de la primera página).
- ❌ Marcas de agua (*watermark*) en imágenes/vídeos según configuración del tenant.
- ❌ Pipeline de procesamiento configurable por *kind* (qué pasos aplicar a cada tipo).
- ❌ Almacenamiento de variantes derivadas vinculadas al objeto original (`parent_id`).

## 13. Escaneo antivirus / seguridad del contenido

- ❌ Escaneo antimalware (ClamAV o servicio externo) antes de marcar el objeto como `uploaded`.
- ❌ Estado de cuarentena (`status='quarantined'`) mientras dura el análisis.
- ❌ Rechazo de ficheros maliciosos con eliminación del bucket y evento `storage.object.rejected`.
- ❌ Moderación de contenido de imágenes (NSFW, violencia) vía Vision API.
- ❌ Notificación a staff cuando se detecta contenido sospechoso.

## 14. Integridad y deduplicación

- ✅ `sha256` capturado del ETag al finalizar (best-effort — ETag compuesto en multipart no es SHA-256 puro).
- ❌ Cálculo y verificación de SHA-256 real del contenido (HEAD ETag insuficiente para multipart).
- ❌ Deduplicación por hash: si el mismo fichero ya existe en el bucket del tenant, reutilizar la clave S3 en vez de subir de nuevo.
- ❌ Detección de duplicados cross-tenant con `sha256` (para informes, no para compartir datos).
- ❌ Validación de checksum en el PUT firmado (`x-amz-checksum-sha256`).

## 15. Aislamiento por tenant en paths y buckets

- ✅ Clave S3 con prefijo `{appId}/{tenantId}/{objectId}` — los objetos de distintos tenants nunca colisionan dentro del mismo bucket.
- ✅ RLS en PostgreSQL con `app_id + tenant_id`.
- 🔧 Bucket único `apphub` para todos los tenants — sin aislamiento a nivel de bucket S3.
- ❌ Bucket dedicado por tenant o por `app_id` (fuerte aislamiento, útil para permisos IAM por tenant en AWS).
- ❌ Bucket dedicado por *kind* (facilita políticas de ciclo de vida S3 nativas).
- ❌ Políticas IAM/MinIO por tenant generadas automáticamente al crear el tenant.

## 16. Configuración S3 y administración

- ✅ Tabla `platform_storage.settings` con claves `s3_endpoint`, `s3_public_endpoint`, `s3_region`, `s3_bucket`, `s3_access_key`, `s3_secret_key`, `s3_force_path_style`.
- ✅ Cifrado AES-256-GCM de credenciales sensibles (`s3_access_key`, `s3_secret_key`) vía `@apphub/platform-sdk/crypto`.
- ✅ `GET /v1/storage/admin/config` + `PATCH /v1/storage/admin/config` con guard `super_admin|staff`.
- ✅ Invalidación del cliente S3 cacheado tras PATCH de configuración.
- ✅ Prioridad DB sobre env vars en tiempo de ejecución.
- 🔧 Sin validación de conectividad al guardar nueva configuración (no se hace un `HeadBucket` de test antes de aceptar el PATCH).
- ❌ Soporte multi-backend: distintos buckets/credenciales por *kind* o por tenant (ej. vídeos en Cloudflare R2, imágenes en MinIO).
- ❌ Interfaz de consola en `apps/portal` (o `apps/console`) para gestión visual de settings.

## 17. Cifrado en reposo (*SSE*)

- ✅ MinIO admite SSE-S3 y SSE-C; el módulo no lo impide.
- 🔧 El módulo no incluye `ServerSideEncryption` ni `SSECustomerAlgorithm` en los comandos S3 — el cifrado depende de la configuración de MinIO/S3 a nivel de bucket.
- ❌ SSE-C (clave por objeto proporcionada por el cliente) para cifrado extremo a extremo gestionado por el tenant.
- ❌ SSE-KMS con clave KMS por tenant (rotación de claves sin re-cifrado de objetos).
- ❌ Configuración de cifrado en reposo por *kind* (firmado en el presigned URL).

## 18. CDN, caché y distribución

- ✅ Separación de `S3_ENDPOINT` (acceso Node) y `S3_PUBLIC_ENDPOINT` (acceso browser) para topologías Docker/prod distintas.
- ❌ Integración con CDN (Cloudflare, CloudFront): derivar presigned URLs con dominio CDN en vez del bucket directo.
- ❌ Cache-Control headers en los objetos S3 (para que el CDN los almacene correctamente).
- ❌ Invalidación de caché CDN al borrar o actualizar un objeto.
- ❌ Signed cookies para acceso CDN a carpetas completas sin firmar URL por objeto.

## 19. Auditoría de accesos y trazabilidad

- ✅ Evento `storage.object.uploaded` con `appId, tenantId, objectId, kind, sizeBytes, contentType`.
- ✅ Evento `storage.object.deleted` con `appId, tenantId, objectId, kind`.
- ✅ `owner_user_id`, `created_at`, `finalized_at`, `deleted_at` en la fila del objeto.
- ✅ Registro de cada descarga: al emitir la presigned GET se inserta fila en `platform_storage.access_log` (`object_id, kind, action, user_id, ip, user_agent, created_at`) y se publica `storage.object.downloaded` con `userId, ip, userAgent`.
- ❌ Registro de intentos de acceso no autorizados (403) al objeto.
- ✅ Tabla `platform_storage.access_log` (RLS por `app_id+tenant_id`) + evento Redis `storage.object.downloaded` para consumo de módulos de compliance; lectura staff via `GET /v1/storage/admin/access-log` (cursor-paginada, filtro `objectId`).
- ❌ Exportación de audit log por tenant (GDPR).

## 20. Cumplimiento GDPR / borrado de datos personales

- ✅ Soft-delete con `deleted_at`.
- 🔧 El objeto físico sigue en el bucket tras el soft-delete (hard-delete no implementado).
- ❌ Hard-delete real del bucket al ejecutar derecho de supresión (art. 17 GDPR).
- ❌ Anonimización de `filename` y `metadata` en vez de borrado cuando el borrado físico no es inmediato.
- ❌ Endpoint `DELETE /v1/storage/tenant/:tenantId/objects` (borrado masivo de todos los objetos de un tenant, p.ej. al dar de baja).
- ❌ Portabilidad: export de todos los objetos de un usuario en ZIP (art. 20 GDPR).
- ❌ Registros de la base legal y finalidad del tratamiento por *kind* (vinculación a política de privacidad).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ~~**Hard-delete real del bucket** tras soft-delete (o job de scheduler diferido)~~ ✅ — `deleteObject(..., { hard:true })` (staff) borra bytes + fila; `restoreObject` revierte soft-deletes.
2. ~~**Job `storage-retention-purge`** (lógica de purga)~~ ✅ servicio `purgeExpired` + endpoint admin; 🔧 el cron en `platform-scheduler` queda **cross-cutting pendiente**.
3. ~~**`Content-Disposition` en el presigned GET** con el `filename` original~~ ✅ `presignGetWithDisposition`.
4. ~~**Test de conectividad al guardar configuración** (`HeadBucket` tras PATCH admin)~~ ✅ `testConnectivity` + `POST /admin/config/test` y probe best-effort en el PATCH.
5. ~~**Paginación real (cursor)** en `GET /v1/storage/objects`~~ ✅ cursor `{createdAt}|{id}` con `nextCursor`.
6. ~~**Cuota de almacenamiento por tenant** + `SUM(size_bytes)` expuesto en API~~ ✅ tabla `quotas`, `GET /v1/storage/usage`, enforcement en `requestUpload` (413).
7. **Thumbnails de imágenes** al recibir `storage.object.uploaded` (consumer asíncrono) — REUSE `platform-scheduler` o un worker Redis; alto impacto en UX de galerías de `menu_photo`, `catalog_image`, `review_media`.
8. **Escaneo antivirus** en flujo de finalización (ClamAV embebido o API externa) — riesgo de seguridad activo al aceptar PDFs y vídeos de usuarios.
9. **Verificación real de SHA-256** (no confiar en ETag de multipart) — fiabilidad de integridad para `signature`, `payout_report`, `invoice` (documentos legales).
10. ~~**Audit log de descargas** (`storage.object.downloaded`)~~ ✅ tabla `access_log` + evento + `GET /admin/access-log`.
