# Casos de uso — `platform/notifications` (platform-core)

> Dominio: notificaciones multicanal (email, SMS, push web/móvil) disparadas por
> eventos de `platform.events`; plantillas editables en runtime con i18n; dominios
> de envío por tenant verificados en Resend; rate-limiting, digest diario, registro
> de envíos. Proveedores activos: **Resend** (email), **Twilio** (SMS), **FCM HTTP v1**
> (push Android / iOS / web).

## Estado actual (implementado)

Suscripción a `platform.events` vía Redis Pub/Sub; envío email con Resend (API key
cifrada en DB, fallback a env); envío SMS vía Twilio (API key+SID en DB); push via
FCM HTTP v1 (service-account JSON cifrado, OAuth2 con caché); plantillas en tabla
`platform_notifications.templates` indexadas por `(key, channel, locale)` con
interpolación `{{var}}` y fallback a `'es'`; locales soportados en tabla dedicada;
rate-limit por usuario/hora/día en Redis; modo digest diario para eventos no urgentes
(cola Redis por usuario, flush por `notifications.digest.flush`); registro de dominios
de envío por tenant integrados con Resend Domains API (provisión + verificación DNS
SPF/DKIM/DMARC); dispositivos push registrables por usuario (iOS/Android/Web) con
limpieza automática de tokens muertos (FCM UNREGISTERED); admin CRUD de plantillas con
preview; admin CRUD de config (Resend + Twilio + FCM + APNs slots + rate-limits +
digest_mode); APNs reservado (slot, sin implementar). Slot `send_log` creado en DB
pero no escrito por los senders actuales.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Canal email — envío y proveedor

- ✅ Envío transaccional vía Resend (SDK oficial, `from` = `Name <email@domain>` o solo dirección).
- ✅ Config Resend dinámica en DB (`resend_api_key` cifrado AES-256-GCM, `sender_email`, `sender_name`), caché 30s, invalidación inmediata al cambiar config.
- ✅ Fallback a env var `RESEND_API_KEY` / `EMAIL_FROM_ADDRESS` cuando la DB no tiene fila.
- ✅ Dev-stub: cuando no hay API key configurada, el email se loguea en stdout en lugar de enviarse (no bloquea el arranque ni los tests).
- ✅ `Reply-To` opcional por mensaje (usado en flujos inquiry para enrutar respuestas directamente entre user ↔ admin).
- 🔧 Sin reintentos automáticos: si Resend devuelve error se loguea y se abandona. No hay cola de reintentos ni dead-letter.
- ✅ `send_log` persistido: los tres senders (email/sms/push) escriben cada intento con status `sent|failed|skipped` (migración 0021; push con tenant context completo, email/sms con scope NULL hasta el pipeline tenant-aware de TODO-resend).
- ❌ Sin soporte de adjuntos (`attachments`) en el payload de Resend (API lo soporta).
- ❌ Sin soporte de CC / BCC.
- ❌ Sin failover automático a un proveedor secundario (SES, Postmark, Mailgun) cuando Resend falla.
- ❌ Sin envío en lote / batch (Resend Batch API) para campañas masivas.
- ❌ Sin tracking de apertura (open) ni de clic a través del proveedor.
- ❌ Sin bounce/complaint handling: Resend envía webhooks para `email.bounced`, `email.complained` — no hay endpoint que los consuma.
- ❌ Sin supresión de bounces/complaints: un destinatario rebotado sigue recibiendo intentos futuros.

## 2. Canal SMS — envío y proveedor

