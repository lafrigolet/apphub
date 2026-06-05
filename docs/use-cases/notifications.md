# Casos de uso — `platform/notifications` (platform-core)

> Dominio: notificaciones multicanal (email, SMS, push web/móvil) disparadas por
> eventos de `platform.events`; plantillas editables en runtime con i18n; dominios
> de envío por tenant verificados en Resend; rate-limiting, digest diario, registro
> de envíos; **recepción de email entrante (Resend Inbound)** con enrutado a módulos
> de dominio vía eventos (§23–§29). Proveedores activos: **Resend** (email),
> **Twilio** (SMS), **FCM HTTP v1** (push Android / iOS / web).

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
digest_mode); APNs reservado (slot, sin implementar). `send_log` escrito por los tres
senders con purge manual por retención; idempotencia del consumer (Redis `SET NX`);
**email entrante (Resend Inbound)**: webhook `email.received` con verificación
Svix HMAC sobre raw body, fetch vía Receiving API, adjuntos → S3 con política y
dedup, enrutado por reply-tokens/reglas a eventos de dominio, consumidores en
inquiries (hilo) y leads (lead), bandeja admin + GDPR + purga vía scheduler
(migración 0026, §23–§29); preferencias/opt-out por usuario (`notification_preferences` + `unsubscribe_tokens`,
migración 0023) con gate por categoría/canal y endpoint público de unsubscribe; lista
de supresión (`suppressions`) + `delivery_status` alimentados por los webhooks de
proveedor (`POST /webhooks/resend` bounce/complaint, `POST /webhooks/twilio`
StatusCallback + opt-out STOP), migración 0024.

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
- ✅ Bounce/complaint handling: `POST /v1/notifications/webhooks/resend` consume los eventos de Resend (`email.bounced`, `email.complained`, `email.delivered`, …); guardado por shared secret `x-webhook-secret` (config `resend_webhook_secret`); siempre responde 200 para no provocar retries del proveedor (migración 0024 + `webhook.service.js`).
- ✅ Supresión de bounces/complaints: el webhook inserta el destinatario rebotado/quejado en `platform_notifications.suppressions`; el email sender consulta la lista y registra `status='skipped'` en `send_log` en lugar de reenviar.

## 2. Canal SMS — envío y proveedor

- ✅ Envío SMS vía Twilio REST API (`Messages.json`) con autenticación API Key + Secret (recomendada sobre Account SID + Auth Token).
- ✅ Config Twilio dinámica en DB (`twilio_account_sid`, `twilio_api_key_sid`, `twilio_api_key_secret` cifrado, `twilio_messaging_service_sid`, `twilio_default_sender`), caché 30s.
- ✅ Dev-stub: cuando faltan credenciales se loguea el SMS en lugar de enviarse.
- ✅ Endpoint admin `POST /sms/test` para smoke-test de la configuración Twilio.
- ✅ SMS implementado para: recordatorio de cita (T-24h / T-2h), cita confirmada, cancelada, reprogramada; recordatorio de reserva, reserva cancelada; promoción de lista de espera (`waitlist.notified` restaurante + `booking.waitlist.notified` citas — destinatarios anónimos, teléfono únicamente).
- 🔧 Sin reintentos ni dead-letter para SMS fallidos.
- 🔧 Sin validación de número E.164 antes del envío (Twilio rechaza formatos inválidos sin feedback útil para el usuario).
- ✅ Rastreo de estado de entrega: `POST /v1/notifications/webhooks/twilio` consume el StatusCallback (form-encoded) y sella `delivery_status` (`delivered`/`failed`/`undelivered`/`sent`/…) en la fila `send_log` correlada por `MessageSid` (migración 0024 + `webhook.service.js`). Firma `X-Twilio-Signature` (HMAC-SHA1) verificada cuando hay `twilio_api_key_secret` configurado; dev-stub en su ausencia.
- ✅ Opt-out / STOP por número de teléfono: el webhook detecta `ErrorCode 21610` (recipient unsubscribed) y suprime el número en `suppressions` con `reason='opt_out'`; el SMS sender lo consulta y registra `status='skipped'`.
- ❌ Sin soporte MMS.
- ❌ Sin failover a canal alternativo (email) cuando SMS falla.

## 3. Canal push — FCM HTTP v1

