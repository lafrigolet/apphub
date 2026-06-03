# Casos de uso — `platform/telehealth` (platform-appointments)

> Dominio: telesalud / videoconsulta — provisión de salas de vídeo y tokens de acceso para citas online. Módulo de `platform-appointments`, puerto 3300. Integra con `platform/bookings` (evento `booking.confirmed`), `platform/services` (detección de modalidad `telehealth`/`hybrid`) y expone una abstracción de proveedor de vídeo intercambiable (Daily.co, Twilio Video, Whereby, Jitsi, LiveKit).

## Estado actual (implementado)

Provisión automática de sala de vídeo al recibir el evento `booking.confirmed` cuando la modalidad del servicio es `telehealth` o `hybrid`; de-duplicación por `booking_id`; FSM de sala `created → active → ended / cancelled / expired`; ventana de acceso con gracia de 30 minutos post-fin (`expires_at`); generación de tokens de acceso con rol (`host`/`guest`) y caducidad ligada a la sala; registro de tokens en BD con campo `used_at`; creación manual de sala (`POST /v1/telehealth/rooms`); consulta de sala (`GET /v1/telehealth/rooms/:id`); cierre manual (`POST …/end`) y cancelación (`POST …/cancel`); publicación de eventos `telehealth.room.created` y `telehealth.room.ended`; configuración de proveedor de vídeo (Daily, Twilio, Whereby, Jitsi) con credenciales cifradas AES-256-GCM en BD; admin `GET/PATCH /v1/telehealth/admin/config`; RLS por `(app_id, tenant_id)` en tablas `rooms` y `tokens`; rol dedicado `svc_platform_telehealth`. El proveedor de vídeo activo es actualmente un stub — las integraciones reales con proveedores están preparadas estructuralmente pero no conectadas.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Provisión de sala de vídeo para una cita

- ✅ Auto-provisión al recibir `booking.confirmed` en Redis (`platform.events`) cuando `modality IN ('telehealth','hybrid')`.
- ✅ De-duplicación: si ya existe una sala para el `booking_id`, se omite la creación silenciosamente.
- ✅ Provisión manual vía `POST /v1/telehealth/rooms` (con `bookingId`, `startsAt`, `endsAt`).
- ✅ Ventana de acceso: la sala permanece activa 30 minutos tras el fin programado (`expires_at = ends_at + 30 min`).
- ✅ Campo `provider` en BD listo para múltiples proveedores; `external_room_id` y `join_url` opacos.
- ✅ `recording_enabled` configurable por sala (campo en BD, `FALSE` por defecto).
- ✅ `metadata JSONB` libre por sala para datos adicionales del proveedor o del flujo de la cita.
- 🔧 La integración real con proveedores externos (Daily.co, Twilio, Whereby, Jitsi) está estructurada pero solo existe la función stub — las llamadas a las APIs reales no están implementadas.
- 🔧 La sala no distingue modalidad `hybrid` en la provisión — se trata igual que `telehealth` (no hay lógica de fallback a presencial).
- ❌ Sala de grupo / multi-participante para citas familiares o grupales (solo hay un `booking_id`; no hay modelo de "varios clientes en la misma sala").
- ❌ Sala sin booking previo (videoconsulta ad-hoc, sin reserva en `platform/bookings`).
- ❌ Configuración de política de sala por tenant (max participantes, región de servidor, idioma de interfaz UI del proveedor).

## 2. Gestión del ciclo de vida de la sala (FSM)

- ✅ Estados: `created`, `active`, `ended`, `cancelled`, `expired` (columna `status` con CHECK).
- ✅ Transición a `ended` vía `POST /v1/telehealth/rooms/:id/end` (con publicación de evento `telehealth.room.ended`).
- ✅ Transición a `cancelled` vía `POST /v1/telehealth/rooms/:id/cancel`.
- ✅ Guardia en `issueToken`: rechaza emisión de token si la sala está en estado terminal (`ended`, `cancelled`, `expired`).
- 🔧 El estado `active` existe en el esquema pero no hay lógica que lo establezca automáticamente (p. ej. al entrar el primer participante o al llegar `starts_at`).
- 🔧 El estado `expired` está definido en el CHECK de BD pero no hay job de scheduler que transite salas caducadas (`expires_at < now()`) a `expired`.
- ❌ Transición automática `created → active` al inicio de la cita (REUSE `platform/scheduler`).
- ❌ Transición automática `active → ended` al finalizar la cita si nadie la cerró manualmente.
- ❌ Purga o archivo de salas terminadas antiguas (REUSE `platform/scheduler`).
- ❌ Historial de transiciones de estado de la sala con actor y motivo.
- ❌ Reapertura de sala cancelada o terminada por error.