- ✅ Envío SMS vía Twilio REST API (`Messages.json`) con autenticación API Key + Secret (recomendada sobre Account SID + Auth Token).
- ✅ Config Twilio dinámica en DB (`twilio_account_sid`, `twilio_api_key_sid`, `twilio_api_key_secret` cifrado, `twilio_messaging_service_sid`, `twilio_default_sender`), caché 30s.
- ✅ Dev-stub: cuando faltan credenciales se loguea el SMS en lugar de enviarse.
- ✅ Endpoint admin `POST /sms/test` para smoke-test de la configuración Twilio.
- ✅ SMS implementado para: recordatorio de cita (T-24h / T-2h), cita confirmada, cancelada, reprogramada; recordatorio de reserva, reserva cancelada.
- 🔧 Sin reintentos ni dead-letter para SMS fallidos.
- 🔧 Sin validación de número E.164 antes del envío (Twilio rechaza formatos inválidos sin feedback útil para el usuario).
- ❌ Sin rastreo de estado de entrega (Twilio StatusCallback webhook → `delivered`/`failed`/`undelivered`).
- ❌ Sin opt-out / STOP por número de teléfono (obligatorio en muchas jurisdicciones).
- ❌ Sin soporte MMS.
- ❌ Sin failover a canal alternativo (email) cuando SMS falla.

## 3. Canal push — FCM HTTP v1

- ✅ Push vía FCM HTTP v1 para Android, iOS (vía APNs auth key configurada en Firebase) y web (Web Push).
- ✅ Auth OAuth2 mediante JWT de cuenta de servicio GCP firmado RS256; access token cacheado con refresh 1 min antes del vencimiento.
- ✅ Config FCM dinámica en DB (`fcm_project_id`, `fcm_service_account_json` cifrado), caché 30s.
- ✅ Envío a todos los tokens registrados del usuario (multi-device); limpieza automática de tokens muertos (FCM UNREGISTERED / INVALID_ARGUMENT → `pushRepo.deleteByToken`).
- ✅ `data` payload adicional por mensaje (todos los valores serializados como `string` según requisito FCM v1).
- ✅ Push implementado para: recordatorio de cita, cita confirmada, recordatorio de reserva; nueva notificación de chat, mención en chat, asignación de ticket soporte, SLA de soporte incumplido.
- 🔧 Slots APNs reservados en config (`apns_team_id/key_id/bundle_id/p8_key/apns_environment`) pero sin implementación de APNs HTTP/2 nativo (hoy iOS va por FCM con APNs auth key de Firebase).
- 🔧 Sin payload `notification.imageUrl` ni `android`/`apns`/`webpush` override blocks de FCM v1.
- ❌ Sin soporte de notificaciones silenciosas (data-only) para background sync.
- ❌ Sin badging de app icon ni sonido personalizable por canal FCM.
- ❌ Sin agrupación de notificaciones (FCM `notification.tag` / Android channels).
- ❌ Sin topic messaging (broadcast a grupo de usuarios sin iterar tokens uno a uno).
- ❌ Sin historial de notificaciones push en DB para el centro de notificaciones in-app.

## 4. Registro de dispositivos push

- ✅ `POST /v1/notifications/devices` — upsert token por usuario autenticado (plataforma: `ios`/`android`/`web`; `label` opcional); scoped por `(app_id, tenant_id)` con RLS.
- ✅ `GET /v1/notifications/devices` — listar los dispositivos del usuario autenticado.
- ✅ `DELETE /v1/notifications/devices/:id` — baja de dispositivo propio (verifica `user_id`).
- ✅ Upsert idempotente en `token` UNIQUE: si el mismo token se registra dos veces, actualiza `last_seen_at`.
- ❌ Sin gestión admin de dispositivos (ver / revocar tokens de un usuario desde el panel staff).
- ❌ Sin rotación proactiva de token FCM (solo se actualiza al re-registrar, no al detectar `token_refresh` en cliente).
- ❌ Sin límite máximo de tokens por usuario (unbounded).

## 5. Plantillas — gestión y rendering

