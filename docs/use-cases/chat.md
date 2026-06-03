# Casos de uso — `platform/chat` (platform-core)

> Dominio: chat de miembros en tiempo real para apps multi-tenant. Tres tipos de conversación: **directo 1:1**, **grupo** (hasta 256 participantes, configurable) y **soporte** (miembro ↔ agente/staff). Gateway WebSocket cross-replica vía Redis pub/sub. El módulo vive en `platform/core`, escucha en el path `/v1/chat`, schema `platform_chat`, rol `svc_platform_chat`. Tenant isolation completa mediante RLS en todas las tablas.

## Estado actual (implementado)

Tres tipos de conversación (`direct`, `group`, `support`) con modelo de participantes con roles (`owner`, `admin`, `member`, `agent`); mensajes de texto, sistema y adjuntos; gateway WebSocket real-time fan-out multi-réplica vía Redis psubscribe; presencia y typing via Redis; hilos (threads); mensajes programados y efímeros; marcadores de lectura y entrega; menciones (usuarios, scopes `all`/`here`, roles de conversación, roles de app); solicitudes DM; invites con código; grupos públicos; reacciones emoji; búsqueda full-text (GIN tsvector); bloqueo entre usuarios; reportes de mensajes/conversaciones; bans de tenant; CSAT; macros (canned responses); colas y asignación de agentes; exportación de conversación; métricas de tenant; configuración por tenant (grupos, tamaño, retención, redacción PII, policy de adjuntos, palabras prohibidas); scheduler-driven jobs para envío diferido, purga efímera y purga por retención; notificaciones offline vía bus de eventos (`platform.events`).

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Tipos de conversación

- ✅ Conversación directa 1:1 (`type: 'direct'`) con deduplicación canónica (`dedupe_key`: ids ordenados + joined).
- ✅ Conversación de grupo (`type: 'group'`) con título, topic, avatar y flag `is_public`; roles internos (`owner`, `admin`, `member`).
- ✅ Conversación de soporte (`type: 'support'`) con `subject`, `priority`, `support_status`, `assigned_agent_user_id`; agentes son participantes con rol `agent`.
- 🔧 Tipos de conversación fijos en tres valores — no hay tipo `channel` (broadcast/announcement), `bot` ni `thread-only`.
- ❌ Canal de anuncio o broadcast (solo el owner puede escribir, el resto solo lee).
- ❌ Conversaciones de voz/vídeo (sala de llamada integrada); el modelo de datos no tiene columna de sala ni provedor de WebRTC.
- ❌ Conversaciones temporales / salas efímeras (expiración en `conversations`, no solo en mensajes).
- ❌ Sub-hilos independientes como conversación propia (los threads son propiedades de mensajes, no conversaciones de primer nivel).

## 2. Gateway WebSocket en tiempo real

- ✅ Endpoint `GET /v1/chat/ws?token=<jwt>` (también acepta `Sec-WebSocket-Protocol`).
- ✅ Autenticación del WS por JWT en query string o sub-protocolo HTTP (única opción viable para browsers en handshake WS).
- ✅ Fan-out multi-réplica: cada instancia de `platform-core` subscribe con `psubscribe('chat:rt:*')`; cualquier escritura publica en el canal Redis y todas las réplicas entregan a sus sockets locales.
- ✅ Frames de cliente entrantes: `typing.start`, `typing.stop`, `presence.ping`.
- ✅ Frames de servidor salientes: `message.created`, `message.updated`, `message.deleted`, `reaction.changed`, `pin.changed`, `participant.changed`, `presence`, `typing`, `read.updated`, `delivered.updated`, `connected`.
- ✅ El envío de mensajes va por REST (ruta auditable única), nunca por el socket.
- 🔧 No hay ACK/confirmación de entrega a nivel WS (la entrega WS es best-effort; el receptor actualiza `last_delivered_message_id` vía REST).
- ❌ Heartbeat/ping automático desde servidor para detectar conexiones zombie (el cliente debe enviar `presence.ping`; no hay `setInterval` servidor-side).
- ❌ Control de flujo / backpressure en el socket (envío síncrono con `try/catch`).
- ❌ Soporte de `wss://` con upgrade certificado independiente del NGINX (configuración delegada a infraestructura).

## 3. Presencia y estado del usuario

