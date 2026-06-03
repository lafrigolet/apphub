# Casos de uso — `platform/scheduler` (platform-scheduler)

> Dominio: cron-as-a-service single-runner. Ejecuta jobs programados (cron) que sondean Postgres + Redis y publican eventos a los otros cuatro monolitos (platform-core, platform-marketplace, platform-restaurant, platform-appointments). Corre con `replicas: 1` para garantizar exactly-once por tick; usa advisory locks de Postgres para que un disparo manual y un tick automático coincidentes no se solapen. Tiene su propio rol `svc_platform_scheduler` con `BYPASSRLS` y permisos cross-schema mínimos (SELECT / UPDATE / DELETE / INSERT según lo requiera cada job). Los endpoints admin (`/v1/scheduler/*`) sólo son accesibles desde la red Docker; no hay ruta NGINX pública en V1.

## Estado actual (implementado)

16 jobs registrados en `src/jobs/index.js`; habilitables/deshabilitables por variable de entorno sin redeploy. Historial de ejecuciones en `platform_scheduler.runs`. Advisory lock por job (hash MD5 del nombre → bigint). Publicación de eventos vía Redis `platform.events`. Tres endpoints admin: listar jobs, listar runs, disparar un job on-demand. Graceful shutdown (SIGTERM/SIGINT). Fastify mínimo con `/health` público. Migraciones propias + grants cross-schema idempotentes con `ALTER DEFAULT PRIVILEGES`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Registro de jobs y metadatos

- ✅ Cada job declara su propio `meta.name`, `meta.cron` y `meta.description` — registro autodescriptivo, sin tabla de configuración separada.
- ✅ Lista de jobs construida en `src/jobs/index.js`; el servidor la itera al arrancar para programar los `cron.schedule()`.
- ✅ Flag de habilitación por variable de entorno (`JOB_<NAME>_ENABLED`) — desactivar un job no requiere redeploy.
- ✅ `GET /v1/scheduler/jobs` devuelve `name, description, cron, enabled` de cada job registrado.
- 🔧 `meta.description` es texto libre — no hay versión semántica ni ownership de módulo declarado en el metadato.
- ❌ Registro de jobs en base de datos (no depender del código para conocer qué jobs existen): catálogo de jobs persistido en `platform_scheduler.job_definitions`.
- ❌ Tags / grupos por dominio (disponibilidad, chat, storage, …) para filtrar y operar en bloque desde el admin.
- ❌ Documentación de qué evento publica cada job y qué consumidores reaccionan (grafo de dependencias).

## 2. Programación cron y expresiones temporales

- ✅ Expresiones cron estándar de 5 campos via `node-cron` (`* * * * *`, `*/5 * * * *`, `0 * * * *`, `0 8 * * *`, `*/15 * * * *`, `*/30 * * * *`, `30 0 * * *`, `0 2 * * *`, `0 9 * * *`, `15 3 * * *`, `30 3 * * *`).
- ✅ Granularidad mínima de 1 minuto (límite de `node-cron`).
- 🔧 La zona horaria de todos los jobs es UTC implícito — los jobs diarios (`0 8 * * *`, `0 9 * * *`) disparan a hora UTC fija sin considerar la timezone de cada tenant.
- ❌ Soporte de timezone en la expresión cron (opción `timezone` de `node-cron` no activada por job).
- ❌ Expresiones cron de 6 campos con segundos (resolución sub-minuto).
- ❌ Expresiones "human-readable" / interval notation (`every 5 minutes`) — hoy sólo cron estándar.
- ❌ Validación de la expresión cron al registrar un job dinámico; errores silenciosos en runtime.

## 3. Ejecución exactly-once y advisory locks