- ✅ Tabla `templates(key, channel, locale, subject, body_text, body_html, variables, enabled)` con índice único por `(key, channel, locale)`.
- ✅ Admin CRUD completo: `GET/POST/PATCH/DELETE /v1/notifications/admin/templates`; requiere `super_admin|staff`.
- ✅ Preview de plantilla con vars arbitrarias: `POST /templates/:id/preview` — renderiza en memoria sin enviar.
- ✅ Interpolador `{{var}}` mínimo (Mustache-compatible para variables simples); vars desconocidas se omiten silenciosamente.
- ✅ Fallback a español (`'es'`) cuando no existe fila para el locale pedido.
- ✅ Fallback a hardcoded inline cuando no hay fila en DB para la clave (garantiza entrega antes de que staff configure la plantilla).
- ✅ Por cada plantilla email se almacena `body_text` (obligatorio) y `body_html` (opcional); por SMS/push solo `body_text`.
- ✅ `variables` array declarativo por plantilla (usado por el frontend para mostrar variables disponibles al editor).
- ✅ Semántica `COALESCE`: un campo `body_html` nulo en DB cae al hardcoded default, no manda `null` a Resend.
- ✅ `enabled` booleano — desactivar una plantilla hace que el sender use el fallback hardcoded.
- 🔧 Sin versionado de plantillas (historial de cambios / rollback a revisión anterior).
- 🔧 Sin validación de variables al guardar (se puede guardar `{{typo}}` y no produce error hasta el envío).
- 🔧 Sin layout / wrapper HTML compartido: cada plantilla es un fragmento de HTML sin branding consistente.
- ❌ Sin editor visual WYSIWYG en consola (solo textarea de texto plano).
- ❌ Sin plantillas multipart con attachments declarados (PDFs adjuntos).
- ❌ Sin herencia de plantilla (`extends`) ni bloques parciales (headers, footers, estilos).
- ❌ Sin branding por tenant (logo, colores, tipografía) inyectado automáticamente en el wrapper HTML.

## 6. Internacionalización (i18n) de plantillas

- ✅ Plantillas con locale `'es'` y `'en'` sembradas para todos los eventos core (bookings, reservations, orders, auth, donations, inquiries, tenant bootstrap, digest).
- ✅ Tabla `supported_locales(locale, label, enabled)` como fuente autoritativa para dropdowns de frontend; admite nuevos idiomas en runtime sin despliegues.
- ✅ Admin `GET /locales` para obtener la lista de locales habilitados.
- ✅ `locale` se propaga desde el payload del evento (`event.payload.locale`) con fallback a `'es'`.
- 🔧 Sólo `es` y `en` sembrados; otros idiomas (ca, eu, gl, pt, fr, de…) requieren que staff cree las filas de plantillas manualmente.
- ❌ Sin detección automática del idioma del usuario (desde preferencias de usuario / Accept-Language del browser).
- ❌ Sin herramienta de export/import de traducciones (JSON/XLIFF) para facilitar el trabajo con traductores externos.
- ❌ Sin validación de completitud de traducción (alertar si `en` tiene una plantilla que no existe en `es` o viceversa).

## 7. Config del módulo (admin runtime)

- ✅ Admin `GET/PATCH /v1/notifications/admin/config` — requiere `super_admin|staff`.
- ✅ Claves soportadas en config: `resend_api_key`, `sender_email`, `sender_name`, `twilio_*` (5 claves), `rate_limit_per_user_per_hour`, `rate_limit_per_user_per_day`, `digest_mode`, `fcm_project_id`, `fcm_service_account_json`, APNs slots (5 claves).
- ✅ Claves secretas (`resend_api_key`, `twilio_api_key_secret`, `fcm_service_account_json`, `apns_p8_key`) almacenadas cifradas AES-256-GCM; se presentan como `{ configured: true/false }` en el GET.
- ✅ Invalidación inmediata de caché en memoria al aplicar un PATCH (email, SMS, push, rate-limit, digest).
- 🔧 Sin validación de formato en `PATCH /config`: se pueden guardar claves con valores sintácticamente incorrectos (p.ej. Resend API key con prefijo erróneo) sin feedback hasta el primer envío.
- ❌ Sin endpoint de test para FCM (paralelo al `POST /sms/test` que existe para Twilio).
- ❌ Sin historial de cambios de configuración (audit log de quién cambió qué clave y cuándo).