- ✅ Push vía FCM HTTP v1 para Android, iOS (vía APNs auth key configurada en Firebase) y web (Web Push).
- ✅ Auth OAuth2 mediante JWT de cuenta de servicio GCP firmado RS256; access token cacheado con refresh 1 min antes del vencimiento.
- ✅ Config FCM dinámica en DB (`fcm_project_id`, `fcm_service_account_json` cifrado), caché 30s.
- ✅ Envío a todos los tokens registrados del usuario (multi-device); limpieza automática de tokens muertos (FCM UNREGISTERED / INVALID_ARGUMENT → `pushRepo.deleteByToken`).
- ✅ `data` payload adicional por mensaje (todos los valores serializados como `string` según requisito FCM v1).
- ✅ Push implementado para: recordatorio de cita, cita confirmada, recordatorio de reserva; nueva notificación de chat, mención en chat, asignación de ticket soporte, SLA de soporte incumplido; respuesta a reseña (`review.replied`), reclamación abierta/retirada (`dispute.opened`/`dispute.withdrawn`), bono congelado/reactivado/reembolsado (`package.frozen`/`unfrozen`/`refunded`).
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
| `review.replied` | push | reviews |
| `dispute.opened` | push | disputes |
| `dispute.withdrawn` | push | disputes |
| `package.frozen` | push | packages |
| `package.unfrozen` | push | packages |
| `package.refunded` | push | packages |
| `waitlist.notified` | SMS | reservations |
| `booking.waitlist.notified` | SMS | bookings |
| `notifications.digest.flush` | (flush interno) | scheduler |

Eventos cableados en esta ola (✅ con wiring):
- ✅ `review.replied` (reviews) → push al buyer (`buyerUserId`). Reviews no porta email (lo posee auth), así que el canal resoluble es push.
- ✅ `dispute.opened` → push de confirmación al buyer (`buyerUserId`).
- ✅ `dispute.withdrawn` → push de confirmación al buyer (`withdrawnByUserId`).
- ✅ `package.frozen` / `package.unfrozen` / `package.refunded` → push al cliente (`clientUserId`); `unfrozen` incluye `daysAdded`, `refunded` incluye `refundCents`+`currency`.
- ✅ `waitlist.notified` (reservations) → SMS al `guestPhone` (entrada de lista de espera anónima: nombre + teléfono, sin cuenta).
- ✅ `booking.waitlist.notified` (bookings) → SMS al `clientPhone` (mismo patrón anónimo).

Plantillas editables sembradas para los anteriores en la migración
`0025_waitlist_dispute_review_package_templates.sql` (push es/en para review/dispute/package; SMS es/en para los dos waitlist). Fallbacks hardcoded en
`push.service.js` / `sms.service.js` garantizan entrega aunque se desactive la fila.

Eventos **NO subscritos** aún (descartados por falta de destinatario claro en el payload o por ser puramente internos/operativos):
- ❌ `lead.created` (leads) — auto-respuesta YA cableada como `lead.acknowledged`; la notificación *interna a staff* sigue sin wiring (sin destinatario fijo definido). Eventos `lead.status_changed` / `lead.assigned` son CRM-internos: NO se notifica al prospecto.
- ❌ `dispute.resolved`, `dispute.message` — el payload no porta un `userId` de destinatario (solo `senderRole` / importe), así que no hay a quién notificar sin cruzar esquemas.
- ❌ `payment.succeeded` / `payment.failed` / `payment.refunded` (payments) — son eventos de infraestructura; el payload solo lleva `transactionId`/importe, sin email ni userId. Las notificaciones de cara al usuario salen de `order.*` / `donation.*`.
- ❌ `shipping.shipment.created` — payload solo con `shipmentId`/`orderId`/`estimatedDeliveryDate`, sin email/userId del comprador. La notificación de envío al comprador ya existe vía `order.shipped`.
- ❌ `delivery.delivered` y demás `delivery.*` — payload con `deliveryId`/`orderId`/`carrier`/GPS, sin email/userId del cliente.
- ❌ `telehealth.room.created` / `telehealth.room.rescheduled` — payload con `roomId`/`bookingId`/`joinUrl`, sin destinatario; resolverlo exigiría cruzar a `platform_bookings`.
- ❌ `inventory.low_stock`, `inventory.out_of_stock` — sin destinatario staff/vendor claro en el payload.
- ❌ `chat.reaction.created`, `chat.message.pinned`, `chat.dm_request` — chat events sin notificaciones.
- ❌ `inquiry.csat_submitted` — ignorable (telemetría interna).
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