- ✅ `pg_try_advisory_lock(bigint)` derivado de `md5(jobName)` → lock de sesión Postgres adquirido antes de cada ejecución.
- ✅ Si el lock está tomado, el tick se registra como `skipped_locked` en `runs` y se retorna sin ejecutar el job.
- ✅ El lock se libera en el bloque `finally` del `jobRunner`, incluso ante fallos del job.
- ✅ Crash del runner → cierre de sesión Postgres → PG libera automáticamente el advisory lock → el tick siguiente lo adquiere (comportamiento verificado en `missed-tick-recovery.test.js`).
- ✅ Disparo manual concurrente con el tick automático → uno de los dos obtiene el lock, el otro queda `skipped_locked`.
- ❌ Lock distribuido multi-proceso (Redis `SET NX` / Redlock) — alternativa si en el futuro se pasa a múltiples réplicas.
- ❌ Timeout máximo de ejecución por job — un job que cuelga indefinidamente retiene el lock hasta que el proceso muere.

## 4. Historial de ejecuciones (tabla `runs`)

- ✅ Tabla `platform_scheduler.runs`: `id UUID`, `job_name TEXT`, `started_at TIMESTAMPTZ`, `finished_at TIMESTAMPTZ`, `status TEXT CHECK('running','success','error','skipped_locked')`, `rows_affected INT`, `error TEXT` (hasta 8 KB de stack), `metadata JSONB` (incluye `durationMs`).
- ✅ Índices por `(job_name, started_at DESC)` y `(status, started_at DESC)`.
- ✅ `GET /v1/scheduler/runs` con filtro opcional `?jobName=` y `?limit=` (máx. 500, default 100), ordenado por `started_at DESC`.
- ✅ Las filas `running` que quedan huérfanas (crash antes de `recordError`) son detectables consultando `status='running' AND started_at < now()-interval '…'`.
- 🔧 `metadata` contiene `durationMs` más cualquier campo que el job devuelva — no hay esquema fijo; dificulta la agregación.
- 🔧 No hay paginación por cursor en `GET /v1/scheduler/runs` — con `limit` fijo puede perderse histórico ante volumen alto.
- ❌ Purga automática de runs antiguos — la tabla crece sin límite; sin job `scheduler-runs-purge` ni política de retención.
- ❌ Estadísticas agregadas por job: p50/p95 de duración, tasa de error, filas procesadas/tick — no hay endpoint de métricas.
- ❌ Exportación de runs a sistema externo (Prometheus, Datadog, CloudWatch).

## 5. Endpoints admin

- ✅ `GET /v1/scheduler/jobs` — lista todos los jobs con `name, description, cron, enabled`. Requiere rol `staff` o `super_admin`.
- ✅ `GET /v1/scheduler/runs` — historial paginado, filtrable por `jobName`. Requiere `staff` o `super_admin`.
- ✅ `POST /v1/scheduler/jobs/:name/run` — disparo on-demand de un job; respeta el advisory lock (si el tick automático está corriendo, retorna `skipped_locked`). Requiere `staff` o `super_admin`.
- ✅ `GET /health` — estado del servicio con lista de jobs y su flag `enabled`; público.
- ❌ `PATCH /v1/scheduler/jobs/:name` — activar/desactivar un job en caliente (sin redeploy); hoy sólo se controla por env.
- ❌ `PATCH /v1/scheduler/jobs/:name/cron` — cambiar la expresión cron sin redeploy.
- ❌ `GET /v1/scheduler/jobs/:name/runs` — historial de un job específico sin pasar `?jobName=`.
- ❌ `GET /v1/scheduler/jobs/:name/stats` — estadísticas agregadas (última ejecución, duración media, tasa de éxito).
- ❌ `DELETE /v1/scheduler/runs` — purga manual del historial por antigüedad o por job.
- ❌ UI en la consola admin — hoy los endpoints existen pero no hay vistas en `apps/portal/`.

## 6. Publicación de eventos a monolitos

