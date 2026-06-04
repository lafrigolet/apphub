# Casos de uso — `platform/reviews` (platform-marketplace)

> Dominio: reseñas verificadas + respuestas del vendedor. Valoraciones de producto, vendedor o servicio por compradores autenticados, con votos de utilidad, adjuntos multimedia, moderación y agregados de rating.

## Estado actual (implementado)

Creación de reseña con `target_type ∈ {product, vendor, service}`, `rating 1–5`, `title`, `body`, `order_id` opcional; verificación de compra (soft-fail contra `platform/orders` vía HTTP loopback); unicidad por `(app_id, tenant_id, buyer_user_id, target_type, target_id, order_id)`; ciclo de estado `pending | published | hidden | removed`; respuesta de vendedor/staff (`review_replies`); moderación con guards de rol (`requireRole`), `moderation_reason` y cola `pending`; borrado por hard-delete en cascada; reportes de abuso (`review_reports`, upsert por reporter, cola de triage, auto-hide por umbral, evento `review.reported`); votos útil/no-útil (`review_votes`, upsert, una vez por usuario, auto-exclusión del propio autor); adjuntos foto/vídeo (`review_media`, referencias a `platform_storage`); agregados (`total`, `average`, `r1–r5`, `verified_count`) con caché Redis cache-aside; listado filtrable por `status + verifiedOnly` y ordenable (`sort`) con paginación; endpoint JSON-LD Schema.org (SEO); RLS por `(app_id, tenant_id)`; eventos `review.created`, `review.replied`, `review.hidden`, `review.reported` en `platform.events`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Creación de reseña

- ✅ Alta por comprador autenticado (`POST /v1/reviews`) con `target_type, target_id, rating, title, body, order_id`.
- ✅ Validación Zod: `rating ∈ [1,5]`, `title ≤ 256`, `body ≤ 4000`, `orderId` UUID opcional.
- ✅ Status inicial configurable por el llamante: `pending` o `published` (default `published`).
- ✅ Unicidad garantizada por índice único `(app_id, tenant_id, buyer_user_id, target_type, target_id, COALESCE(order_id, '00000000…'))` — 409 si ya existe.
- ✅ Evento `review.created` publicado en `platform.events` tras inserción exitosa.
- 🔧 El comprador puede enviar `status: 'pending'` para diferir publicación, pero el flujo de auto-publicación tras revisión es manual (staff debe hacer PATCH).
- ✅ `target_type: 'service'` soportado (además de `product | vendor`) — desbloquea reseñas de `platform/appointments`.
- ❌ Reseña de pedido multi-ítem: hoy es una reseña por `target_id`; no hay flujo de "puntúa cada producto de tu pedido".
- ❌ Reseña de entrega / repartidor (tipo `delivery_driver`).
- ❌ Fecha de experiencia (`date_of_experience`) independiente de `created_at`.
- ❌ Política de elegibilidad configurable por tenant (tiempo mínimo desde la compra, estado mínimo del pedido más allá del hard-code `paid|fulfilled|…`).

## 2. Verificación de compra (verified purchase)

- ✅ Llamada HTTP loopback al módulo `platform/orders` con el JWT del comprador; acepta pedidos en estado `paid | fulfilled | shipped | delivered | completed`.
- ✅ Soft-fail: timeout (2 s) o error HTTP → la reseña se guarda con `verified_purchase = FALSE` sin bloquear al usuario.
- ✅ Flag `verified_purchase` almacenado en la fila de la reseña.
- ✅ Índice parcial en `(app_id, tenant_id, target_type, target_id) WHERE verified_purchase = TRUE AND status = 'published'` para consultas de sólo-verificadas.
- ✅ Comprobación de que `order.buyer_user_id === ctx.userId` (no se puede reclamar verificación con el pedido de otro).
- 🔧 Sólo valida el estado del pedido en el momento de la creación; si el pedido se revierte después, `verified_purchase` no se actualiza.
- ❌ Reverificación periódica o webhook `order.reversed` → flip `verified_purchase = FALSE`.
- ❌ Soporte para fuentes de compra externas (verificar compra en plataformas ajenas o importaciones).
- ❌ Verificación de reserva/cita (REUSE `platform/bookings`) para reseñas de servicios.