## 3. Generación y gestión de tokens de acceso

- ✅ Emisión de token vía `POST /v1/telehealth/rooms/:id/tokens` con `participantRole` (`host`/`guest`).
- ✅ `userId` del token toma el del JWT si no se especifica explícitamente.
- ✅ Caducidad del token ligada a `expires_at` de la sala (no hay TTL independiente).
- ✅ Token generado como `crypto.randomBytes(32).toString('base64url')` (opaco, proveedor-stub).
- ✅ `used_at` almacenado en BD para marcar primer uso del token (`markTokenUsed` en repositorio).
- ✅ `listTokens` disponible en repositorio (no expuesto como ruta pública todavía).
- 🔧 El token real del proveedor (JWT de Daily/Twilio/etc.) no se genera — el token actual es un UUID opaco del stub.
- 🔧 `markTokenUsed` existe en el repositorio pero no hay ruta ni middleware que lo invoque al entrar el participante.
- ❌ Revocación individual de un token antes de su caducidad.
- ❌ Token de un solo uso (invalidación tras primer JOIN).
- ❌ Refresco de token (renovación cuando el token original expira pero la sesión sigue activa).
- ❌ Listado de tokens por sala accesible vía API (ruta no expuesta).
- ❌ Auditoría completa de quién accedió y cuándo (IP, dispositivo, duración de sesión).
- ❌ Token pre-compartido para participantes no registrados (enlace de invitado sin cuenta).

## 4. Control de acceso y ventana temporal

- ✅ Guardia básica: no se emite token si la sala está en estado terminal.
- ✅ `expires_at` en la sala limita implícitamente la validez de los tokens.
- ❌ Validación de que el llamante tiene relación con la cita (el `userId` del token debe ser el cliente o el profesional del `booking`).
- ❌ Control de "quién puede entrar y cuándo": ventana de acceso configurable antes del inicio (p. ej. el cliente puede entrar 5 minutos antes).
- ❌ Sala de espera virtual (waiting room): el profesional admite individualmente a los participantes.
- ❌ Cierre automático de sala cuando todos los participantes se desconectan (webhook del proveedor).
- ❌ Bloqueo de acceso post-cita (el cliente no puede volver a unirse una vez terminada).
- ❌ Número máximo de participantes por sala (política por tenant o por servicio).
- ❌ Admisión de observadores (estudiantes, supervisores) con rol de solo-lectura/sin micrófono.

## 5. Integración con `platform/bookings`

- ✅ Escucha `booking.confirmed` via Redis y auto-provisiona sala para modalidades `telehealth`/`hybrid`.
- ✅ Consulta `platform_services.services.modality` (cross-schema SELECT con GRANT explícito) para filtrar solo citas telehealth.
- ✅ `booking_id` almacenado en la sala para trazabilidad.
- ❌ Escucha `booking.cancelled` → cancelar sala automáticamente si estaba en `created`.
- ❌ Escucha `booking.rescheduled` → actualizar `starts_at`/`ends_at`/`expires_at` de la sala.
- ❌ Escucha `booking.no_show` → marcar sala como `expired` o añadir noción de no-presentación.
- ❌ Enlace inverso: la sala no actualiza al booking cuando termina (`telehealth.room.ended` publicado pero `platform/bookings` no lo consume).
- ❌ Soporte para `sub_tenant_id` en el auto-provisioning (hoy se pasa `null`).

## 6. Integración con proveedores de vídeo