- ✅ Publicación vía `redis.publish('platform.events', …)` usando `@apphub/platform-sdk/redis`.
- ✅ Payload normalizado: `{ type, payload: { appId, tenantId, … } }` — consistent con el contrato del resto de módulos.
- ✅ Jobs que publican eventos: `booking-reminders` (`booking.reminder.due`), `booking-recurrence-expander` (no publica, escribe directo), `reservation-reminders` (`reservation.reminder.due`), `package-expiry-warning` (`package.expiring`), `package-expiry-transition` (`package.expired`), `practitioner-payout-close` (`payout.period_due`), `dispute-sla` (`dispute.sla_breached`), `basket-abandoned` (`basket.abandoned`), `storage-retention-purge` (`storage.object.deleted`), `chat-scheduled-send` (`chat.scheduled.due`), `chat-support-sla` (`chat.support.sla_breached`), `notification-digest` (`notifications.digest.flush`).
- 🔧 La publicación es best-effort: si Redis falla durante un tick, el job arroja error y el evento se pierde (no hay reintentos de publicación).
- ❌ Acuse de recibo / confirmación de que el evento fue procesado por el consumidor destino.
- ❌ Dead-letter queue para eventos que no tienen consumidor activo o cuyo consumidor falló (Redis Streams / XADD no usado).
- ❌ Trazabilidad extremo a extremo: correlación entre `run_id` y el evento publicado (no se guarda en `runs.metadata`).

## 7. Job: `availability-hold-purge`

- ✅ Cron: `* * * * *` (cada minuto).
- ✅ `DELETE FROM platform_availability.holds WHERE expires_at <= now()` — limpia holds caducados que la disponibilidad no purgó oportunísticamente.
- ✅ Retorna `rowsAffected` para el registro de runs.
- ❌ Publicación de evento `availability.hold.expired` — los consumidores no se enteran de qué holds se purgaron.
- ❌ Purga diferenciada por tenant: hoy borra todos los holds expirados de todos los tenants en un único DELETE.

## 8. Job: `booking-reminders`

- ✅ Cron: `*/5 * * * *`.
- ✅ Ventanas T-24h (slack ±30 min) y T-2h (slack ±5 min).
- ✅ Idempotencia via `reminder_24h_sent_at` / `reminder_2h_sent_at`: UPDATE-RETURNING en un único round-trip.
- ✅ Resolución de locale: `booking.locale → tenant.default_locale → 'es'` con LEFT JOIN a `platform_tenants.tenants`.
- ✅ Publica `booking.reminder.due` con `{ appId, tenantId, bookingId, serviceId, clientUserId, clientEmail, clientPhone, clientName, startsAt, endsAt, window, locale }`.
- ❌ Ventana T-1h — no configurada; sólo 24h y 2h.
- ❌ Ventanas configurables por tenant (algunos pueden preferir T-48h o T-30min).
- ❌ Reminder de cancelación confirmada o reprogramación.

## 9. Job: `booking-recurrence-expander`

- ✅ Cron: `0 * * * *` (cada hora).
- ✅ Materializa 30 días hacia adelante desde hoy para cada recurrencia activa en `platform_bookings.recurrences`.
- ✅ Soporta `freq: 'weekly'` con `byday` (días de la semana) e `interval` (cada N semanas) y `freq: 'daily'`.
- ✅ Idempotencia: `(recurrence_id, starts_at)` como clave natural; no inserta si ya existe.
- ✅ Copia `service_id`, recursos (`booking_resources`) e info de cliente del primer booking (seed) de la recurrencia.
- ✅ Registra evento de auditoría en `booking_events` con `reason: 'expanded from recurrence'`.
- 🔧 Si no existe booking seed, la recurrencia se salta silenciosamente — el staff debe crear el primer booking manualmente.
- ❌ `freq: 'monthly'` no implementado.
- ❌ RRULE completo (EXDATE, RDATE, UNTIL con hora exacta, COUNT con offset de inicio).
- ❌ Notificación al staff cuando una recurrencia llega al final (`ends_on` alcanzado o `count` agotado).
- ❌ Horizonte configurable por tenant (hoy fijo a 30 días).

## 10. Job: `reservation-reminders`

- ✅ Cron: `*/5 * * * *`.
- ✅ Ventanas T-24h (slack ±30 min) y T-2h (slack ±5 min) — misma lógica que `booking-reminders`.
- ✅ Idempotencia via `reminder_24h_sent_at` / `reminder_2h_sent_at`.
- ✅ Resolución de locale desde `platform_tenants.tenants`.
- ✅ Publica `reservation.reminder.due` con `{ appId, tenantId, reservationId, guestUserId, guestEmail, guestPhone, guestName, partySize, reservedFor, tableId, window, locale }`.
- ❌ Ventanas adicionales (T-1h, T-30min para walk-in tardío).
- ❌ Reminder de lista de espera cuando se libera una mesa.