## 3. Tipos de target (producto / vendedor / servicio)

- ✅ `target_type: 'product'` — reseña de producto del catálogo.
- ✅ `target_type: 'vendor'` — reseña global del vendedor.
- ✅ `target_type: 'service'` — reseña de servicio/cita (CHECK widened en `0004`, enum Zod actualizado; verificación de reserva sigue pendiente).
- ❌ `target_type: 'experience'` / `'event'` — para apps de tipo experiencias/eventos.
- ❌ Reseñas cruzadas: producto + vendedor desde el mismo pedido en una sola operación.
- ❌ Reseña de la plataforma / del marketplace en sí.

## 4. Respuesta del vendedor / staff

- ✅ `POST /v1/reviews/:id/reply` — cualquier usuario autenticado con `vendor_user_id` (sin restricción de rol en el código de rutas; la lógica de autorización confía en el guard de la plataforma).
- ✅ Múltiples respuestas por reseña (tabla `review_replies`, sin límite).
- ✅ `reply.body ≤ 4000` caracteres.
- ✅ Evento `review.replied` con `buyerUserId` incluido (permite notificar al comprador).
- ✅ `requireRole('vendor', 'staff', 'super_admin', 'admin')` en el endpoint de reply — sólo moderadores responden.
- 🔧 No hay límite de número de respuestas por reseña.
- ❌ Edición de una respuesta ya publicada.
- ❌ Borrado de respuesta individual (sólo se borran en cascada al borrar la reseña).
- ❌ Plantillas de respuesta (macros) para agilizar la gestión.
- ❌ Notificación automática al comprador cuando el vendedor responde (el evento existe, pero el consumidor en `platform/notifications` no está implementado).
- ❌ Respuesta pública del comprador a la réplica del vendedor (diálogo).

## 5. Moderación

- ✅ `PATCH /v1/reviews/:id/status` con `status ∈ {pending, published, hidden, removed}` y `moderationReason` opcional.
- ✅ Evento `review.hidden` publicado cuando el nuevo estado es `hidden` o `removed` (incluye `moderationReason`).
- ✅ Hard-delete (`DELETE /v1/reviews/:id`) con cascade a `review_votes`, `review_media` y `review_reports`.
- ✅ Guard de rol en PATCH status y DELETE — `requireRole('vendor', 'staff', 'super_admin', 'admin')`.
- ✅ Cola de moderación: `GET /v1/reviews/moderation/queue` (default `status=pending`, paginada, sólo moderadores).
- ✅ Motivo de ocultación / eliminación (`moderation_reason` en la fila + propagado al evento).
- ❌ Audit log de acciones de moderación (quién cambió qué y cuándo).
- ❌ Filtros automáticos de palabras prohibidas (lista negra configurable por tenant).
- ❌ Detección de spam / duplicados por similitud de texto.
- ❌ Puntuación de confianza / toxicidad (IA o heurística).
- ❌ Cuarentena automática de reseñas que activan reglas de contenido.
- ❌ Apelación por parte del comprador tras ocultación.

## 6. Reporte / denuncia de reseña

- ✅ `POST /v1/reviews/:id/report` por parte de cualquier usuario autenticado (comprador, vendedor, tercero); upsert por `(review_id, reporter_user_id)`.
- ✅ Tipos de reporte: `spam | fake | inappropriate | misinformation | incentivized | other`.
- ✅ Cola de reportes para staff: `GET /v1/reviews/reports` (default `status=open`) + `PATCH /v1/reviews/reports/:reportId` (reviewed/dismissed), sólo moderadores.
- ✅ Umbral de reportes para ocultación automática (≥3 reportes abiertos → `hidden` con `moderation_reason` automático).
- 🔧 Evento `review.reported` publicado con `openCount` (consumidor en `platform/notifications` para avisar a moderadores sigue pendiente — cross-cutting).