- ✅ Tabla de preferencias de usuario (`platform_notifications.notification_preferences`, migración 0023) con RLS por `(app_id, tenant_id)`. Modelo opt-out: la ausencia de fila = enviar; una fila `muted=true` por `(category, channel)` silencia ese canal (o `channel='*'` toda la categoría).
- ✅ Opt-out por categoría: el consumer mapea `event.type` → categoría (`bookings`/`orders`/`donations`/`payouts`/`disputes`/`chat`/`marketing`) y consulta `isMuted` en el gate `gated()` antes del rate-limit. Categorías transaccionales (`auth`) son no silenciables por diseño.
- ✅ One-click unsubscribe: `POST /v1/notifications/unsubscribe` **público** (sin auth) basado en token estable por usuario (tabla `unsubscribe_tokens`); silencia la categoría indicada (default `marketing`). Endpoint `GET /v1/notifications/preferences/unsubscribe-token` para obtener el token desde el portal/footer.
- ✅ Passthrough de `headers` en el email sender (habilita `List-Unsubscribe` / `List-Unsubscribe-Post` RFC 8058 desde el caller).
- ✅ Endpoint usuario `GET/PATCH /v1/notifications/preferences` para auto-gestión desde el portal (lista categorías + prefs muteadas; mute/unmute por categoría/canal).
- ✅ Lista de supresión (suppression list) propia: tabla `platform_notifications.suppressions` (migración 0024) poblada por los webhooks de proveedor (Resend bounce/complaint, Twilio opt-out) y por staff; CRUD admin `GET/POST/DELETE /v1/notifications/admin/suppressions`. No RLS (hecho de deliverability sobre la dirección, sin contexto de tenant); lookups por `(channel, recipient)` normalizado. Los tres senders la consultan y registran `status='skipped'`.
- 🔧 `List-Unsubscribe` headers: el passthrough existe pero el sender aún no inyecta la URL+token automáticamente en cada email a usuario (requiere threading de userId/tenant a los helpers de email — cross-cutting con TODO-resend).

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
- 🔧 Almacenamiento parcial de eventos de entrega: `email.delivered`/`bounced`/`complained`/`delivery_delayed` se sellan como `send_log.delivery_status` (columna añadida en migración 0024); `email.opened`/`email.clicked` aún no se persisten (tracking de open/click deshabilitado).
- ✅ Webhook de Resend configurado (`POST /v1/notifications/webhooks/resend`) — recibe los eventos, suprime bounces/complaints y sella `delivery_status`. Verificación Svix HMAC completa sobre raw body cuando `resend_webhook_secret` es un `whsec_…`; shared secret `x-webhook-secret` como modo legacy (ver §22, cerrado).
- ❌ Sin dashboard de métricas de entregabilidad (tasa de apertura, clic, rebote por plantilla o periodo).

## 15. Programación y envíos diferidos

- ✅ Modo digest como mecanismo de agrupación temporal (no programación precisa).
- ❌ Sin envío programado a una hora concreta (`scheduled_at`) — la lógica de timing está en el scheduler que publica el evento, no en el módulo de notificaciones.
- ❌ Sin cancelación de un envío programado pendiente (p.ej. cancelar el recordatorio de una cita si esta se cancela antes de que se dispare el cron).
- ❌ Sin `send_after` en el payload del evento para que el módulo retenga el envío hasta una hora futura.

## 16. Registro de envíos y auditoría (send_log)