- ✅ Presencia online/offline basada en Redis con TTL de 60 s, renovada por `presence.ping`.
- ✅ Transición online → offline al cerrar el socket (o perder conexión), con broadcast a co-participantes.
- ✅ Snapshot de presencia por lote de usuarios (`GET /v1/chat/presence?userIds=a,b,c`).
- ✅ Broadcast de transición de presencia a todos los co-participantes del usuario que se conecta/desconecta.
- 🔧 Solo dos estados (`online`/`offline`); no hay `away`, `busy`, `do not disturb`.
- ❌ Estado personalizado por usuario ("en una reunión", emoji custom…).
- ❌ Presencia a nivel de conversación específica (distinguir en qué sala está activo el usuario).
- ❌ Historial de presencia / última vez activo (`last_seen_at`) persistido en DB (solo Redis efímero).
- ❌ Presencia para usuarios no conectados al WS (e.g., vista admin).

## 4. Indicador de escritura (typing)

- ✅ `typing.start` / `typing.stop` vía WS; Redis key con TTL 6 s para auto-expiración.
- ✅ Fan-out del estado de typing a todos los participantes activos de la conversación.
- ✅ Verificación de que el emisor es participante antes de aceptar el frame.
- 🔧 Solo estado binario `isTyping: true/false`; no incluye quién está escribiendo a nivel de hilo (thread).
- ❌ Typing a nivel de hilo específico (distinguir si el usuario escribe en el thread o en el canal principal).
- ❌ Auto-stop por inactividad en el servidor (solo TTL Redis; si el cliente pierde conexión sin enviar `typing.stop`, el receptor ve un indicador falso durante 6 s como máximo).

## 5. Mensajes — núcleo

- ✅ Tipos de mensaje: `text`, `system` (eventos de sistema sin sender), `attachment`.
- ✅ Envío de mensajes de texto (`POST /v1/chat/conversations/:id/messages`).
- ✅ Edición de mensaje propio (`PATCH …/messages/:mid`); `edited_at` queda marcado.
- ✅ Borrado suave de mensaje propio o por staff/admin de grupo (`DELETE …/messages/:mid`; `deleted_at` stamped).
- ✅ Cita/respuesta: `reply_to_message_id` por referencia al mensaje original.
- ✅ Historial con paginación por cursor (`before`/`after` uuid + `limit`).
- ✅ Resumen de no leídos global (`GET /v1/chat/unread`).
- ✅ Rate limiting: máximo 30 mensajes/10 s por usuario por tenant vía Redis INCR+EXPIRE.
- 🔧 Edición no invalida ni re-dispara menciones (las menciones se persisten al enviar, no al editar).
- ❌ Historial de ediciones de un mensaje (solo se guarda la última versión + `edited_at`).
- ❌ "Eliminado para mí" (hoy el borrado es global).
- ❌ Mensajes de voz (audio adjunto como blob sería posible con `kind='file'`, pero sin transcripción ni player dedicado).
- ❌ Formato enriquecido en el cuerpo (Markdown renderizado, negrita, listas, tablas — el campo `body` es texto plano).

## 6. Hilos (threads)

- ✅ Hilos anidados bajo un mensaje raíz (`thread_root_id`) almacenados como mensajes normales con índice propio.
- ✅ Listado de un hilo (`GET …/messages/:mid/thread`), con paginación por límite.
- ✅ Envío de mensajes de hilo incluyendo `threadRootId` en el body del POST.
- 🔧 No hay contador de respuestas de hilo en la vista de lista de conversación (se necesita JOIN adicional en el cliente o un campo desnormalizado).
- ❌ Notificaciones diferenciadas para respuestas a un hilo en el que participas vs menciones en el canal principal.
- ❌ Paginación por cursor dentro de un hilo (solo `limit`).
- ❌ Threads como conversación independiente ("abrir en hilo separado" como en Slack).

## 7. Mensajes programados (scheduled)

- ✅ Campo `scheduled_for` en el POST; si la fecha es futura, el mensaje queda en `status: 'scheduled'` y no se entrega inmediatamente.
- ✅ Índice parcial `idx_chat_messages_scheduled` para escaneo eficiente por el scheduler.
- ✅ Job `chat-scheduled-send` (cada minuto) en `platform-scheduler` publica `chat.scheduled.due`.
- ✅ Consumer `event-consumer.js` escucha `platform.events` y llama `deliverScheduledFor()` que flipa a `sent`, bumpa `last_message_at` y emite el WS fan-out.
- ✅ Menciones stashed en `metadata` al programar; se persisten en `message_mentions` al entregar.
- 🔧 No hay listado de mensajes programados propios (`GET …/scheduled`).
- 🔧 No hay cancelación ni edición de mensajes programados antes de su entrega.
- ❌ Rescheduling (cambio de `scheduled_for` antes del dispatch).
- ❌ Vista staff de mensajes programados pendientes globales.