## 8. Rate limiting por usuario

- ✅ Dos ventanas independientes: por hora (`nrl:h:`) y por día (`nrl:d:`), configurables vía admin config.
- ✅ Contadores en Redis con TTL adecuado (3600+60s para hora, 86400+600s para día); incremento atómico con `MULTI`/`EXEC`.
- ✅ Decremento de rollback cuando se supera el límite (best-effort), para evitar que un burst extienda la supresión indefinidamente.
- ✅ Gate por canal (`email`/`sms`/`push`) y por clase de evento (`eventClass` = `event.type`), así un límite en email no afecta al SMS del mismo evento.
- ✅ Bypass automático para mensajes sin `userId` (staff dispatches, `inquiry.created`, `tenant.bootstrap_started`).
- 🔧 Sin límite a nivel de tenant (solo por usuario); un tenant con muchos usuarios podría generar un volumen alto agregado.
- 🔧 Sin rate limit en el canal de digest (enqueue no está gateado — un digest con 1000 eventos en cola lo enviaría todo de golpe).
- ❌ Sin observabilidad de rate-limit hits en consola (solo logs de pino `warn`).
- ❌ Sin configuración de rate-limit por evento concreto (hoy el límite es global para todos los tipos).

## 9. Digest diario

- ✅ Modo `digest_mode = 'daily'` configurable vía admin config (opción `'off'` por defecto).
- ✅ Lista allowlist de eventos digestibles: `booking.confirmed`, `booking.cancelled`, `booking.rescheduled`, `reservation.created`, `reservation.cancelled`, `package.exhausted`, `payout.paid`.
- ✅ Eventos urgentes (reminders, auth, OTPs, orders, chat) **no** pasan por digest — siempre se envían inmediatamente.
- ✅ Cola por usuario en Redis (`nd:digest:<userId>`) como lista JSON; TTL 7 días para evitar acumulación infinita.
- ✅ Flush atómico por usuario: `RENAME` a clave temporal antes de leer, para que nuevos RPUSHes durante la composición no se pierdan.
- ✅ Composición del email de digest: una línea de resumen por evento con `summarize()`, locales `es`/`en`.
- ✅ Plantilla DB `notifications.digest` intentada primero; fallback a cuerpo generado en código.
- ✅ SMS excluido del digest por diseño (mensajes de texto son urgentes por naturaleza).
- ✅ Trigger del flush: evento `notifications.digest.flush` vía `platform.events` (publicado por platform-scheduler).
- 🔧 Sin frecuencia configurable: solo `off`/`daily`. No hay soporte para `weekly` o frecuencias personalizadas.
- 🔧 Resumen de digest muy básico (líneas de texto); sin formato enriquecido (HTML con detalles de cada evento).
- ❌ Sin opción de digest por categoría (p.ej. agrupar solo los `booking.*` en un digest y los `payout.*` en otro).
- ❌ Sin preferencia individual por usuario (activar/desactivar digest por usuario desde su perfil).

## 10. Suscripción a eventos de `platform.events` — cobertura actual