## 7. Edición y borrado por el comprador

- ✅ Hard-delete por staff (`DELETE /v1/reviews/:id`) — sin restricción de rol.
- ❌ Edición de la propia reseña por el comprador (PATCH body/rating/title).
- ❌ Historial de ediciones (para evitar abuso post-respuesta del vendedor).
- ❌ Borrado suave (`soft-delete`) con posibilidad de restaurar.
- ❌ Ventana de tiempo máxima para editar (p. ej. 14 días desde publicación).
- ❌ Borrado por el propio comprador (hoy solo staff puede borrar).

## 8. Votos de utilidad (helpful / unhelpful)

- ✅ `PUT /v1/reviews/:id/vote` con `vote ∈ {helpful, unhelpful}` — upsert (cambia el voto si ya existe).
- ✅ Un voto por usuario por reseña (`UNIQUE (review_id, voter_user_id)`).
- ✅ Prevención de auto-voto: lanza 409 si `voter_user_id === buyer_user_id`.
- ✅ `DELETE /v1/reviews/:id/vote` — retira el voto.
- ✅ Contadores `helpful_count` / `unhelpful_count` en la fila de la reseña, recomputados en el service layer (sin triggers).
- 🔧 No hay evento publicado cuando se vota (no se puede reaccionar desde otros módulos).
- ✅ Ordenación de listado por `helpful_count DESC` (`sort=helpful`); ver § 11.
- ❌ Peso del voto según perfil del votante (purchaser vs. no-purchaser).
- ❌ Límite de votos por IP para prevenir abuso anónimo.

## 9. Adjuntos multimedia (foto / vídeo)

- ✅ `POST /v1/reviews/:id/media` con `objectId` (UUID de `platform_storage.objects`), `kind ∈ {photo, video}`, `displayOrder`.
- ✅ `GET /v1/reviews/:id/media` — lista de adjuntos ordenada por `display_order, created_at`.
- ✅ `DELETE /v1/reviews/:id/media/:mediaId` — desvinculación del adjunto.
- ✅ Solo el autor o staff/super_admin puede adjuntar media (comprobación en service).
- ✅ Cascade delete de `review_media` al borrar la reseña.
- 🔧 El módulo solo almacena la referencia al `object_id`; la URL pública/presigned la debe resolver el frontend consultando `platform/storage`.
- ❌ Límite configurable de adjuntos por reseña (tenant-config).
- ❌ Validación de content-type y tamaño máximo en este módulo (delegada a `platform/storage`, pero no hay contrato explícito documentado).
- ❌ Reordenación de adjuntos (PATCH display_order).
- ❌ Moderación de imágenes (detección automática de contenido inapropiado).
- ❌ Generación de thumbnails (REUSE `platform/storage`).

## 10. Agregados y distribución de rating

- ✅ `GET /v1/reviews/aggregate` — devuelve `total`, `average` (float), `r1–r5` (distribución por estrella), `verified_count`.
- ✅ Filtro `verifiedOnly` en el listado.
- ✅ Solo se agregan reseñas con `status = 'published'`.
- ✅ El agregado se cachea en Redis (TTL 300 s) y se invalida en `createReview` / `setStatus` / `remove` / auto-hide por reportes; lectura `cache-aside` con fallback a DB si Redis cae.
- ❌ Evolución temporal del rating (rating medio por mes/semana).
- ❌ Comparativa del target vs. media de la categoría / del tenant.
- ❌ Percentil de rating del vendedor respecto al resto del marketplace.
- ❌ Agregado de votos globales útil/no-útil del target.

## 11. Listado, ordenación y filtros