## 8. Mensajes efímeros (ephemeral)

- ✅ Campo `expires_at` en el POST; indexado por `idx_chat_messages_expiring` (solo filas con `expires_at IS NOT NULL AND deleted_at IS NULL`).
- ✅ Job `chat-ephemeral-purge` (cada minuto) en `platform-scheduler` soft-delete los mensajes expirados.
- 🔧 La expiración es por soft-delete (queda el registro con `deleted_at`); no hay purga física hasta el job de retención.
- ❌ Indicador visual de cuenta regresiva en el cliente (solo se expone `expires_at` en el payload).
- ❌ Mensajes efímeros que se autodestruyen al ser leídos (estilo "visto una vez") — la expiración es por tiempo, no por lectura.

## 9. Adjuntos (attachments)

- ✅ Adjuntos respaldados por `platform/storage`: se enlaza un `object_id` ya subido a MinIO/S3 (`POST …/messages/:mid/attachments`).
- ✅ Tres tipos de adjunto: `image`, `video`, `file`; campo `display_order` para galerías.
- ✅ Listado (`GET …/attachments`) y desvinculación (`DELETE …/attachments/:attId`).
- ✅ Policy por tenant: `allowed_attachment_kinds` (array de tipos permitidos) y `max_attachment_mb` (advisory).
- 🔧 El límite de tamaño `max_attachment_mb` es advisory — la aplicación del límite real está en `platform/storage`; el chat solo valida el tipo, no el tamaño.
- ❌ Subida directa desde el chat (el flujo es: cliente → `POST /v1/storage/upload` → obtiene `object_id` → `POST …/attachments`; la ruta de storage no está integrada en el flujo de chat del cliente de forma seamless).
- ❌ Generación de thumbnails / previews de imagen o vídeo.
- ❌ Link preview (extracción OG/meta de URLs en el cuerpo del mensaje).
- ❌ Adjuntos en mensajes de hilo (solo mensajes raíz).

## 10. Reacciones emoji

- ✅ Añadir reacción (`PUT …/messages/:mid/reactions/:emoji`); deduplicación por PK `(message_id, user_id, emoji)`.
- ✅ Eliminar reacción (`DELETE …/messages/:mid/reactions/:emoji`).
- ✅ Fan-out WS `reaction.changed` con el array completo de reacciones para el mensaje.
- 🔧 No hay lista REST de reacciones por mensaje (el cliente las recibe por WS o en el payload de listado de mensajes si se incluye en el JOIN — depende de la query del repositorio).
- ❌ Limitación del conjunto de emojis permitidos por tenant (hoy es texto libre).
- ❌ Reacciones en mensajes de sistema.

## 11. Menciones

- ✅ Menciones explícitas por lista de `user_id` (`mentions: [uuid, …]`).
- ✅ Scope `all`: menciona a todos los participantes activos de la conversación.
- ✅ Scope `here`: menciona solo a los participantes actualmente online (consulta presencia Redis).
- ✅ `mentionRoles`: por rol de conversación (`owner`, `admin`, `member`, `agent`); resuelto localmente sin HTTP.
- ✅ `mentionAppRoles`: por rol de plataforma (`staff`, etc.); resuelto vía `GET /v1/users` con el bearer token del emisor (best-effort, retorna `[]` en error/403).
- ✅ Persistencia en `message_mentions`; el emisor nunca se menciona a sí mismo.
- ✅ Evento `chat.mention.created` en `platform.events` para notificaciones offline.
- 🔧 Las menciones de los mensajes programados se stashean en `metadata` y se materializan al entregar — si un participante sale antes de la entrega, la mención puede resolverse a alguien que ya no está (el filtro está implementado).
- ❌ Notificación diferenciada de mención en hilo vs canal principal.
- ❌ Historial de menciones recibidas (`GET /v1/chat/mentions`).
- ❌ Menciones con visualización enriquecida en cliente (el body es texto plano; el cliente debe parsear `@` o usar el array `mentions`).