- ✅ Tabla `send_log(app_id, tenant_id, user_id, channel, template, recipient, status, error, sent_at)` escrita por los tres senders (best-effort, nunca tumba el envío); consulta staff vía `GET /v1/notifications/admin/send-log` con filtros channel/template/status.
- ❌ Sin persistencia de registro de envío en DB para trazabilidad, auditoría o soporte al usuario.
- ✅ Deduplicación / idempotencia en el consumer: `idempotency.service.js` reclama cada evento con `SET key NX EX 24h` en Redis (`ndedup:`) antes de despachar; reentregas (retry del productor, replay de reconexión, re-publish manual) se descartan. `notifications.digest.flush` está exento (idempotente por diseño). Fail-open ante caídas de Redis (preferimos doble envío a silencio).
- ✅ `idempotency_key` / `id` del evento usados como clave de dedup cuando el productor los incluye; fallback a hash sha256 estable de `(type + payload)` cuando no.
- ✅ `delivery_status` por intento: columna añadida en migración 0024, sellada asíncronamente por los webhooks de proveedor (Resend / Twilio) correlando por `provider_message_id`.
- ❌ Sin endpoint admin para consultar histórico de envíos filtrado por `(tenant_id, user_id, channel, template, periodo)`.
- 🔧 Retention/purge del `send_log`: existe el endpoint admin manual `DELETE /v1/notifications/admin/send-log?older_than_days=N` (`sendLogRepo.purgeOlderThan`, índice en `sent_at` para coste bajo). Pendiente el scheduler job que lo invoque periódicamente (cross-cutting, ver §22).

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
- 🔧 Retención del `send_log`: purge manual disponible (`DELETE /admin/send-log?older_than_days=N`); el job de scheduler que lo automatice queda pendiente (cross-cutting, ver §22).
- ❌ Sin anonimización de destinatarios en el log histórico.
- ❌ Sin datos de consentimiento para email de marketing propagados al proveedor (Resend acepta `headers` custom para cumplimiento).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ~~**Escribir `send_log` en cada envío**~~ — ✅ HECHO (migración 0021; los 3 senders escriben sent/failed/skipped + `GET /admin/send-log`).
2. ~~**Idempotencia en el consumer**~~ — ✅ HECHO (`idempotency.service.js`: `SET NX` Redis con TTL 24h por `idempotencyKey`/`id` o hash de `(type+payload)`; digest.flush exento; fail-open).
3. ~~**Preferencias de usuario + unsubscribe link**~~ — ✅ HECHO (tabla `notification_preferences` + `unsubscribe_tokens`, migración 0023; gate `isMuted` por categoría/canal en el consumer; `GET/PATCH /v1/notifications/preferences`; `POST /v1/notifications/unsubscribe` público; passthrough de `headers` para `List-Unsubscribe`). Pendiente menor: inyección automática del header con token en cada email (cross-cutting TODO-resend).
4. **Reintentos con backoff** — cola de reintentos en Redis para emails/SMS fallidos (3 intentos, backoff exponencial); fundamental para resiliencia ante caídas temporales de Resend/Twilio.
5. ~~**Webhook de Resend (`email.bounced` / `email.complained`)** + supresión de destinatarios rebotados~~ — ✅ HECHO (migración 0024 `suppressions` + `delivery_status`; `POST /v1/notifications/webhooks/resend`; bounce/complaint → `suppress()`; los 3 senders consultan `isSuppressed` y registran `skipped`; CRUD admin de supresiones). La verificación Svix HMAC completa llegó con la ola inbound (§22 cerrado).
6. **`List-Unsubscribe` headers** — obligatorio para Gmail/Yahoo cuando se supera el umbral de 1,000 emails/día; añadir una cabecera al `send()` es trivial.
7. **Conectar branded domain al sender** — que el email service consulte `tenant_email_domains` para el `from` address cuando el tenant tiene un dominio verificado (completa el flujo ya implementado).
8. **Notificaciones in-app (inbox)** — tabla `notifications` + `GET /v1/notifications/inbox` + mark-as-read; desbloquea badge en el portal sin necesidad de push.
9. ~~**Webhook saliente (Twilio StatusCallback)**~~ — ✅ HECHO (`POST /v1/notifications/webhooks/twilio`; sella `delivery_status` por `MessageSid`; `ErrorCode 21610` → supresión opt-out; firma `X-Twilio-Signature` verificada cuando hay secret).
10. **WhatsApp Business API** — canal de mayor apertura en España/LATAM; reutiliza la arquitectura de SMS (plantilla + config en DB + proveedor swap).
11. ~~**Pipeline mínimo de email entrante (§24)**~~ — ✅ HECHO (migración 0026 + `inbound.service.js`: webhook `email.received` idempotente, fetch vía Receiving API, FSM completa, evento `email.inbound.received`; Svix §22 implementado como prerrequisito).
12. ~~**Adjuntos entrantes → S3 (§25)**~~ — ✅ HECHO (descarga inmediata, política de tipos/tamaño, dedup sha256, bytes vía `@apphub/platform-sdk/storage` bajo `inbound/<emailId>/…` — SDK como canal permitido, sin tocar el esquema de storage).
13. ~~**Primer consumidor: respuestas a inquiries (§26)**~~ — ✅ HECHO (reply token en el thank-you → `inquiry.reply.received` → activity `email_reply` en el timeline + alerta `inquiry.reply_alert` al inbox admin con Reply-To al usuario).