- ✅ `GET /v1/reviews` con `targetType`, `targetId`, `status`, `verifiedOnly`, `sort`, `limit` (máx 200), `offset`.
- ✅ Ordenación configurable vía `sort ∈ {recent, oldest, helpful, rating_high, rating_low}` (whitelist server-side; default `recent`).
- ❌ Filtro por rango de fechas (`from` / `to`).
- ❌ Filtro por rango de rating (`ratingMin`, `ratingMax`).
- ❌ Filtro por presencia de media.
- ❌ Filtro por reseñas sin respuesta del vendedor (cola de pendientes de respuesta).
- ❌ Búsqueda full-text en `title` y `body`.
- ❌ Cursor-based pagination (para feeds grandes).
- ❌ Ordenación por relevancia (combinación de rating, votos, recencia).

## 12. SEO — JSON-LD Schema.org

- ✅ `GET /v1/reviews/jsonld` — endpoint público que devuelve `Product` o `Organization` con `AggregateRating` y hasta 10 `Review` (sin PII, solo rating/title/body excerpt).
- ✅ Usa `targetName` opcional para el campo `name` del objeto raíz.
- 🔧 Limitado a 10 reseñas de muestra; no es configurable por el llamante.
- 🔧 `author.name` siempre es `'Verified buyer'`; no expone el nombre real del comprador (diseño deliberado, pero no hay opción de opt-in por el usuario).
- ❌ Soporte para `ItemList` (múltiples productos en una misma página de categoría).
- ❌ Structured data para `VideoObject` (adjuntos de vídeo).
- ❌ Cache-Control headers apropiados para que CDN cachee el JSON-LD.

## 13. Solicitud de reseña post-compra

- ❌ Job en `platform/scheduler` que, al detectar `order.delivered` / `order.completed`, envía un recordatorio al comprador invitándole a dejar reseña (REUSE `platform/notifications`).
- ❌ Plantilla de email/push configurable por tenant (número de días tras la entrega).
- ❌ Marca `review_requested_at` en el pedido para evitar solicitudes duplicadas.
- ❌ Limitar a N solicitudes por orden (anti-spam al comprador).
- ❌ Enlace directo `deep-link` a la página de reseña del producto.
- ❌ Seguimiento de tasa de conversión solicitud → reseña enviada.

## 14. Incentivos a reseñas

- ❌ Configuración de recompensa por reseña (descuento, puntos, crédito) por tenant.
- ❌ Validación de que la reseña cumple criterios mínimos (longitud mínima, foto adjunta) antes de otorgar el incentivo.
- ❌ Integración con `platform/payments` o sistema de puntos para emitir el beneficio.
- ❌ Prevención de abuso (no se puede cobrar incentivo si se borra la reseña tras el reward).
- ❌ Marcado de reseña incentivada (disclosure legal).

## 15. Antifraude y detección de fake reviews

- ❌ Límite de reseñas por usuario por tenant en ventana temporal.
- ❌ Detección de patrones de reseña coordinada (spike de nuevas cuentas con 5 estrellas).
- ❌ Score de confianza de la cuenta (antigüedad, número de compras, historial de reseñas).
- ❌ Bloqueo de reseñas de cuentas creadas hace menos de N días.
- ❌ Blacklist de IPs / user agents.
- ❌ Flag `suspicious` en la fila para revisión manual.
- ❌ Integración con señales externas (Stripe Radar risk score, historial de chargebacks).

## 16. Notificaciones y eventos

- ✅ `review.created` publicado en `platform.events` (incluye `targetType`, `targetId`, `rating`, `verifiedPurchase`).
- ✅ `review.replied` publicado con `buyerUserId` (listo para notificar al comprador).
- ✅ `review.hidden` / `review.removed` publicado con nuevo estado (incluye `moderationReason`).
- ✅ `review.reported` publicado con `reason` + `openCount` (analítica / triage).
- ❌ Consumidor en `platform/notifications` para enviar email/push al comprador cuando el vendedor responde.
- ❌ Notificación al vendedor cuando llega una reseña nueva de uno de sus productos.
- ❌ Alerta a staff cuando el rating medio de un target cae por debajo de umbral.
- ❌ Resumen periódico de reseñas nuevas al vendedor (digest diario/semanal).
- ❌ `review.vote_cast` — evento para analítica de engagement.