## 12. Marcadores de lectura y entrega

- ✅ Marcador de lectura por participante: `last_read_message_id` + `last_read_at` (`POST …/read`).
- ✅ Marcador de entrega por participante: `last_delivered_message_id` + `last_delivered_at` (`POST …/delivered`).
- ✅ Fan-out WS `read.updated` y `delivered.updated` a los co-participantes.
- ✅ Resumen global de no leídos por conversación (`GET /v1/chat/unread`).
- 🔧 Los recibos son a nivel de conversación (último mensaje leído/entregado), no a nivel de mensaje individual — no hay "leído por X" por cada mensaje como en WhatsApp.
- ❌ Preferencias por usuario para ocultar los recibos de lectura (privacy).
- ❌ Indicador de "doble check" a nivel de mensaje individual en el cliente (requiere cruzar todos los participantes con su `last_read_message_id`).

## 13. Pins (mensajes fijados)

- ✅ Fijar un mensaje (`PUT …/messages/:mid/pin`); tabla `pinned_messages` con `pinned_by`.
- ✅ Desfijar (`DELETE …/messages/:mid/pin`).
- ✅ Listar los mensajes fijados de una conversación (`GET …/pins`).
- ✅ Fan-out WS `pin.changed` con evento `pinned`/`unpinned`.
- 🔧 No hay límite de mensajes fijados por conversación.
- ❌ Notificación push cuando un mensaje es fijado.
- ❌ Ordenación personalizada de pins (hoy es por `pinned_at DESC` implícito).

## 14. Solicitudes de DM (DM requests)

- ✅ Setting `dm_requests` por tenant; si está activo, un nuevo `direct` arranca con `is_request: true`.
- ✅ Aceptar solicitud: `POST …/conversations/:id/accept` (solo el destinatario; el emisor no puede aceptar su propia solicitud).
- ✅ Declinar solicitud: `POST …/conversations/:id/decline` (deja al destinatario y archiva la conversación).
- 🔧 No hay listado filtrado de conversaciones en estado `is_request` (el filtro de listado permite `status` pero no `is_request` directamente).
- ❌ Notificación push al destinatario de una nueva solicitud DM (el evento `chat.conversation.created` existe, pero la integración con notificaciones depende del consumer externo).
- ❌ Tiempo de expiración de solicitud pendiente.

## 15. Invitaciones a grupos

- ✅ Crear código de invitación con `role`, `maxUses` y `expiresAt` opcionales (`POST …/conversations/:id/invites`).
- ✅ Listar códigos de invitación (`GET …/invites`); revocar código (`DELETE …/invites/:inviteId`).
- ✅ Unirse por código (`POST /v1/chat/invites/:code/join`): valida revocación, expiración y usos máximos.
- ✅ Rol del invitado configurable (`member` o `admin`).
- ✅ Mensaje de sistema `participant.joined` al unirse.
- 🔧 No hay interfaz de listado público de códigos de invitación (solo owner/admin ven los suyos).
- ❌ Invitaciones por email (generar enlace `hulkstein.com/chat/join/<code>` y enviarlo vía `platform/notifications`).
- ❌ Regeneración de código (hay que revocar y crear uno nuevo).
- ❌ Invitaciones de un solo uso con destino directo (sin role selección en la UI).

## 16. Grupos públicos

- ✅ Flag `is_public` en conversaciones de tipo `group`; índice parcial para discovery eficiente.
- ✅ Listar grupos públicos del tenant (`GET /v1/chat/public/conversations`).
- ✅ Unirse a un grupo público sin código (`POST /v1/chat/public/conversations/:id/join`); valida que el usuario no esté baneado.
- 🔧 No hay búsqueda por nombre en el listado de grupos públicos (solo paginación por `last_message_at`).
- ❌ Categorías o etiquetas para clasificar grupos públicos.
- ❌ Contador de miembros expuesto en la vista de discovery.
- ❌ Solicitud de adhesión a grupo "semi-público" (requiere aprobación del owner antes de entrar).

## 17. Moderación — bloqueos entre usuarios