## 11. Job: `package-expiry-warning`

- ✅ Cron: `0 8 * * *` (diario a las 08:00 UTC).
- ✅ Ventanas T-30d y T-7d con idempotencia via `warning_30d_sent_at` / `warning_7d_sent_at`.
- ✅ Sólo paquetes con `status='active'` y `remaining_sessions > 0` — no avisa si el paquete ya se agotó.
- ✅ Publica `package.expiring` con `{ packageId, clientUserId, serviceId, remainingSessions, totalSessions, expiresAt, window }`.
- ❌ Ventana T-1d — último aviso el día de caducidad.
- ❌ Aviso de sesiones agotadas (paquete activo sin sesiones restantes).
- ❌ Hora de disparo configurable por timezone de tenant (hoy fijo UTC 08:00).

## 12. Job: `package-expiry-transition`

- ✅ Cron: `30 0 * * *` (diario a las 00:30 UTC).
- ✅ `UPDATE … SET status='expired' WHERE status='active' AND expires_at <= now()` — transición atómica.
- ✅ Publica `package.expired` por cada paquete transicionado con `{ packageId, clientUserId, serviceId, remainingSessions, expiresAt }`.
- ❌ Transición a `exhausted` cuando `remaining_sessions = 0` antes de `expires_at` (hoy no diferenciado de `expired`).
- ❌ Reversión/gracia: si un tenant quiere dar un periodo de gracia, no hay mecanismo.

## 13. Job: `practitioner-payout-close`

- ✅ Cron: `0 2 * * *`.
- ✅ Selecciona schedules con `next_run_at <= now()` y calcula `periodStart/periodEnd` según `period: 'weekly' | 'biweekly' | 'monthly'`.
- ✅ Publica `payout.period_due` con `{ scheduleId, practitionerId, period, periodStart, periodEnd }`.
- ✅ Avanza `next_run_at` y `last_closed_at` en el mismo tick para evitar re-disparos.
- 🔧 Si el consumidor de `payout.period_due` falla (evento perdido), el schedule ya avanzó — el cierre de ese periodo se pierde sin aviso; staff puede re-disparar desde el admin endpoint.
- ❌ Periodo `quarterly` no soportado.
- ❌ Pausa de schedule por bajas de contrato (no hay `paused_at`).
- ❌ Resumen de payouts cerrados (cuántos practitioners, importe total) en `runs.metadata`.

## 14. Job: `dispute-sla`

- ✅ Cron: `*/30 * * * *`.
- ✅ SLA fijo de 48h para disputas `open` sin respuesta de vendor.
- ✅ Idempotencia via `sla_breached_at IS NULL` + UPDATE-RETURNING.
- ✅ Verifica ausencia de mensajes `sender_role='vendor'` antes de marcar incumplimiento.
- ✅ Publica `dispute.sla_breached` con `{ disputeId, orderId, buyerUserId, openedAt, slaHours }`.
- 🔧 SLA de 48h hardcodeado — no configurable por tenant ni por categoría de disputa.
- ❌ SLA de segunda etapa: si `investigating` lleva >5 días sin resolución, nuevo evento.
- ❌ SLA de buyer: si el comprador no aporta evidencias en N días, auto-cerrar a favor del vendor.

## 15. Job: `basket-abandoned`

