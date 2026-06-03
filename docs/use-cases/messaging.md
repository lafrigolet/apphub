# Casos de uso — `platform/messaging` (platform-marketplace)

> **Dominio:** mensajería transaccional buyer ↔ vendor ligada a pedidos y listings del marketplace. Los hilos están anclados a una orden (`order_id`, nullable para preguntas pre-venta sobre un producto) y a los dos actores del marketplace. Vive en `platform/marketplace` (puerto 3100), schema `platform_messaging`, rol `svc_platform_messaging`.
>
> **Frontera con `platform/chat`:** `platform/chat` es un sistema de mensajería general para miembros (direct 1:1, grupos, soporte humano), con tiempo real WebSocket, presencia, typing, hilos, reacciones, bans, macros, etc. `platform/messaging` es una bandeja transaccional minimalista: canal uno-a-uno intra-pedido, sin WebSocket propio, sin presencia, sin grupos. Los dos módulos son complementarios y distintos. Una app puede necesitar ambos: chat para la comunidad, messaging para las transacciones del marketplace.

## Estado actual (implementado)

Creación de hilos buyer↔vendor con referencia opcional a `order_id`; envío y listado de mensajes con paginación; marcado de lectura individual (`read_at`); adjuntos en dos capas (JSONB legacy + tabla `message_attachments` referenciada a `platform_storage`); anti-disintermediación con redacción automática de emails y teléfonos (`redactPii`); autorización de participante (solo buyer/vendor del hilo o staff/super_admin); aislamiento multi-tenant por RLS en las tres tablas; evento `message.created` en `platform.events`; índices para listados por buyer, vendor y orden.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Ciclo de vida del hilo

- ✅ Creación de hilo con `buyer_user_id`, `vendor_user_id`, `order_id` (nullable) y `subject` libre.
- ✅ Estado `open` por defecto; transición a `archived`.
- ✅ `last_message_at` actualizado automáticamente al insertar un mensaje (side-effect en repositorio).
- ✅ Listado de hilos del usuario con rol `?role=buyer|vendor`, ordenados por actividad reciente (COALESCE `last_message_at`, `created_at`), límite 100.
- ✅ Obtención de hilo individual con control de acceso (participante o staff).
- 🔧 Estado limitado a `open` / `archived` — sin `closed` diferenciado (transacción completada vs. bloqueado vs. archivado por el usuario).
- 🔧 No hay deduplicación de hilos: se pueden crear múltiples hilos entre el mismo par buyer/vendor para el mismo `order_id`.
- ❌ Cierre automático del hilo al completarse/cancelarse la orden (REUSE evento `order.completed` de `platform/orders`).
- ❌ Reapertura de hilo archivado por el usuario.
- ❌ Hilo iniciado por el vendedor (hoy el rol buyer/vendor es libre en el body, no se valida contra el pedido).
- ❌ Hilo de pre-venta referenciado a un `listing_id` / `product_id` (sin `order_id`), como pregunta pública sobre el producto.
- ❌ Paginación de la lista de hilos (hoy hardcoded LIMIT 100).

## 2. Mensajes — núcleo

- ✅ Envío de mensaje de texto (hasta 10 000 caracteres) por cualquier participante del hilo.
- ✅ Listado de mensajes de un hilo con paginación (`limit`, `offset`), orden cronológico ascendente.
- ✅ `sender_user_id` registrado en cada mensaje.
- ✅ Adjuntos en el cuerpo via JSONB (`attachments` array, esquema libre — formato legacy).
- 🔧 El campo `attachments` JSONB es de esquema libre — no se valida ni se resuelve a URLs en la respuesta.
- ❌ Tipos de mensaje (texto, imagen, sistema/evento, oferta, propuesta de precio).
- ❌ Edición de mensajes enviados (con historial de ediciones y flag `edited_at`).
- ❌ Borrado de mensajes por el emisor o por moderación.
- ❌ Cursores de paginación eficiente (cursor-based) en lugar de OFFSET para conversaciones largas.
- ❌ Mensaje de sistema automático al crear el hilo (ej. "Hilo abierto sobre pedido #XYZ").