## 17. GDPR / privacidad y anonimización

- ❌ Derecho de supresión: endpoint para anonimizar/borrar todas las reseñas de un `buyer_user_id` dado (right to be forgotten).
- ❌ Pseudonimización del `buyer_user_id` al borrar el usuario en `platform/auth` (trigger vía evento `user.deleted`).
- ❌ Exportación de datos del usuario (reseñas + votos + media) para derecho de acceso (GDPR Art. 15).
- ❌ Retención configurable: purga automática de reseñas antiguas vía `platform/scheduler`.
- ❌ Audit log de accesos a reseñas (quién consultó qué).
- ❌ Consentimiento explícito antes de publicar la primera reseña (LOPDGDD).

## 18. Multi-tenant y autorización

- ✅ RLS en las tres tablas (`reviews`, `review_replies`, `review_votes`, `review_media`) por `(app_id, tenant_id)`.
- ✅ `appGuard` del SDK garantiza que el token pertenece al `app_id` correcto (no cross-app).
- ✅ Sub-tenant (`sub_tenant_id`) propagado al contexto pero no aplicado en RLS (por diseño: las reseñas son a nivel tenant).
- ✅ `requireRole('vendor', 'staff', 'super_admin', 'admin')` en reply, PATCH status, DELETE, cola de moderación y triage de reportes.
- ❌ Visibilidad de reseñas en estado `pending` / `hidden` limitada a staff y al propio autor.
- ❌ Endpoint admin con listado cross-target para gestión masiva de moderación.
- ❌ Configuración por tenant de los estados de moderación por defecto (algunos pueden querer `pending` como estado inicial obligatorio).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ✅ ~~**Guards de rol en moderación y reply**~~ (`requireRole('vendor','staff','super_admin','admin')` en reply, PATCH status, DELETE, cola de moderación y triage de reportes).
2. **Notificación al comprador cuando el vendedor responde** — el evento `review.replied` ya existe; solo falta el consumidor en `platform/notifications` (REUSE directo). *(Cross-cutting: requiere `platform/notifications`.)*
3. **Solicitud de reseña post-compra** — job en `platform/scheduler` que escucha `order.completed` y envía el correo (REUSE `platform/notifications + scheduler`); gran impacto en volumen de reseñas. *(Cross-cutting: requiere `platform/scheduler` + `platform/notifications`.)*
4. ✅ ~~**Ordenación por helpful_count DESC**~~ (parámetro `sort ∈ {recent, oldest, helpful, rating_high, rating_low}`, whitelist server-side).
5. ✅ ~~**Caché Redis de agregados**~~ (cache-aside TTL 300 s, invalidación en create/setStatus/remove/auto-hide, fallback a DB).
6. ✅ ~~**`target_type: 'service'`**~~ (`CHECK` ampliado en `0004` + enum Zod).
7. ✅ ~~**Moderación básica**: guard de roles + cola `pending` + motivo de ocultación~~ (cola `GET /moderation/queue` + `moderation_reason` en fila y evento).
8. **GDPR — anonimización por `buyer_user_id`** — consumir `user.deleted` y reemplazar IDs por un UUID nulo/anónimo; obligatorio en España/UE antes de producción pública.
9. ✅ ~~**Reporte de reseña** (`/report`)~~ (tipos spam/fake/…, cola de reportes + triage, auto-hide por umbral ≥3, evento `review.reported`).
10. **Edición por el comprador** — ahora solo puede borrar; añadir PATCH con historial de edición mejora la experiencia y reduce el abuso post-reply.