- ✅ Cron: `0 * * * *` (cada hora).
- ✅ Escanea claves Redis `basket:<appId>:<tenantId>:<userId>` con `SCAN MATCH`.
- ✅ Umbral de inactividad: `OBJECT IDLETIME >= 24h`.
- ✅ Supresión de duplicados: clave marker `basket:abandoned-emitted:<sha1>` con TTL 7 días para no re-emitir cada hora.
- ✅ Hidratación del email del comprador desde `platform_auth.users` (consulta directa con BYPASSRLS) para que el consumidor de notificaciones no necesite llamada HTTP adicional.
- ✅ Publica `basket.abandoned` con `{ appId, tenantId, userId, buyerEmail, itemCount, idleSeconds, basketKey }`.
- 🔧 `OBJECT IDLETIME` puede dar `null` en algunas versiones de Redis con LFU policy — se trata como "no inactivo" pero sin warning.
- ❌ Umbral de abandono configurable por tenant (hoy fijo 24h).
- ❌ Recuperación de los ítems del basket para incluirlos en el evento (el consumidor tiene que leer Redis de nuevo).
- ❌ Gestión del marker si el basket se reanuda (una compra completada debería borrar el marker antes de los 7d).

## 16. Job: `storage-orphan-purge`

- ✅ Cron: `0 * * * *` (cada hora).
- ✅ `DELETE FROM platform_storage.objects WHERE status='pending' AND created_at < now()-interval '1 hour'` — elimina uploads iniciados pero no finalizados.
- ✅ Sólo borra la fila de DB; los bytes en MinIO se recogen por la lifecycle policy del bucket (V1 fuera de alcance).
- 🔧 Sin publicación de evento — el módulo storage no se entera de qué objetos se purgaron; referencias en otras tablas pueden quedar huérfanas.
- ❌ Purga real del objeto en MinIO (DELETE presigned + `DeleteObject`): V2 pendiente.
- ❌ Umbral de 1h no configurable por tenant (algunos flujos pueden requerir más tiempo para finalizar uploads grandes).

## 17. Job: `storage-retention-purge`

- ✅ Cron: `15 3 * * *`.
- ✅ Soft-delete (`status='deleted'`, `deleted_at=now()`) de objetos `uploaded` con `retention_until <= now()`.
- ✅ Publica `storage.object.deleted` con `{ objectId, kind, reason:'retention_expired' }` para que los módulos clientes limpien referencias.
- ❌ Hard-delete real en MinIO — V2 pendiente.
- ❌ Purga diferida: marcar para borrado pero esperar N días de "papelera" antes del hard-delete.
- ❌ Informe de objetos eliminados por tenant para auditoría de compliance.

## 18. Job: `notification-digest`

- ✅ Cron: `0 9 * * *` (09:00 UTC diario).
- ✅ Publica `notifications.digest.flush` como señal al módulo notifications para que compose y envíe los digests acumulados.
- ✅ Single-runner garantiza que el flush se dispara exactamente una vez por día.
- 🔧 La hora es 09:00 UTC fija — no considera timezone del tenant; en tenants europeos es correcto, en LATAM sería madrugada.
- ❌ Cadencia configurable por tenant: diario/semanal/inmediato.
- ❌ Digest por canal (email vs push) con cadencias distintas.
- ❌ Flush por tenant aislado (hoy el evento es global y el módulo debe fanout internamente).

## 19. Jobs de chat: `chat-scheduled-send`, `chat-ephemeral-purge`, `chat-retention-purge`, `chat-support-sla`

- ✅ **`chat-scheduled-send`** — cron `* * * * *`: UPDATE `status='scheduled' AND dispatched_at IS NULL AND scheduled_for <= now()` → `dispatched_at=now()`, publica `chat.scheduled.due` para cada mensaje afectado. El módulo chat realiza el flip real a `sent` y el fan-out.
- ✅ **`chat-ephemeral-purge`** — cron `* * * * *`: soft-delete de mensajes con `expires_at <= now()` → `deleted_at=now(), body=NULL` (tombstone). Row se mantiene por integridad referencial de threads/replies.
- ✅ **`chat-retention-purge`** — cron `30 3 * * *`: hard-delete de mensajes pasados `retention_days` por tenant (JOIN con `platform_chat.settings`). Tenants con `retention_days IS NULL` retienen indefinidamente.
- ✅ **`chat-support-sla`** — cron `*/15 * * * *`: SLA de 4h sin respuesta de agente en conversaciones `type='support'` con `support_status IN ('open','pending')`; idempotencia via `sla_breached_at`; publica `chat.support.sla_breached`.
- 🔧 `chat-scheduled-send` y `chat-ephemeral-purge` corren cada minuto — si la carga crece, ambos compiten por el advisory lock consigo mismos en el mismo minuto (lock por nombre de job: distintos, no hay conflicto entre ellos).
- ❌ SLA de chat-support de 4h hardcodeado — no configurable por tenant ni por `priority`.
- ❌ Segundo nivel de SLA (si sigue sin respuesta tras la primera brecha, nueva escalada).
- ❌ Purga de archivos adjuntos de mensajes eliminados por retención (hoy sólo se borra la fila del mensaje).