## 3. Estados de lectura y notificaciones

- ✅ Marcado de lectura individual por mensaje (`POST …/messages/:mid/read`); `read_at = COALESCE(read_at, now())` (idempotente).
- ✅ Evento `message.created` publicado en `platform.events` con `messageId`, `threadId`, `senderUserId`, `recipientUserId`, `orderId` — consumer externo puede disparar notificación push/email (REUSE `platform/notifications`).
- 🔧 Lectura individual por mensaje: no hay marcado masivo de "marcar todo el hilo como leído".
- 🔧 `read_at` solo en la tabla `messages` (no hay tabla de "lectura por usuario" — si dos users leen el mismo mensaje no se registra de forma independiente).
- ❌ Contador de mensajes no leídos por hilo (badge).
- ❌ Indicador de estado de entrega: `sent → delivered → read` (modelo de recibos).
- ❌ Notificación directa desde el módulo al destinatario (hoy solo evento en bus; el subscriber debe implementar el envío).
- ❌ Preferencias de notificación por usuario (mute de hilo, frecuencia de digest).
- ❌ Notificación de "typing" / indicador de escritura en tiempo real (WebSocket propio no implementado).
- ❌ Digest de mensajes pendientes (resumen diario/semanal vía `platform/scheduler`).

## 4. Adjuntos vía `platform/storage`

- ✅ Tabla `message_attachments` referenciada a `object_id` de `platform_storage`, con `kind IN ('image', 'video', 'file')` y `display_order`.
- ✅ Endpoint para listar adjuntos por mensaje (`GET …/attachments`).
- ✅ Endpoint para adjuntar un objeto ya subido a `platform/storage` a un mensaje existente (`POST …/attachments`).
- ✅ Borrado de adjunto: solo el emisor original del mensaje o staff/super_admin puede eliminar (`DELETE …/attachments/:attachmentId`).
- ✅ Prevención de cross-thread leak: se valida que el `message_id` pertenece al `thread_id` de la ruta.
- 🔧 Doble vía de adjuntos (JSONB legacy + tabla nueva): la respuesta del listado de mensajes no unifica las dos fuentes — el cliente debe consultar ambos endpoints.
- ❌ Presigned URL de descarga resuelta en la respuesta de listado de adjuntos (hoy solo se devuelve `object_id` — el cliente debe resolver la URL en `platform/storage`).
- ❌ Restricción de tipos MIME permitidos por tenant (imágenes sí, ejecutables no).
- ❌ Límite de tamaño de adjunto por mensaje / por hilo configurable.
- ❌ Vista previa inline (thumbnail) generada al adjuntar.
- ❌ Eliminación del objeto en `platform/storage` al borrar el adjunto (hoy solo se borra la fila en `message_attachments`; el objeto huérfano queda en storage).

## 5. Anti-disintermediación y moderación de contenido

- ✅ `redactPii`: emails (`[email oculto]`) y teléfonos con ≥ 9 dígitos (`[teléfono oculto]`) enmascarados automáticamente antes de persistir el cuerpo del mensaje.
- ✅ El texto almacenado y servido nunca contiene email ni teléfono del emisor/receptor.
- 🔧 Solo emails y teléfonos — no se detectan URLs externas, nombres de usuario de redes sociales, referencias a apps de mensajería (WhatsApp, Telegram, Signal, WeChat).
- 🔧 La redacción es unidireccional (escritura) — no hay re-evaluación de mensajes históricos si el patrón mejora.
- ❌ Detección de intención de salir de plataforma: URLs con dominios de mensajería, expresiones del tipo "escríbeme por…".
- ❌ Palabras prohibidas / lista negra configurable por tenant (vocabulario ofensivo, spam).
- ❌ Clasificador de spam / phishing automático.
- ❌ Cuarentena de mensajes sospechosos (estado `pending_review`) para moderación manual antes de entrega.
- ❌ Flag de mensaje por el destinatario (`report_message`).
- ❌ Bloqueo de usuario por parte del comprador o del vendedor (`block_user`).
- ❌ Panel de moderación para staff: cola de mensajes reportados/en cuarentena, historial de acciones.
- ❌ Log de auditoría de acciones de moderación (quién bloqueó/eliminó qué y cuándo).