---

## 22. Cross-cutting pendiente (heredado del trabajo de webhooks/supresiones)

- ~~**Verificación Svix HMAC del webhook Resend**~~ — ✅ HECHO (ola inbound): el módulo captura el raw body con un content-type parser encapsulado a su contexto de webhooks (patrón splitpay, sin tocar `platform-core`); cuando `resend_webhook_secret` empieza por `whsec_` se verifica la firma Svix completa (svix-id/timestamp/signature, HMAC-SHA256, tolerancia 5 min, multi-firma por rotación); un valor legacy mantiene el shared secret `x-webhook-secret`.
- ~~**Job de scheduler para retention del `send_log`**~~ — ✅ HECHO: `notification-send-log-purge` (diario 05:00, `NOTIFICATIONS_SEND_LOG_RETENTION_DAYS` default 90) corre en `platform-scheduler` con DELETE directo. El inbound añadió su gemelo `notifications-inbound-purge` (05:15, vía evento `notifications.inbound.purge_due` porque la purga inbound también borra objetos S3 y eso vive en el módulo).
- **Inyección automática de `List-Unsubscribe` + token** en cada email a usuario — el passthrough de `headers` y el token estable (`unsubscribe_tokens`) ya existen; falta threading de `userId`/`tenantId` a los helpers de email para mintar y adjuntar la URL automáticamente (cross-cutting con TODO-resend).

---

# Email entrante (Resend Inbound)

> La plataforma ya **recibe** correo además de enviarlo: MX apuntando a Resend,
> webhook `email.received` con **solo metadatos** (from/to/subject + metadatos
> de adjuntos), recuperación del contenido bajo demanda vía Receiving API
> (`GET /emails/receiving/{id}`) y adjuntos por `download_url`. Los correos
> quedan almacenados en Resend aunque el webhook caiga (replay vía reprocess).
> Decisión arquitectónica: **EXTEND de este módulo** (no módulo nuevo) — la API
> key Resend cifrada, `tenant_email_domains`, el endpoint webhook y las
> supresiones ya viven aquí, y las fronteras de módulo impiden compartirlos con
> un módulo nuevo. El envío sigue por Resend sin cambios: la recepción solo
> añade registros MX (grey-cloud en Cloudflare — el proxy no cubre SMTP);
> SPF/DKIM/DMARC de envío intactos. Implementación: migración 0026 +
> `inbound.service.js` / `inbound-attachments.service.js` /
> `reply-address.service.js` + `inbound-admin.routes.js`.
>
> Límites de tamaño de mensaje/adjunto y política de retención en Resend **no
> documentados públicamente** — confirmar con su soporte antes de fijar garantías.

## 23. Email entrante — aprovisionamiento y dominios de recepción

- 🔧 Recepción vía dominio gestionado por Resend (`<id>.resend.app`) para dev/staging — usable configurando `inbound_domain`; el alta del dominio en Resend se hace en su dashboard (sin API de aprovisionamiento en plataforma).
- 🔧 Dominio de recepción propio con MX — subdominio dedicado recomendado (p. ej. `reply.hulkstein.com`), registro grey-cloud (DNS only) en Cloudflare; el DNS se publica manualmente, la plataforma solo consume.
- ❌ Dominios de recepción por tenant: extensión de `tenant_email_domains` (hoy solo envío) con registros MX en `dns_records` + verificación propia del inbound.
- ✅ Direcciones funcionales (`soporte@`, `leads@`, `facturas@`) y catch-all por dominio vía reglas `inbound_routes` (`match_type` exact/domain, CRUD staff).
- ✅ Plus-addressing (`reply+<token>@…`) como espacio de direcciones de correlación — tokens hex (case-insensitive) en `inbound_reply_tokens`, TTL 90 días.
- ✅ Config admin del módulo: 9 claves `inbound_*` en `/admin/config` (`enabled`, `domain`, `fallback_action`, `blocked/allowed_senders`, `attachment_max_bytes`, `attachment_allowed_types`, `rate_limit_per_sender_per_hour`, `retention_days`), caché 30s con invalidación al PATCH.
- ✅ Dev-stub: `POST /admin/inbound/inject` corre el pipeline completo sobre un correo sintético (texto/html/headers/adjuntos base64 inline) sin pasar por Resend.