| Evento | Canal(es) | Módulo origen |
|---|---|---|
| `user.registered` | email | auth |
| `auth.password_reset_requested` | email | auth |
| `auth.magic_link_requested` | email | auth |
| `auth.magic_link_blocked_pending_approval` | email | auth |
| `auth.signup.requested` | email | auth |
| `auth.signup.approved` | email | auth |
| `auth.signup.rejected` | email | auth |
| `tenant.bootstrap_started` | email | tenant-config |
| `tenant.activated` | email | tenant-config |
| `booking.reminder.due` | email + SMS + push | scheduler |
| `booking.confirmed` | email + SMS + push | bookings |
| `booking.cancelled` | email + SMS | bookings |
| `booking.rescheduled` | email + SMS | bookings |
| `reservation.reminder.due` | email + SMS + push | scheduler |
| `reservation.created` | email | reservations |
| `reservation.cancelled` | email + SMS | reservations |
| `package.expiring` | email | scheduler |
| `package.exhausted` | email | packages |
| `payout.paid` | email | practitioner-payouts |
| `dispute.sla_breached` | email (staff) | scheduler |
| `order.paid` | email | orders |
| `order.shipped` | email | orders |
| `order.delivered` | email | orders |
| `order.cancelled` | email | orders |
| `order.refunded` | email | orders |
| `basket.abandoned` | email | scheduler |
| `donation.completed` | email | donations |
| `donation.recurring.charged` | email | donations |
| `donation.recurring.failed` | email | donations |
| `donation.recurring.cancelled` | email | donations |
| `donation.refunded` | email | donations |
| `donation.certificate.ready` | email | donations |
| `inquiry.created` | email ×2 (admin + user) | inquiries |
| `chat.message.created` | push | chat |
| `chat.mention.created` | push | chat |
| `chat.support.assigned` | push | chat |
| `chat.support.sla_breached` | push | chat |
| `notifications.digest.flush` | (flush interno) | scheduler |

Eventos **NO subscritos** aún con módulos implementados:
- ❌ `lead.created` (leads) — notificación interna a staff sin wiring en notifications.
- ❌ `chat.reaction.created`, `chat.message.pinned`, `chat.dm_request` — chat events sin notificaciones.
- ❌ `inventory.low_stock`, `inventory.out_of_stock` — sin notificación a staff/vendor.
- ❌ `review.created`, `review.reply` — sin notificación al vendedor.
- ❌ `dispute.opened`, `dispute.resolved` — solo `dispute.sla_breached` notificado; los transicionales no.
- ❌ `shipping.tracking_updated` — sin notificación de tracking al comprador.
- ❌ `subscription.*` — módulo en estado `planned`.

## 11. Dominios de envío por tenant (Resend branded domains)

- ✅ Tabla `tenant_email_domains(app_id, tenant_id, domain, default_from_local, default_from_name, reply_to_address, provider, provider_domain_id, dns_records, status, ...)` con RLS por `(app_id, tenant_id)`.
- ✅ Provisionamiento en Resend Domains API (`POST /domains`) al crear un dominio.
- ✅ Estado: `pending` → `verified` / `failed` / `suspended`.
- ✅ `POST /:id/verify` — re-verificación bajo demanda (dispara `POST /verify` en Resend + lee estado actual).
- ✅ `dns_records` JSONB con los registros SPF, DKIM, DMARC que el tenant debe publicar.
- ✅ Suspensión de dominio por staff (con motivo); `suspended_at` y `suspend_reason`.
- ✅ CRUD completo: `POST/GET/:id/PATCH/:id/DELETE/:id`; roles `owner|admin|staff|super_admin` para mutaciones.
- ✅ Staff puede impersonar tenant vía `?appId=&tenantId=` en queries (GET/verify/patch/suspend/delete).
- ✅ Dev-stub cuando no hay API key: genera CNAMEs sintéticos y valida como `true` automáticamente.
- 🔧 El `default_from_local` y `default_from_name` se guardan en DB pero **no se usan** en el email sender actual (que usa la config global `sender_email` / `sender_name`).
- 🔧 Solo soporte para proveedor `'resend'`; la tabla tiene enum `CHECK` con `sendgrid|ses|postmark|mailgun` pero solo Resend está implementado.
- ❌ Sin re-verificación periódica automática (scheduler job que detecte dominios que pierdan su verificación DNS).
- ❌ Sin selección dinámica del `from` domain por tenant al enviar (el sender global no consulta esta tabla).
- ❌ Sin warmup de dominio / reputación (crítico para dominios nuevos con alta cadencia de envío).

## 12. Preferencias de notificación por usuario / opt-out