## 6. Control de acceso y seguridad

- ✅ Solo buyer, vendor del hilo y staff/super_admin pueden leer/escribir en un hilo.
- ✅ Solo el emisor original del mensaje o staff puede eliminar sus adjuntos.
- ✅ RLS en las tres tablas (`threads`, `messages`, `message_attachments`) — aislamiento a nivel de base de datos.
- ✅ Contexto de tenant inyectado en todas las queries (`app_id` + `tenant_id` en todos los WHERE y en RLS).
- 🔧 La autorización no valida que `buyerUserId` / `vendorUserId` del body correspondan realmente a los roles del pedido referenciado en `platform/orders` — cualquier usuario con un JWT válido puede crear un hilo con roles arbitrarios.
- ❌ Verificación de que el `order_id` del hilo existe en `platform/orders` y pertenece al tenant (integridad referencial entre módulos por evento/HTTP, no por FK cross-schema).
- ❌ Rate limiting por usuario/tenant en `POST …/messages` (anti-flood).
- ❌ Tamaño máximo del hilo configurable (número máximo de mensajes por thread).
- ❌ Revocación de acceso al hilo al cancelar la orden.

## 7. Hilos pre-venta (preguntas sobre listings)

- 🔧 `order_id` es nullable, lo que técnicamente permite hilos sin pedido — pero no hay endpoints ni semántica específica para pre-venta.
- ❌ Tipo de hilo explícito: `pre_sale` (pregunta sobre listing) vs. `post_sale` (sobre pedido existente).
- ❌ Referencia a `listing_id` / `product_id` para hilos pre-venta.
- ❌ Visibilidad pública de preguntas y respuestas sobre un producto (FAQ del listing).
- ❌ Conversión automática de hilo pre-venta a post-venta al crearse el pedido.
- ❌ Límite de mensajes en hilos pre-venta para evitar abuso comercial.

## 8. Ofertas y negociación dentro del hilo

- ❌ Mensajes de tipo `offer` con `amount`, `currency`, `expires_at`.
- ❌ Flujo de aceptación/rechazo/contra-oferta dentro del hilo.
- ❌ Generación automática del pedido al aceptar una oferta (REUSE `platform/orders`).
- ❌ Notificación al buyer/vendor al expirar una oferta pendiente (REUSE `platform/scheduler`).
- ❌ Historial de negociación enlazado al pedido resultante.

## 9. Tiempo de respuesta del vendedor y SLA

- ❌ Registro del tiempo de primera respuesta del vendor (`first_reply_at`) en el hilo.
- ❌ SLA configurable por tenant: tiempo máximo de respuesta del vendor (ej. 24 h, 48 h).
- ❌ Job de scheduler (`messaging-sla`) para detectar hilos sin respuesta del vendor más allá del SLA y publicar evento `messaging.vendor.sla_breached`.
- ❌ Badge de "tiempo de respuesta habitual" en el perfil del vendedor (calculado sobre hilos históricos).
- ❌ Alerta interna a staff cuando un hilo lleva N días sin respuesta.
- ❌ Auto-cierre o archivado de hilos inactivos tras período configurable.

## 10. Escalado a disputas

- ❌ Botón/endpoint "escalar hilo a disputa" que crea un registro en `platform/disputes` con el historial del hilo adjunto.
- ❌ Enlace bidireccional `dispute_id` ↔ `thread_id` para trazabilidad.
- ❌ Bloqueo de envío de nuevos mensajes al escalar (hilo en estado `in_dispute`).
- ❌ Notificación automática a las partes al escalar (REUSE `platform/notifications`).
- ❌ Acceso del agente de disputas al historial del hilo como evidencia.
- ❌ Cierre del hilo al resolver la disputa con resumen del resultado.