## 20. Resiliencia, reintentos y dead-man switch

- ✅ Un job que lanza excepción → el error se registra en `runs` (`status='error', error=stack`) → el proceso no se cae (catch en `jobRunner` devuelve `{ error }` sin rethrow).
- ✅ El advisory lock siempre se libera en `finally`, incluso ante fallos.
- ✅ Ticks perdidos no se encolan: cada nuevo tick es independiente — si un tick falla, el siguiente intenta ejecutar de cero.
- 🔧 Reintentos automáticos ante fallo no implementados — si falla el INSERT de reminder, el run siguiente lo reintentará porque `sent_at IS NULL` aún (idempotencia por diseño, no por retry explícito).
- ❌ Backoff exponencial / política de retry configurable por job.
- ❌ Dead-man switch: alerta si un job no corre en N periodos consecutivos (ej. detector externo de "heartbeat" via Healthchecks.io o equivalente).
- ❌ Alerta si el porcentaje de runs `error` supera un umbral en ventana deslizante.
- ❌ Alerta si un tick tarda más de N segundos (`durationMs` está en metadata pero no hay umbral).
- ❌ Notificación a staff (Slack, email) cuando un job falla — el error sólo queda en logs y en la tabla `runs`.

## 21. Idempotencia de jobs

- ✅ **Patrón UPDATE-RETURNING con columna sentinel**: `booking-reminders`, `reservation-reminders`, `package-expiry-warning`, `dispute-sla`, `chat-scheduled-send`, `chat-ephemeral-purge`, `chat-support-sla` — la misma UPDATE que selecciona las filas elegibles las marca como procesadas, atómica en un solo round-trip.
- ✅ **Clave natural de deduplicación**: `booking-recurrence-expander` usa `(recurrence_id, starts_at)` — re-ejecutar el job no duplica filas.
- ✅ **Marker Redis con NX**: `basket-abandoned` usa `SET NX EX` para suprimir re-emisiones en ventana de 7d.
- ✅ **Avance del cursor antes del evento**: `practitioner-payout-close` adelanta `next_run_at` antes de publicar, evitando re-disparo aunque el evento se procese dos veces.
- 🔧 `notification-digest` publica el evento sin ningún mecanismo de idempotencia: si el job se dispara manualmente dos veces seguidas, se envían dos flushes.
- ❌ Idempotency key global en `runs` para el disparo on-demand (`POST /v1/scheduler/jobs/:name/run`) — hoy permite múltiples disparos simultáneos desde la consola (el advisory lock los serializa, pero no los deduplica si el primero termina antes de que llegue el segundo).

## 22. Activar/desactivar jobs sin redeploy

- ✅ Flag `JOB_<NAME>_ENABLED` leído al arrancar; si es `false`, el job no se schedula.
- 🔧 Cambiar el flag requiere reiniciar el contenedor (modificar la env var en docker-compose + `docker compose up -d`).
- ❌ `PATCH /v1/scheduler/jobs/:name` — toggle en caliente via API sin reinicio.
- ❌ Activación/desactivación persistida en BD (`platform_scheduler.job_definitions`) para sobrevivir reinicios.
- ❌ Historial de cambios de configuración de jobs (quién desactivó qué y cuándo).

## 23. Jobs ad-hoc y one-shot programados (delayed jobs)