- ✅ Bloquear a un usuario (`PUT /v1/chat/blocks/:userId`); tabla `blocks` con PK `(app, tenant, user_id, blocked_user_id)`.
- ✅ Desbloquear (`DELETE /v1/chat/blocks/:userId`).
- ✅ Listar usuarios bloqueados por el caller (`GET /v1/chat/blocks`).
- ✅ El bloqueo impide crear una nueva conversación directa con el usuario bloqueado (bidireccional: `existsBetween` comprueba ambas direcciones).
- 🔧 El bloqueo no elimina conversaciones directas existentes ni silencia mensajes ya en curso.
- ❌ Bloqueo mútuo automático al declinar una solicitud DM.
- ❌ Notificación silenciosa al bloqueado (sin revelar que fue bloqueado).

## 18. Moderación — reportes de contenido

- ✅ Reportar un mensaje o conversación (`POST /v1/chat/reports`): `target_type` (`message`/`conversation`), `reason` opcional.
- ✅ Evento `chat.message.reported` en `platform.events` para alertar a staff.
- ✅ Staff: listar reportes con filtro por estado (`open`/`reviewed`/`dismissed`) y paginación (`GET /v1/chat/admin/reports`).
- ✅ Staff: actualizar estado del reporte (`PATCH /v1/chat/admin/reports/:id`).
- 🔧 El reporte no conlleva acción automática (suspensión del remitente, borrado del mensaje…).
- ❌ Threshold automático: borrar/ocultar mensaje al recibir N reportes en X tiempo.
- ❌ Historial de reportes por usuario (cuántas veces ha sido reportado un usuario).
- ❌ Notificación push al staff cuando llega un nuevo reporte.
- ❌ Reporte anónimo (el `reporter_user_id` siempre se persiste).

## 19. Moderación — bans de tenant

- ✅ Banear a un usuario de todo el chat del tenant (`POST /v1/chat/admin/bans`): tabla `tenant_bans` con `banned_by` y `reason`.
- ✅ Levantar ban (`DELETE /v1/chat/admin/bans/:userId`).
- ✅ Listar usuarios baneados (`GET /v1/chat/admin/bans`).
- ✅ El ban se verifica antes de crear conversaciones, enviar mensajes y unirse por invite o a grupos públicos.
- 🔧 No hay bans temporales con `banned_until`; todos los bans son indefinidos.
- ❌ Ban de un usuario de una conversación concreta (no del tenant completo).
- ❌ Silencio temporal de un usuario (timeout N minutos sin ban permanente).
- ❌ Notificación al usuario baneado con el motivo.

## 20. Configuración por tenant

- ✅ Tabla `settings` con defaults permisivos (grupos activos, retención nula, redacción desactivada, soporte activo).
- ✅ `allow_groups` / `max_group_size` (1–100 000).
- ✅ `redaction_enabled`: redacción opcional de emails y teléfonos en el cuerpo de mensajes (diferente al módulo `messaging` donde es anti-disintermediación).
- ✅ `retention_days`: días de retención; si `NULL`, sin límite.
- ✅ `support_enabled`: habilita/deshabilita conversaciones de soporte.
- ✅ `dm_requests`: activa solicitudes DM en lugar de creación directa.
- ✅ `allowed_attachment_kinds`: lista blanca de tipos de adjunto (`image`, `video`, `file`).
- ✅ `max_attachment_mb`: tamaño máximo advisory de adjunto.
- ✅ `banned_words`: lista de palabras prohibidas; el módulo rechaza mensajes que las contengan (`assertNoBannedWords`).
- 🔧 No hay UI de configuración en la consola admin (solo API).
- ❌ Configuración por conversación individual (hoy es solo por tenant).
- ❌ Whitelist/blacklist de dominios de email para menciones `mentionAppRoles`.

## 21. Cola y asignación de agentes en soporte

- ✅ Cola nombrada (`queue: string`) por conversación de soporte; routing vía `PATCH …/conversations/:id/queue`.
- ✅ Índice `idx_chat_conversations_support_queue` para lookup eficiente de cola/assigned.
- ✅ Asignación de agente (`POST …/conversations/:id/assign`): agrega al agente como participante y cambia `support_status` de `open` a `pending`.
- ✅ Reasignación soportada (la misma ruta; el agente anterior queda como participante histórico).
- ✅ Vista de cola staff: `GET /v1/chat/support/queue` con filtros por `status` y `queue`.
- 🔧 No hay round-robin ni asignación automática; todo es manual.
- ❌ Capacidad/carga por agente (máximo de tickets abiertos por agente).
- ❌ Respuesta automática de primer contacto ("hemos recibido tu consulta, te atendemos en breve").
- ❌ Transferencia de conversación entre colas/agentes con historial de reasignaciones.
- ❌ Escalado automático a otro agente si no hay respuesta en X minutos.