## 11. Integración con `platform/orders`

- 🔧 `order_id` referenciado en el hilo pero sin FK cross-schema ni validación de existencia.
- ❌ Listener del evento `order.completed` o `order.cancelled` para archivar/cerrar automáticamente los hilos relacionados.
- ❌ Visualización del estado actual del pedido dentro del contexto del hilo (enriquecimiento al leer el hilo).
- ❌ Acceso directo al hilo desde el detalle del pedido (endpoint `GET /v1/orders/:id/thread`).
- ❌ Creación automática del hilo al crear un pedido (si la app así lo configura).

## 12. Plantillas y respuestas rápidas del vendedor

- ❌ Biblioteca de respuestas rápidas (macros) del vendedor — mensajes pre-redactados reutilizables (análogos a las macros de `platform/chat` para el soporte).
- ❌ Variables de sustitución en plantillas (`{{buyer_name}}`, `{{order_id}}`, `{{tracking_url}}`).
- ❌ Gestión CRUD de plantillas desde el panel admin del vendedor.
- ❌ Compartición de plantillas entre staff del mismo tenant.
- ❌ Inserción de plantilla via shortcode (`/tracking`, `/saludo`, …).

## 13. Búsqueda y archivado

- ❌ Búsqueda full-text en el cuerpo de los mensajes de un hilo (tsvector/GIN, equivalente a `platform/chat`).
- ❌ Búsqueda global por buyer/vendor/order en la bandeja del staff.
- ❌ Filtros en la lista de hilos: por estado, por fecha, por `order_id`, con o sin mensajes no leídos.
- ❌ Archivado masivo de hilos (por rango de fechas, por estado del pedido).
- ❌ Exportación del historial de un hilo en formato JSON/CSV (para disputas o compliance).

## 14. Tiempo real y polling

- ❌ Gateway WebSocket propio — hoy el módulo no tiene WS; el cliente debe hacer polling o utilizar `platform/chat` para notificaciones en tiempo real.
- ❌ Server-Sent Events (SSE) como alternativa liviana al WebSocket para push de nuevos mensajes.
- ❌ Integración de la notificación `message.created` con el WS gateway de `platform/chat` (cross-módulo prohibido directamente — requeriría evento en bus + consumer en chat).
- ❌ Indicador de "online/disponible" del vendedor (REUSE presencia de `platform/chat`).

## 15. Multi-tenant, multi-app y sub-tenant

- ✅ `app_id` y `tenant_id` en todas las tablas y queries — aislamiento correcto.
- ✅ RLS con `current_setting('app.app_id')` y `app.tenant_id` en las tres tablas.
- 🔧 `sub_tenant_id` presente en el contexto del servicio pero no almacenado en las tablas `threads` / `messages` — hilos no scoped a sub-tenant.
- ❌ Soporte de sub-tenant en el modelo de datos (ej. sucursal que tiene su propio buzón).
- ❌ Configuración por tenant: habilitar/deshabilitar mensajería, SLA, redacción PII, tipos de adjunto permitidos.
- ❌ Cuota de almacenamiento de adjuntos por tenant.

## 16. Privacidad, retención y GDPR

- ✅ PII de contacto (email, teléfono) redactada al persistir — se reduce la exposición de datos personales.
- ❌ Política de retención configurable por tenant: borrado/anonimización de mensajes pasado N días (REUSE `platform/scheduler`).
- ❌ Derecho al olvido: borrado de mensajes y adjuntos de un usuario concreto bajo petición RGPD.
- ❌ Anonimización del `sender_user_id` al borrar la cuenta (reemplazo por sentinel UUID).
- ❌ Consentimiento explícito para revisión de mensajes por parte de staff (auditoría vs. privacidad).
- ❌ Exportación de datos personales de un usuario (mensajes enviados/recibidos) bajo derecho de acceso RGPD.
- ❌ Audit log de accesos de staff/super_admin a hilos de terceros.
- ❌ Hard-delete vs. soft-delete de mensajes con campo `deleted_at`.