- ❌ Sin tabla de preferencias de usuario (`notification_preferences`).
- ❌ Sin opt-out por categoría (p.ej. desuscribirse de emails de marketing manteniendo los transaccionales).
- ❌ Sin enlace `Unsubscribe` en el footer de los emails (requerido por CAN-SPAM / GDPR para comunicaciones no puramente transaccionales).
- ❌ Sin gestión de lista de supresión (suppression list) propia (Resend mantiene una internamente pero no se expone al módulo).
- ❌ Sin endpoint usuario `GET/PATCH /v1/notifications/preferences` para auto-gestión desde el portal.
- ❌ Sin `communication_preferences` en `platform_auth.users` o tabla propia.

## 13. Deliverability (SPF / DKIM / DMARC)

- ✅ Resend gestiona la firma DKIM por defecto en el dominio `resend.dev` cuando no hay branded domain configurado.
- ✅ Los `dns_records` de los branded domains incluyen SPF (TXT), DKIM (CNAME), DMARC (TXT) como registros que el tenant debe publicar.
- 🔧 No existe verificación automática de que los DNS records están publicados correctamente antes del primer envío.
- ❌ Sin BIMI (Brand Indicators for Message Identification) — extensión de DMARC para logo en cliente de correo.
- ❌ Sin monitorización de reputación de dominio / IP (SpamAssassin score, Sender Score).
- ❌ Sin cabeceras `List-Unsubscribe` y `List-Unsubscribe-Post` (obligatorias para Gmail bulk senders a partir de Feb 2024 cuando se supera 1,000 emails/día).

## 14. Tracking (apertura y clic)

- ❌ Sin tracking pixel de apertura (Resend lo soporta, pero el módulo no lo habilita).
- ❌ Sin reescritura de URLs para tracking de clics (click tracking).
- ❌ Sin almacenamiento de eventos de tracking (`email.opened`, `email.clicked`, `email.bounced`, `email.complained`) en la tabla `send_log`.
- ❌ Sin webhook de Resend configurado (`POST /v1/notifications/webhooks/resend`) para recibir estos eventos.
- ❌ Sin dashboard de métricas de entregabilidad (tasa de apertura, clic, rebote por plantilla o periodo).

## 15. Programación y envíos diferidos

- ✅ Modo digest como mecanismo de agrupación temporal (no programación precisa).
- ❌ Sin envío programado a una hora concreta (`scheduled_at`) — la lógica de timing está en el scheduler que publica el evento, no en el módulo de notificaciones.
- ❌ Sin cancelación de un envío programado pendiente (p.ej. cancelar el recordatorio de una cita si esta se cancela antes de que se dispare el cron).
- ❌ Sin `send_after` en el payload del evento para que el módulo retenga el envío hasta una hora futura.

## 16. Registro de envíos y auditoría (send_log)

- ✅ Tabla `send_log(app_id, tenant_id, user_id, channel, template, recipient, status, error, sent_at)` escrita por los tres senders (best-effort, nunca tumba el envío); consulta staff vía `GET /v1/notifications/admin/send-log` con filtros channel/template/status.
- ❌ Sin persistencia de registro de envío en DB para trazabilidad, auditoría o soporte al usuario.
- ❌ Sin deduplicación basada en `send_log` (idempotency check: "¿ya envié este evento a este usuario?").
- ❌ Sin `idempotency_key` en el payload del evento para evitar dobles envíos en caso de reentrega de Redis Pub/Sub.
- ❌ Sin endpoint admin para consultar histórico de envíos filtrado por `(tenant_id, user_id, channel, template, periodo)`.
- ❌ Sin retention/purge automática del `send_log` (podría crecer indefinidamente; ningún scheduler job lo limpia).

## 17. Segmentación, comunicaciones de marketing y campañas

- ❌ Sin módulo de campañas (envío masivo a segmentos de usuarios).
- ❌ Sin distinción entre notificaciones transaccionales (requeridas por el servicio) y marketing (opcionales, consentimiento explícito).
- ❌ Sin integración con listas de contactos externas (Mailchimp, Brevo, Customer.io).
- ❌ Sin A/B testing de asunto o cuerpo de plantilla.
- ❌ Sin programación de campañas recurrentes o puntuales.