## 22. SLA y alertas de soporte

- ✅ Campo `sla_breached_at` en conversaciones de soporte; stampado por job `chat-support-sla` cada 15 min.
- ✅ Job `chat-support-sla` publica `chat.support.sla_breached` en `platform.events`.
- 🔧 El umbral SLA está hardcoded en el job del scheduler (no configurable por tenant desde settings).
- ❌ Múltiples umbrales SLA por prioridad (`urgent` → 1h, `normal` → 8h…).
- ❌ Notificación push al agente asignado cuando el SLA se incumple (depende del consumer externo).
- ❌ Escalado automático al supervisor cuando SLA breach.
- ❌ Dashboard de SLA: % cumplimiento, tiempo medio de primera respuesta (MTTR), MTTR por agente.

## 23. CSAT (Customer Satisfaction)

- ✅ Tabla `support_csat` con `rating` (1–5), `comment` y `submitted_by`; deduplicación por `(conversation_id, submitted_by)`.
- ✅ Envío de valoración por el miembro tras resolución (`POST …/conversations/:id/csat`).
- ✅ Lectura por staff (`GET …/conversations/:id/csat`).
- 🔧 No hay envío proactivo de solicitud de CSAT (el módulo no notifica al cliente al resolver; el cliente debe navegar a la ruta).
- ❌ Score agregado por agente, por cola o por período (solo lectura individual).
- ❌ CSAT en conversaciones de grupo (solo `type: 'support'`).
- ❌ NPS o encuestas de múltiples preguntas (hoy es un único campo `rating` + `comment`).

## 24. Macros (respuestas enlatadas)

- ✅ CRUD de macros: crear, listar y borrar (`GET`/`POST`/`DELETE /v1/chat/support/macros`); guards `requireStaff`.
- ✅ Tabla `support_macros` con `title` y `body`; índice por `(app, tenant, title)`.
- 🔧 No hay edición de macro existente (`PATCH`); solo borrar y crear de nuevo.
- ❌ Macros con variables de interpolación (`{{nombre_usuario}}`, `{{número_ticket}}`).
- ❌ Macros accesibles también en conversaciones de grupo/directo (hoy solo en el namespace `support`).
- ❌ Categorías o tags de macros para organización.
- ❌ Macro con acciones combinadas (e.g., enviar texto + cambiar estado + asignar agente).

## 25. Búsqueda de mensajes

- ✅ Full-text search con GIN index `body_tsv` (generado `to_tsvector('simple', body)`).
- ✅ Filtros combinados: `conversationId`, `senderUserId`, `type`, `before`, `after`, `limit`.
- ✅ El JOIN con participantes garantiza que los resultados estén dentro de conversaciones a las que el caller pertenece (RLS + join).
- 🔧 Configuración `simple` del tsvector es language-agnostic pero no tokeniza bien idiomas como español (sin stemming, sin stop words).
- ❌ Búsqueda de adjuntos (por nombre de archivo o tipo).
- ❌ Búsqueda global para staff (hoy el scope está limitado a las conversaciones del caller).
- ❌ Highlighting de término encontrado en el snippet de resultado.
- ❌ Búsqueda en metadatos de mensajes de sistema.
- ❌ Autocompletado / suggest de términos.

## 26. Retención y purga de mensajes

- ✅ `retention_days` configurable por tenant en `settings` (NULL = sin límite).
- ✅ Job `chat-retention-purge` (diariamente a las 3:30) delete mensajes pasada la retención del tenant.
- ✅ Job `chat-ephemeral-purge` (cada minuto) soft-delete mensajes con `expires_at` vencido.
- 🔧 La purga de retención es DELETE físico, pero no elimina `message_attachments` ni los objetos en `platform/storage` (posible huerfano en storage).
- ❌ Purga de objetos huérfanos en `platform/storage` al borrar mensajes con adjuntos (requiere cruce con el módulo de storage).
- ❌ Retención diferenciada por tipo de conversación (soporte con retención legal más larga, directos más corta).
- ❌ Retención configurable por conversación individual.
- ❌ Alerta al admin antes de que expire la retención de conversaciones de interés (e.g., soporte con evidencia legal).