## 17. Eventos y observabilidad

- ✅ Evento `message.created` publicado en `platform.events` tras cada mensaje enviado, con payload completo (`messageId`, `threadId`, `senderUserId`, `recipientUserId`, `orderId`).
- ❌ Evento `thread.created` al abrir un nuevo hilo.
- ❌ Evento `thread.archived` / `thread.closed` al cambiar el estado del hilo.
- ❌ Evento `message.read` al marcar un mensaje como leído.
- ❌ Métricas de negocio: mensajes por día, hilos activos, tasa de respuesta del vendor, tiempo medio de primera respuesta — exportables a Prometheus o a un endpoint admin.
- ❌ Trazabilidad de redacción PII: contador/log de cuántos mensajes fueron redactados y qué tipo de PII se ocultó (sin exponer el contenido).

## 18. Modelo de datos y deuda técnica

- ✅ Tablas `threads`, `messages`, `message_attachments` con PK UUID, `app_id`+`tenant_id` en cada fila.
- 🔧 Dualidad de adjuntos: `messages.attachments JSONB` (legacy) + tabla `message_attachments` — doble fuente de verdad; la antigua columna no debería usarse en código nuevo pero persiste "por compatibilidad hacia atrás" sin plan de migración.
- 🔧 El listado `listThreadsForUser` tiene LIMIT 100 hardcoded — no paginado.
- ❌ `thread.status` tiene solo `open` / `archived` — sin `closed`, `in_dispute`, `escalated`.
- ❌ `sub_tenant_id` ausente en las tablas (presente solo en el contexto de runtime).
- ❌ Índice de full-text search en `messages.body` (GIN tsvector).
- ❌ Índice en `messages.read_at IS NULL` para consultas de "no leídos".
- ❌ Tabla `thread_participants` para soportar más de dos actores por hilo (staff, agente de disputas, sub-vendedor).
- ❌ Tabla `message_reactions` o `message_edits` si se decide soportar edición/reacciones.
- ❌ Soft-delete en mensajes y adjuntos (`deleted_at TIMESTAMPTZ`).
- ❌ Plan de migración para eliminar la columna `messages.attachments JSONB` legacy.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Contador de no leídos + marcado masivo del hilo** — desbloquea la UX básica de bandeja de entrada. Requiere índice en `read_at IS NULL` y un endpoint `POST …/threads/:id/read-all`.
2. **Presigned URL resuelta en lista de adjuntos** — el cliente hoy no puede mostrar adjuntos sin una segunda llamada a `platform/storage`; unificar en la respuesta elimina N+1 del frontend.
3. **Validación del `order_id` contra `platform/orders`** (via HTTP interno al crear el hilo) — cierra la brecha de integridad referencial y previene hilos con `order_id` inventados.
4. **Cierre automático de hilos** al completar/cancelar una orden — REUSE evento `order.completed`/`order.cancelled` + job en `platform/scheduler`.
5. **Migración y deprecación de `messages.attachments` JSONB** — eliminar deuda dual de adjuntos: migrar a `message_attachments`, servir la columna unificada en `listMessages`, luego drop column.
6. **SLA de respuesta del vendor** (`first_reply_at` + job `messaging-sla` en `platform/scheduler`) — métrica crítica para confianza en el marketplace.
7. **Detección de off-platform** más robusta: URLs de mensajería externa, handles de redes sociales — extiende `redactPii`.
8. **Escalado a disputas** (endpoint + `dispute_id` en hilo) — REUSE `platform/disputes`; cierra el flujo de resolución de conflictos.
9. **Búsqueda full-text** en mensajes (GIN tsvector en `body`) — necesario para compliance y moderación a escala.
10. **Política de retención GDPR** via `platform/scheduler` + soft-delete — obligatorio en España/UE; bajo coste si se añade `deleted_at` primero.