- ✅ Abstracción de proveedor: `provider`, `external_room_id`, `join_url` son campos opacos.
- ✅ Settings cifrados para Daily.co (`daily_api_key`, `daily_domain`), Twilio Video (`twilio_account_sid`, `twilio_api_key_sid`, `twilio_api_key_secret`), Whereby (`whereby_api_key`, `whereby_subdomain`), Jitsi (`jitsi_app_id`, `jitsi_api_key_id`, `jitsi_private_key`).
- ✅ Selección del proveedor activo con `active_provider` (stub/daily/twilio/whereby/jitsi).
- 🔧 Las funciones reales `provisionRoom` y `provisionToken` por proveedor no están implementadas — solo existe `provisionRoomStub` y `provisionTokenStub`.
- ❌ Integración real con **Daily.co**: llamada a `POST https://api.daily.co/v1/rooms` + generación de meeting token JWT.
- ❌ Integración real con **Twilio Video**: `client.video.rooms.create()` + `AccessToken` con `VideoGrant`.
- ❌ Integración real con **Whereby**: `POST https://api.whereby.dev/v1/meetings` con duración y configuración.
- ❌ Integración real con **Jitsi** (as a Service / autohospedado): generación de JWT con `jaas-sdk`.
- ❌ Integración con **LiveKit** (open-source, auto-alojable en UE).
- ❌ Integración con **Zoom** Meetings API / Webinars.
- ❌ Webhooks del proveedor: eventos de sala (participante entró, salió, grabación completada, sala cerrada) recibidos y procesados.
- ❌ Failover automático entre proveedores.
- ❌ Selección de proveedor por tenant (tenant A usa Daily, tenant B usa Jitsi).

## 7. Notificación del enlace de acceso (REUSE notifications)

- ✅ Evento `telehealth.room.created` publicado en `platform.events` con `joinUrl`, `startsAt`, `endsAt`.
- ❌ Envío automático del enlace de acceso al cliente por email al crear la sala (REUSE `platform/notifications` consumiendo `telehealth.room.created`).
- ❌ Envío del enlace al profesional / host.
- ❌ Recordatorio previo a la cita con el enlace (T-24h, T-1h) (REUSE `platform/scheduler` + `platform/notifications`).
- ❌ Enlace de acceso en el email de confirmación de la cita (`booking.confirmed` ya se envía desde `platform/bookings`, sin enlace telehealth).
- ❌ Enlace de acceso en el área de cliente del portal (vista "Mis citas" con botón "Unirse").
- ❌ SMS / push con el enlace minutos antes del inicio.
- ❌ Reenvío del enlace bajo demanda (el cliente lo perdió).

## 8. Grabación de la sesión

- ✅ `recording_enabled BOOLEAN` en la tabla `rooms` (`FALSE` por defecto).
- ❌ Consentimiento de grabación: captura de aceptación explícita del paciente antes de grabar (RGPD Art. 9 — datos de salud).
- ❌ Texto de consentimiento configurable por tenant.
- ❌ Activación de grabación en el proveedor de vídeo (Daily SDK `record: true`, Twilio `RecordParticipantsOnConnect`…).
- ❌ Almacenamiento de la grabación (REUSE `platform/storage` — MinIO/S3): recibir URL de la grabación del webhook del proveedor y guardarla.
- ❌ Listado de grabaciones por sala/cita para el profesional.
- ❌ Descarga segura de la grabación (URL prefirmada de corta duración — REUSE `platform/storage`).
- ❌ Retención configurable y borrado automático de grabaciones (REUSE `platform/scheduler`).
- ❌ Acceso del paciente a su propia grabación (derecho RGPD).
- ❌ Marca de agua o cifrado de grabaciones.

## 9. Chat dentro de la sala y compartición de archivos

- ❌ Chat de texto en la sala de vídeo durante la consulta (REUSE `platform/chat` en modalidad soporte/directo, o canal propio del proveedor de vídeo).
- ❌ Compartición de archivos (imágenes, PDFs, resultados de análisis) dentro de la sesión (REUSE `platform/storage`).
- ❌ Compartición de pantalla (depende del proveedor; configuración por sala o por tenant).
- ❌ Pizarra virtual / whiteboard compartido.
- ❌ Historial del chat de la sesión accesible post-consulta.