## 27. Notificaciones offline (push / email)

- ✅ Eventos publicados en `platform.events` para consumo por `platform/notifications`:
  - `chat.conversation.created` (nueva conversación o participante añadido)
  - `chat.message.created` (nuevo mensaje)
  - `chat.mention.created` (mención a usuario)
  - `chat.support.assigned` (agente asignado)
  - `chat.support.sla_breached` (SLA incumplido)
  - `chat.message.reported` (mensaje reportado)
- 🔧 Los eventos se publican best-effort (`publishPlatformEvent` en `realtime.service.js`); no hay consumer propio en el módulo de notificaciones confirmado para cada tipo.
- ❌ Preferencias de notificación por conversación configuradas en el cliente: los campos `notify_pref` (`all`/`mentions`/`none`) y `muted_until` existen en `conversation_participants`, pero la lógica de filtrado en el consumer de notificaciones no está implementada en este módulo (queda en quien consuma los eventos).
- ❌ Notificación de solicitud DM pendiente.
- ❌ Digest diario/semanal de actividad no leída.
- ❌ Notificación cuando alguien reacciona a tu mensaje.
- ❌ Notificación de nuevo mensaje fijado.

## 28. Métricas y analítica de chat

- ✅ Endpoint de métricas de tenant (`GET /v1/chat/admin/metrics?sinceDays=7`): delega a `convRepo.metrics()`.
- ✅ Exportación de conversación para auditoría/GDPR (`GET /v1/chat/admin/conversations/:id/export`).
- 🔧 Las métricas están implementadas en el repositorio pero sin especificación explícita de qué campos devuelven (depende de la query SQL del repo, no revisada).
- ❌ Métricas en tiempo real (WS de métricas o SSE).
- ❌ Métricas por agente (tiempo de primera respuesta, volumen de tickets cerrados, CSAT promedio).
- ❌ Funnel de soporte (open → pending → resolved → closed) con tasas de conversión.
- ❌ Volumen de mensajes por conversación, por tipo, por período.
- ❌ Export CSV/JSON de conversaciones filtradas por rango de fechas.

## 29. GDPR / compliance / privacidad

- ✅ Exportación de conversación individual (`GET /v1/chat/admin/conversations/:id/export`) — uso para derecho de acceso.
- ✅ Soft-delete de mensajes (no borrado físico inmediato).
- ✅ Redacción de PII (emails y teléfonos) activable por tenant.
- 🔧 El borrado de datos de usuario (right to be forgotten) no está implementado como operación específica: no hay `DELETE /v1/chat/users/:id/data` que anonimice o elimine todo el historial de un usuario.
- ❌ Anonimización de mensajes al borrar un usuario (sustituir `sender_user_id` por null + borrar body).
- ❌ Exportación de todos los datos de un usuario concreto (`right to portability`).
- ❌ Audit log de quién ha accedido al export (quién descargó los datos de quién).
- ❌ Consentimiento explícito a las condiciones de uso del chat.
- ❌ Registro de base legal para el tratamiento de mensajes (LOPDGDD/RGPD).

## 30. Multi-dispositivo y sincronización

- ✅ La arquitectura de sockets admite múltiples conexiones simultáneas del mismo usuario (`sockets` Map guarda un `Set<socket>` por clave `appId:tenantId:userId`).
- ✅ La presencia se mantiene mientras haya al menos un socket conectado; al cerrar el último se marca offline.
- 🔧 No hay sincronización explícita del estado entre dispositivos al reconectarse (el cliente debe releer el historial desde el último `last_read_message_id`).
- ❌ Señal de sincronización de estado (nuevo dispositivo recibe un evento que indica el punto de resyncrono).
- ❌ Gestión de sesiones activas del usuario (ver y revocar dispositivos).
- ❌ Notificación de "nuevo dispositivo conectado".

## 31. Seguridad y aislamiento