- 🔧 `POST /v1/scheduler/jobs/:name/run` permite disparar cualquier job registrado on-demand — equivalente a un one-shot manual.
- ❌ Jobs one-shot con `run_at` futuro (delayed job): programar una tarea para un instante concreto sin expresión cron.
- ❌ API de enqueueing: `POST /v1/scheduler/enqueue` con `{ jobName, payload, runAt }` — permite que otros módulos programen tareas sin acoplar a cron fijo.
- ❌ Webhooks salientes programados: enviar un HTTP POST a una URL externa a una hora concreta.
- ❌ Jobs con TTL: si no han corrido antes de un deadline, descartarlos con `status='expired'` en vez de ejecutarlos.

## 24. Configuración en runtime (sin redeploy)

- ❌ `platform_scheduler.job_config` — tabla para configurar por job: expresión cron, timeout máximo, número de reintentos, umbral de alerta de duración.
- ❌ `GET/PATCH /v1/scheduler/jobs/:name/config` — endpoints admin para modificar la configuración sin reiniciar.
- ❌ Configuración por tenant: ej. umbral de SLA de disputa, ventanas de reminder, huso horario del digest — hoy todos los parámetros son constantes en el código.
- ❌ Recarga en caliente de la configuración: el runner la lee al inicio de cada tick desde Redis/DB en vez de al arrancar.

## 25. Multi-tenant scheduling (tareas por tenant)

- ✅ Los jobs actuales operan globalmente (BYPASSRLS, sin `SET LOCAL app.tenant_id`) y propagan `app_id`/`tenant_id` en el payload del evento — el consumidor destino aplica el aislamiento.
- ❌ Jobs por-tenant: que un tenant configure sus propias tareas programadas (ej. exportación de datos diaria, reporte semanal).
- ❌ `platform_scheduler.tenant_jobs` — tabla donde cada tenant registra jobs ad-hoc con su cron y callback/webhook.
- ❌ Cuota de jobs por tenant para evitar abuso.
- ❌ Jobs de migración de datos específicos de un tenant (backfill por `tenant_id`).

## 26. Concurrencia y solapamiento entre ticks

- ✅ Advisory lock por nombre de job garantiza que dos ticks del mismo job no corren en paralelo.
- ✅ Jobs distintos corren en paralelo entre sí (cada tick de `node-cron` es un callback independiente).
- 🔧 Si un job tarda más que su intervalo de cron (ej. `availability-hold-purge` a `* * * * *` tarda >60s), el tick siguiente queda `skipped_locked` — comportamiento correcto pero sin alerta.
- ❌ Prioridad de ejecución: no hay mecanismo para que jobs críticos (`booking-reminders`) tengan preferencia sobre los de mantenimiento.
- ❌ Pool de workers con concurrencia configurable para jobs que sí admiten paralelismo intra-job (ej. procesar cada tenant en paralelo).

## 27. Observabilidad y métricas

- ✅ Logging estructurado con Pino (`logger.info({ ms, rowsAffected })`).
- ✅ `metadata JSONB` en `runs` incluye `durationMs` y campos adicionales retornados por cada job.
- ✅ `GET /v1/scheduler/runs` es la superficie de observabilidad actual — consultable desde la consola.
- ❌ Endpoint `/metrics` compatible con Prometheus (`platform_scheduler_job_duration_seconds`, `platform_scheduler_job_runs_total{status}`, `platform_scheduler_rows_affected_total`).
- ❌ Integración con Datadog/New Relic/OpenTelemetry para trazas distribuidas job → evento → consumidor.
- ❌ Dashboard en la consola admin: jobs más lentos, tasa de error, última ejecución, próxima ejecución estimada.
- ❌ Alertas automáticas: job no ha corrido en N periodos (dead-man), duración > umbral, error rate > X%.

## 28. Backfill y reejecución de un periodo

- 🔧 `POST /v1/scheduler/jobs/:name/run` permite re-ejecutar un job en el instante actual — equivale a un backfill del tick más reciente.
- ❌ Backfill con rango de fechas: "re-ejecuta `booking-reminders` como si fuera el 2026-05-01 a las 09:00" — requiere inyectar un `now()` virtual.
- ❌ Reejecución de un `run` concreto (por `run_id`) repitiendo exactamente las condiciones.
- ❌ Modo dry-run: ejecutar el job y retornar qué filas/eventos se procesarían sin escribir en BD ni publicar en Redis.