## 24. Email entrante — ingestión (webhook + fetch de contenido)

- ✅ `email.received` manejado en el webhook existente (`POST /webhooks/resend`); la dirección outbound (bounces/complaints) no se ve afectada.
- ✅ Verificación **Svix HMAC** sobre el raw body cuando `resend_webhook_secret` es un `whsec_…` (raw body capturado con content-type parser encapsulado al contexto de webhooks — patrón splitpay); valor legacy = shared secret `x-webhook-secret`; sin secret = dev-stub.
- ✅ Fetch del contenido completo (text/html/headers/message_id) vía Receiving API con la API key del módulo; stub sin key (sigue con los metadatos del webhook).
- ✅ Persistencia en `platform_notifications.inbound_emails` (`provider_email_id` UNIQUE, FSM `received → fetched → routed | unrouted | archived | quarantined | failed`).
- ✅ Idempotencia del webhook: redelivery de un correo ya procesado = no-op (`ON CONFLICT` + check de estado).
- 🔧 Procesamiento dentro del request del webhook (no encolado): los errores se absorben (siempre 200) y el fetch añade latencia al request — suficiente para el volumen actual; cola dedicada si crece.
- ✅ Replay manual: `POST /admin/inbound/:id/reprocess` resetea la fila y re-corre el pipeline (re-fetch desde Resend incluido).
- ✅ Dead-letter: fallos marcan `failed` con `attempts`++ y `error`; visibles en la bandeja y re-procesables.

## 25. Email entrante — adjuntos

- ✅ Adjuntos vía el retrieve de la Receiving API (+ fallback al listado de attachments para obtener `download_url`).
- ✅ Descarga en ingestión (no lazy — el `download_url` caduca) y persistencia en el bucket S3 compartido vía `@apphub/platform-sdk/storage` bajo `inbound/<emailId>/…`; metadatos en `inbound_attachments`, nunca bytes en Postgres ni filas en `platform_storage` (el SDK es el canal permitido).
- ✅ Política configurable: allowlist de content-type (prefijos) y tamaño máximo por adjunto (`inbound_attachment_*`); fuera de política → fila `skipped` con motivo.
- ❌ Escaneo antivirus/malware antes de exponer el adjunto (estado `quarantined` reservado a gates de remitente hoy).
- ✅ Deduplicación por sha256: bytes idénticos reutilizan el `object_key` ya almacenado (firmas/logos repetidos en hilos largos).
- ❌ Extracción de imágenes inline (`cid:`) y reescritura de referencias en `body_html` hacia keys de storage.
- ✅ Aislamiento de fallos: un adjunto roto se registra `failed` y no pierde el mensaje ni el resto de adjuntos.

## 26. Email entrante — enrutado a módulos de dominio

- ✅ Tabla `inbound_routes(match_type, pattern, target_event, app_id, tenant_id, enabled)` con CRUD staff (`/admin/inbound-routes`); precedencia: dirección exacta > catch-all de dominio.
- ✅ Evento genérico `email.inbound.received` publicado siempre que el correo se procesa (incl. auto-replies, flag `autoReply`); notifications **nunca** escribe en esquemas ajenos.
- Consumidores:
  - ✅ **Respuestas a inquiries** — el thank-you lleva Reply-To `reply+<token>@…`; la respuesta del usuario se reinyecta al timeline como activity `email_reply` (consumer en `platform/inquiries`, migración 0003) y notifications alerta al inbox del admin (`inquiry.reply_alert`, Reply-To = usuario para continuar el hilo). Sin inbound configurado se mantiene el comportamiento V1.
  - ✅ **`leads@` → alta de lead** — consumer en `platform/leads` para `lead.email.received` (`source: 'email-inbound'`, asunto+texto como mensaje); cierra el ❌ "captura desde email entrante" de [leads.md §1](leads.md). Sin dedup de remitente (igual que el form; el rate-limit por remitente acota el abuso).
  - ❌ **`soporte@` → ticket de chat soporte** — bloqueado: crear la conversación exige un `userId` y la resolución usuario-por-email pertenece a `platform/auth` (frontera de módulo); requiere un endpoint interno de lookup en auth. La regla puede apuntar ya a `chat.support.email.received` para cuando exista el consumer.
  - ❌ **Respuesta por email a messaging buyer ↔ vendor** — bloqueado aguas arriba: `message.created` no tiene canal email saliente (el payload no porta emails — los posee auth), así que no hay correo del que responder.
  - ✅ **Buzones operativos** (`facturas@`, DMARC `rua@`) — archivado sin evento de dominio vía fallback o regla domain sin consumer.