## 18. In-app notifications (centro de notificaciones)

- ❌ Sin canal in-app: no existe tabla `notifications` de destino en plataforma (diferente de `chat` que es mensajería).
- ❌ Sin API `GET /v1/notifications/inbox` para que el portal muestre un contador de no-leídas.
- ❌ Sin marca `read_at` / `dismissed_at` por notificación.
- ❌ Sin badge counter en tiempo real vía WebSocket (REUSE platform/chat gateway podría extenderse).

## 19. Canales no implementados

- ❌ **WhatsApp** — Business API (Meta Cloud o proveedores como Twilio / MessageBird). Alta demanda para notificaciones en España/LATAM.
- ❌ **Slack / Teams webhook** — notificaciones internas a canales de operaciones (staff ops, ventas, soporte).
- ❌ **Webhooks salientes** — notificar a sistemas externos vía POST cuando ocurre un evento (útil para integraciones custom de tenant).
- ❌ **Voz (IVR / llamada telefónica)** — casos de uso de alta urgencia (emergencias médicas, recordatorios críticos).
- ❌ **Notificaciones de browser sin app móvil** (Web Push independiente de FCM) — aunque FCM v1 cubre web, requiere que el cliente registre el SW.

## 20. GDPR, privacidad y compliance (España/UE)

- 🔧 Sin gestión de consentimiento explícito para comunicaciones de marketing (LOPDGDD / RGPD).
- ❌ Sin registro de consentimiento (`consent_basis`, `consent_timestamp`, `consent_text_version`) ligado al envío.
- ❌ Sin derecho de acceso: no hay endpoint para que un usuario vea todas las notificaciones que se le han enviado.
- ❌ Sin derecho de supresión: borrar un usuario no elimina sus tokens FCM ni sus entradas en `send_log` (aún no escrito, pero relevante para el futuro).
- ❌ Sin retención automática del `send_log` (purge de entradas más antiguas de N días vía scheduler).
- ❌ Sin anonimización de destinatarios en el log histórico.
- ❌ Sin datos de consentimiento para email de marketing propagados al proveedor (Resend acepta `headers` custom para cumplimiento).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Escribir `send_log` en cada envío** — coste muy bajo (añadir un INSERT tras cada `send()`); habilita auditoría, idempotencia, y soporte al usuario de inmediato.
2. **Idempotencia en el consumer** — `idempotency_key` en el evento + check en `send_log` antes de enviar; evita dobles envíos en reentregas de Redis Pub/Sub.
3. **Preferencias de usuario + unsubscribe link** — tabla `notification_preferences` + enlace en footer de emails; obligatorio para GDPR / CAN-SPAM en cuanto haya comunicaciones no puramente transaccionales.
4. **Reintentos con backoff** — cola de reintentos en Redis para emails/SMS fallidos (3 intentos, backoff exponencial); fundamental para resiliencia ante caídas temporales de Resend/Twilio.
5. **Webhook de Resend (`email.bounced` / `email.complained`)** + supresión de destinatarios rebotados — crítico para mantener reputación de dominio en producción.
6. **`List-Unsubscribe` headers** — obligatorio para Gmail/Yahoo cuando se supera el umbral de 1,000 emails/día; añadir una cabecera al `send()` es trivial.
7. **Conectar branded domain al sender** — que el email service consulte `tenant_email_domains` para el `from` address cuando el tenant tiene un dominio verificado (completa el flujo ya implementado).
8. **Notificaciones in-app (inbox)** — tabla `notifications` + `GET /v1/notifications/inbox` + mark-as-read; desbloquea badge en el portal sin necesidad de push.
9. **Webhook saliente (Twilio StatusCallback)** — confirmar entrega de SMS o detectar fallos/opt-outs; necesario para cumplir TCPA (US) y directivas europeas de comunicaciones electrónicas.
10. **WhatsApp Business API** — canal de mayor apertura en España/LATAM; reutiliza la arquitectura de SMS (plantilla + config en DB + proveedor swap).