## 29. Escalado: paso de single-runner a distribuido

- ✅ El diseño actual (advisory lock + `replicas: 1`) está documentado como el modelo V1.
- ✅ La separación entre la lógica del job (`run`) y el runner (`jobRunner`) facilita migrar a un motor de colas.
- ❌ Paso a `replicas: N` con advisory locks distribuidos (Redlock o `pg_try_advisory_lock` compartido) — no documentado ni probado.
- ❌ Integración con un motor de colas (BullMQ, pg-boss, Faktory) que ofrezca retries, priorities y dashboards out-of-the-box.
- ❌ Jobs particionables por tenant: cada worker procesa un subconjunto de tenants.

## 30. Seguridad y acceso

- ✅ Endpoints admin protegidos por `appGuard` + `requireRole('staff','super_admin')`.
- ✅ El Fastify del scheduler no tiene ruta NGINX pública en V1 — sólo accesible desde la red Docker.
- ✅ Rol `svc_platform_scheduler` con BYPASSRLS y permisos cross-schema mínimos (SELECT/UPDATE/DELETE/INSERT según job) — sin acceso al superusuario en runtime.
- 🔧 `ALLOWED_ORIGINS` usado en CORS aunque el scheduler no tiene frontend propio — relevante si en el futuro se expone vía NGINX.
- ❌ Audit log de disparos manuales: quién (`sub`, `email`) disparó `POST /v1/scheduler/jobs/:name/run` y cuándo — hoy sólo queda en logs.
- ❌ Rate limiting específico para el endpoint de disparo on-demand (el rate-limit global de 60 req/min aplica, pero no distingue por job ni por actor).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Dead-man switch** — alerta si un job no corre N periodos consecutivos o si el porcentaje de `error` supera umbral. Implementable con un check externo (Healthchecks.io / UptimeRobot) apuntando a `/health`, más una lógica en la consola que consulte `runs` — coste muy bajo, riesgo operativo alto sin él.
2. **Purga automática de la tabla `runs`** — añadir un job `scheduler-runs-purge` (`0 4 * * *`) que borre runs con `started_at < now()-interval '90 days'` para evitar que la tabla crezca sin límite.
3. **Toggle de jobs en caliente** (`PATCH /v1/scheduler/jobs/:name`) + persistencia en `platform_scheduler.job_definitions` — desactivar un job defectuoso sin reiniciar el contenedor.
4. **UI en la consola admin** — vistas de listado de jobs, historial de runs con estado/duración, botón "Ejecutar ahora" — REUSE directo de los tres endpoints ya implementados.
5. **Audit log de disparos manuales** — registrar `triggered_by` (`user_id`, `email`) en `runs.metadata` cuando el origen es el endpoint on-demand; coste mínimo, imprescindible para compliance.
6. **Alertas por fallo de job** — evento `scheduler.job.failed` publicado por `jobRunner` ante `status='error'`, que el módulo notifications convierte en email/Slack al equipo de operaciones.
7. **Backoff / retry configurable por job** — reintentar N veces con backoff exponencial antes de registrar `status='error'`; crítico para jobs como `practitioner-payout-close` donde un evento perdido implica un cierre de periodo perdido.
8. **Configuración de parámetros por tenant** (ventanas de reminder, umbral SLA, timezone de digest) — requiere `platform_scheduler.job_config` y endpoints admin de config; desbloquea personalización sin redeploy.
9. **Jobs one-shot con `run_at` futuro** (delayed jobs) — `POST /v1/scheduler/enqueue { jobName, payload, runAt }` — permite que módulos como `bookings` programen un evento futuro sin acoplar a una expresión cron global.
10. **Métricas Prometheus** (`/metrics`) — exportar `job_duration_seconds`, `job_runs_total{status}`, `rows_affected_total` para integración con Grafana/Alertmanager sin depender de consultas ad-hoc a `runs`.