- ✅ RLS habilitado y forzado en todas las tablas del schema `platform_chat`.
- ✅ `appGuard` del SDK verifica `app_id` + `tenant_id` en cada petición REST.
- ✅ El JWT del WS se verifica con `verifyToken` antes de aceptar el socket.
- ✅ `appId:tenantId` forman parte de la clave de routing Redis (no hay cross-tenant delivery).
- ✅ Un usuario baneado es bloqueado en la capa de servicio antes de acceder a la DB.
- ❌ Cifrado end-to-end (E2E) de mensajes — el servidor tiene acceso pleno al contenido.
- ❌ Verificación de integridad del mensaje (hash/firma del cuerpo).
- ❌ Protección contra replay attacks en el WS (el token JWT puede reutilizarse hasta su expiración).
- ❌ Rate limiting en la apertura de conexiones WebSocket (solo hay rate limiting en el envío de mensajes).

## 32. Integración con otros módulos de plataforma

- ✅ `platform/storage`: adjuntos referenciados por `object_id` → `platform_storage.objects`.
- ✅ `platform/auth`: resolución de `mentionAppRoles` vía `GET /v1/users` (HTTP loopback, regla 13).
- ✅ `platform/notifications`: eventos en `platform.events` para push/email offline.
- ✅ `platform/scheduler`: jobs `chat-scheduled-send`, `chat-ephemeral-purge`, `chat-retention-purge`, `chat-support-sla`.
- 🔧 No hay integración explícita con `platform/orders` o `platform/bookings` para mensajes de sistema automáticos (e.g., "tu pedido ha sido enviado" en la conversación de soporte).
- ❌ Integración con `platform/leads`: abrir conversación de soporte desde un lead (REUSE chat modalidad support).
- ❌ Integración con `platform/inquiries`: no hay puente para migrar una inquiry a conversación de soporte.
- ❌ Bots / webhooks internos: no hay tipo de participante `bot` ni endpoint para publicar mensajes como bot.

## 33. Funcionalidades no implementadas de alto valor futuro

- ❌ Voz y videollamada integrada (WebRTC / Livekit / Daily.co) — requiere nuevo tipo de conversación o campo en conversations.
- ❌ Traducción automática de mensajes (Google Translate / DeepL API) — por tenant o por usuario.
- ❌ IA / asistente en soporte: clasificación automática de prioridad, sugerencia de macros, resumen de conversación.
- ❌ Encuestas (polls) en mensajes — nuevo tipo de mensaje `poll` con opciones y votos.
- ❌ Compartir ubicación (coordenadas GPS en mensaje) — nuevo tipo `location`.
- ❌ Confirmación de asistencia a evento desde un mensaje (integración con `platform/bookings`).
- ❌ Rich media nativo: stickers, GIFs animados (Tenor/GIPHY), cards estructuradas.
- ❌ Moderación automática de contenido (SafeSearch, OpenAI Moderation API) antes de persistir el mensaje.
- ❌ Accesibilidad: texto alternativo para imágenes en adjuntos; transcripción de mensajes de voz.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Notificaciones offline reales** — los eventos ya se publican; implementar el consumer en `platform/notifications` para los tipos `chat.message.created` y `chat.mention.created` + respetar `notify_pref` y `muted_until` desbloquea las apps en producción.
2. **GDPR — anonimización al borrar usuario** — riesgo legal inmediato en UE/España; añadir `DELETE /v1/chat/users/:id/data` que ponga `sender_user_id = NULL` y borre `body` de mensajes.
3. **Listado y cancelación de mensajes programados** — gap de UX crítico; el usuario no puede ver ni cancelar lo que programó.
4. **Umbral SLA configurable por tenant/prioridad** — el campo `sla_breached_at` existe; solo falta parametrizar el umbral desde `settings`.
5. **Purga de objetos huérfanos en storage** — al borrar mensajes con adjuntos, invocar `DELETE /v1/storage/objects/:id` para evitar acumulación de objetos sin referencia.
6. **Bans temporales** (`banned_until`) — añadir columna a `tenant_bans` y verificar en el scheduler; coste mínimo, muy demandado en moderación.
7. **Respuesta automática de primer contacto en soporte** — REUSE `platform/notifications`; reduce la frustración del usuario al abrir un ticket.
8. **Integración leads → soporte** — abrir conversación de soporte desde `platform/leads` usando el evento `lead.created`; cierra el ciclo CRM.
9. **Búsqueda con configuración de idioma** — cambiar `to_tsvector('simple', …)` por configuración dinámica o `'spanish'` según el tenant; coste bajo, impacto alto en apps hispanohablantes.
10. **Macros con edición** (`PATCH /v1/chat/support/macros/:id`) — gap mínimo, evita borrar y recrear.