## 10. Sala de espera virtual (waiting room)

- ❌ Modelo de sala de espera: el cliente entra a una "antesala" antes de ser admitido por el profesional.
- ❌ Notificación al profesional de que el cliente ha entrado en la sala de espera.
- ❌ Mensaje de bienvenida configurable por tenant mientras el cliente espera.
- ❌ Tiempo estimado de espera mostrado al cliente.
- ❌ Abandono de sala de espera: el cliente puede salir y recibir aviso cuando el profesional esté disponible.
- ❌ Admisión individual en citas de grupo (varios clientes en sala de espera).

## 11. Prueba previa de dispositivo (pre-call check)

- ❌ Endpoint o flujo de prueba de cámara, micrófono y altavoces antes de la cita.
- ❌ Test de conectividad de red (latencia, pérdida de paquetes) contra el servidor del proveedor.
- ❌ Detección automática de dispositivos disponibles y sugerencia del más adecuado.
- ❌ Página de pre-consulta en el portal del cliente con el resultado del test.
- ❌ Alerta si el dispositivo no pasa el pre-check (sin cámara, sin micrófono).

## 12. Reconexión y resiliencia

- ❌ Reconexión automática al proveedor de vídeo si se pierde la conexión (lógica cliente; el backend debería mantener el token válido).
- ❌ Token de larga duración o refrescable para sesiones largas.
- ❌ Fallback a audio / solo voz si el vídeo falla (configuración por sala o por tenant).
- ❌ Fallback a llamada telefónica: provisión de número PSTN de dial-in como alternativa (Twilio/Daily lo soportan).
- ❌ Indicador de calidad de llamada para el profesional (RTT, jitter, packet loss — telemetría del proveedor).
- ❌ Registro de incidencias de conectividad por sesión para soporte técnico.

## 13. Notas clínicas post-sesión

- ❌ Formulario de notas clínicas / SOAP disponible al profesional al finalizar la sesión (REUSE `platform/intake-forms` o tabla propia).
- ❌ Vinculación de notas al `booking_id` y a la sala de vídeo.
- ❌ Plantillas de notas configurables por tipo de servicio o especialidad.
- ❌ Firma digital del profesional en las notas (RGPD / normativa sanitaria española: LBCSS).
- ❌ Acceso del paciente a sus propias notas (portal del paciente).
- ❌ Exportación de notas en PDF o en formato interoperable (HL7 FHIR R4).
- ❌ Historial de notas por paciente/cliente a lo largo de múltiples sesiones.

## 14. Integración con `platform/intake-forms`

- ✅ (Implícita) El módulo `platform/intake-forms` ya existe en `platform-appointments` — los cuestionarios pre-cita pueden completarse antes de la sesión.
- ❌ Mostrar al profesional el intake form completado por el cliente dentro de la interfaz de la sala de vídeo (o en panel lateral).
- ❌ Completar el intake form durante o después de la sesión si no se hizo antes.
- ❌ Enlazar automáticamente el intake form al `booking_id` y a la sala de vídeo al auto-provisionar.
- ❌ Bloquear la entrada a la sala si el intake form obligatorio no ha sido completado.

## 15. Pago previo y control de acceso por paquete (REUSE payments/packages)

- ❌ Verificación de que la cita está pagada antes de emitir el token de acceso (REUSE `platform/payments` o `platform/packages`).
- ❌ Descuento de sesión de un paquete prepagado al emitir el token (REUSE `platform/packages` — balance de sesiones).
- ❌ Bloqueo de acceso si el pago está pendiente o el paquete está agotado.
- ❌ Reembolso automático si el profesional cancela la sala antes del inicio (REUSE `platform/payments`).
- ❌ Cita gratuita / de cortesía: lógica para salas sin cargo.

## 16. Cumplimiento normativo, privacidad y soberanía de datos (RGPD / datos de salud)