- 🔧 Fallback configurable cuando ninguna regla matchea: `archive` (status `unrouted`, visible en bandeja) o `discard` (status `archived`); sin reenvío automático a buzón staff.
- ❌ Forward a dirección externa (capacidad nativa de Resend) como acción de ruta.

## 27. Email entrante — correlación y threading

- ✅ Correlación vía plus-addressing: `mintReplyAddress({ targetEvent, context, appId, tenantId })` acuña `reply+<token>@<inbound_domain>` (o null si inbound está apagado — los callers conservan su Reply-To anterior); el token resuelve a evento + contexto y stampa el tenant en el enrutado.
- 🔧 Correlación por `In-Reply-To`/`References`: los msg-id se cotejan (enteros y sin dominio) contra `send_log.provider_message_id` (best-effort — el Message-ID SMTP real del envío no se persiste); el hit viaja en `payload.correlation`.
- ✅ Limpieza de quoted text y firmas (`extractReply`: marcadores Gmail es/en/fr, Outlook, separador RFC 3676, líneas `>`); el evento lleva `text` (limpio) + `rawText`.
- ✅ Detección de auto-respuestas (`Auto-Submitted`, `X-Autoreply`, `Precedence`, `List-Id/Unsubscribe`, remitentes daemon/no-reply, asuntos OOO) → archivado sin eventos de dominio.
- ❌ Agrupación de correos del mismo thread bajo una conversación (vista hilo en consola).

## 28. Email entrante — seguridad y anti-abuso

- ✅ Verificación de firma del webhook: Svix HMAC completo (raw body, tolerancia 5 min, multi-firma) cuando el secret es `whsec_…`; shared secret legacy en caso contrario; dev-stub sin secret. (Cerrado el cross-cutting §22.)
- 🔧 Veredicto de autenticación del remitente: el header `Authentication-Results` se persiste en `inbound_emails.auth_results` cuando Resend lo expone; sin parsing del veredicto SPF/DKIM/DMARC ni gate sobre él.
- ❌ Anti-spam con scoring/heurísticas propias (el estado `quarantined` existe; hoy solo lo alimentan los gates de remitente).
- 🔧 Blocklist/allowlist de remitentes y dominios: config CSV global (`inbound_blocked_senders` / `inbound_allowed_senders`); sin granularidad por tenant.
- ✅ Protección contra mail loops: auto-replies nunca disparan eventos de dominio + cuarentena `self_loop` cuando el remitente es nuestro propio `sender_email`.
- ✅ Rate-limit de ingestión por remitente (Redis, default 30/h, configurable; fail-open ante caída de Redis) → cuarentena `rate_limited`.
- ❌ Límite máximo de mensaje verificado contra Resend y documentado (no público — pendiente de su soporte).

## 29. Email entrante — GDPR, retención y observabilidad

- ✅ Retención configurable: job `notifications-inbound-purge` (05:15) publica `notifications.inbound.purge_due` (el scheduler no toca S3 — misma filosofía que storage-retention-purge); el consumer del módulo borra filas (cascade a adjuntos), objetos S3 y reply tokens expirados. Precedencia: config `inbound_retention_days` → env `NOTIFICATIONS_INBOUND_RETENTION_DAYS` (365).
- ❌ Borrado del correo en Resend tras ingestión correcta (minimización de copias en el proveedor).
- ✅ Derecho de supresión GDPR: `DELETE /admin/inbound/by-sender?email=` borra todos los correos de un remitente + objetos S3 asociados.
- 🔧 Bandeja staff: API completa (`GET /admin/inbound` con filtros status/from/to, detalle con URLs de descarga firmadas, reprocess); sin vista en console todavía.
- 🔧 Auditoría de enrutado: cada fila lleva `route_id`/`routed_event`/`status`/`quarantine_reason`/`error`; sin tabla de log dedicada por decisión.
- ❌ Métricas agregadas (volumen por dirección/regla, tasa de fallo de fetch, latencia webhook→routed) en consola.