- ✅ RLS en todas las tablas por `(app_id, tenant_id)`.
- ✅ Rol dedicado `svc_platform_telehealth` con mínimo privilegio.
- ✅ Credenciales del proveedor cifradas AES-256-GCM en BD.
- ❌ Categorización explícita de la sala como tratamiento de **datos de salud** (categoría especial, Art. 9 RGPD / LOPDGDD).
- ❌ Base legal de tratamiento por sala (consentimiento explícito del paciente registrado antes de la primera sesión).
- ❌ Registro de actividades de tratamiento (RAT) que incluya las sesiones de telesalud.
- ❌ Derecho de supresión: borrado de sala, tokens, grabaciones y notas de un paciente concreto.
- ❌ Selección de región de datos del proveedor de vídeo (UE obligatorio — CLOUD Act compliance): configuración de región por tenant (`eu-west` en Daily/Twilio).
- ❌ Subprocesador: DPA (Data Processing Agreement) con el proveedor de vídeo gestionado en la configuración.
- ❌ Auditoría de acceso a datos sensibles (quién consultó qué sala/token y cuándo).
- ❌ Retención y purga automática de salas y tokens antiguos según política por tenant (REUSE `platform/scheduler`).
- ❌ Anonimización de salas archivadas (borrar `join_url`, `external_room_id`).

## 17. Accesibilidad y subtítulos

- ❌ Subtítulos automáticos en tiempo real (ASR: Daily/Twilio soportan transcripción live — activable por sala).
- ❌ Configuración de idioma de transcripción por sala o por tenant.
- ❌ Transcripción post-sesión como texto adjunto a la sala / cita.
- ❌ Compatibilidad con lectores de pantalla en la interfaz web de la sala.
- ❌ Subtítulos opcionales para personas con discapacidad auditiva (WCAG 2.1 AA).

## 18. Analítica, telemetría y calidad de llamada

- ❌ Registro de métricas de calidad de llamada por sesión (RTT, jitter, packet loss, resolución de vídeo) desde el webhook del proveedor.
- ❌ Duración real de la sesión (tiempo desde primer JOIN hasta último LEAVE) vs duración programada.
- ❌ Tasa de abandono de sala de espera.
- ❌ Tasa de sesiones con incidencias técnicas vs sesiones sin incidencias.
- ❌ Dashboard para administradores: sesiones del día, en curso, con problemas.
- ❌ Export de logs de sesión para auditoría (CSV/JSON).
- ❌ Alertas de SLA: sesiones que empezaron tarde por fallo de provisión.
- ❌ Integración con observabilidad de la plataforma (métricas Prometheus / Grafana).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Integración real con Daily.co** (o LiveKit si se prefiere auto-alojar en UE) — es el bloqueador de producción. La abstracción ya está preparada; solo hay que implementar `provisionRoom` y `provisionToken` para el proveedor elegido.
2. **Notificación del enlace al cliente y al profesional** — REUSE `platform/notifications` consumiendo `telehealth.room.created`. Sin esto el cliente no sabe cómo unirse.
3. **Recordatorio pre-cita con enlace** (T-24h, T-1h) — REUSE `platform/scheduler` + `platform/notifications`. Alto impacto en no-shows.
4. **Escucha `booking.cancelled` / `booking.rescheduled`** — cancelar o actualizar la sala automáticamente cuando la cita cambia. Evita salas huérfanas.
5. **Transición automática `expired`** — job en `platform/scheduler` que marque salas caducadas; sin esto el estado `expired` es decorativo.
6. **Consentimiento de grabación + almacenamiento** — REUSE `platform/storage`. Requisito legal (RGPD Art. 9) antes de activar `recording_enabled`.
7. **Selección de región UE del proveedor de vídeo** — obligatorio para cumplir RGPD con datos de salud antes de ir a producción con clientes reales.
8. **Sala de espera virtual** — diferenciador de producto en el mercado de telesalud; impacto directo en satisfacción del profesional.
9. **Verificación de pago antes de emitir token** — REUSE `platform/packages` (balance de sesiones). Necesario para monetizar correctamente las citas.
10. **Notas clínicas post-sesión** — REUSE `platform/intake-forms` o tabla `platform_telehealth.session_notes`. Completa el ciclo clínico y es un requisito regulatorio en muchas especialidades.
