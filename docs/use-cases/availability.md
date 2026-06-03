# Casos de uso — `platform/availability` (platform-appointments)

> Dominio: motor de disponibilidad — cómputo de slots libres + holds atómicos en Redis/Postgres. Calcula qué huecos horarios están disponibles para reservar combinando horarios de trabajo de los recursos (`platform_resources.work_hours`), excepciones puntuales (`platform_resources.exceptions`), citas existentes (`platform_bookings.bookings`) y reglas de servicio (`platform_services.services`: duración, buffers, granularidad de paso, capacidad).

## Estado actual (implementado)

Tres endpoints REST autenticados: `GET /v1/availability/slots`, `POST /v1/availability/holds`, `DELETE /v1/availability/holds/:id`. Slot-grid puro en memoria (sin tabla de slots materializada): itera por día, ventana de trabajo y cursor con paso configurable (`step_minutes`, default 15). Holds atómicos en `platform_availability.holds` vía INSERT…WHERE NOT EXISTS que chequea solapamiento contra holds activos y bookings no terminales. Capacidad de grupo: `remaining = min(service.capacity, resource.capacity) - consumidores solapantes`. Caché de slots en Redis con clave versionada por recurso (60 s TTL); cualquier hold/release bumpa la versión e invalida el cache. Purga de holds: doble mecanismo (opportunista dentro de `holdSlot` + cron del scheduler cada minuto). Eventos `availability.held` y `availability.released` publicados en `platform.events`. RLS en `platform_availability.holds` por `(app_id, tenant_id)`. Lectura cross-schema de `platform_services`, `platform_resources`, `platform_bookings` con GRANTs selectivos al rol `svc_platform_availability`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Cómputo de slots libres para un servicio + rango de fechas

- ✅ `GET /v1/availability/slots?serviceId=…&from=…&to=…` — devuelve array de `{ resourceId, startsAt, endsAt, capacity, remaining }`.
- ✅ Validación: `from` y `to` obligatorios; `from < to` (→ `ValidationError 422`).
- ✅ Servicio inexistente → `NotFoundError 404`.
- ✅ Servicio sin recursos activos → array vacío (no error).
- ✅ Iteración por día UTC dentro del rango `from…to`; soporte de rangos multi-día (hasta los días que dure el rango).
- ✅ Slots ordenados por `startsAt` ascendente.
- 🔧 Rango máximo permitido no está limitado en el endpoint (el cómputo puede ser costoso para rangos de meses sin caché activa).
- ❌ Parámetro `days` como alternativa al par `from/to` ("próximos N días").
- ❌ Paginación o límite de resultados (ante servicios con muchos recursos o rangos amplios).
- ❌ Filtros adicionales en la respuesta (p.ej. sólo el primer slot por día).

## 2. Ventanas de trabajo de recursos (work hours)

- ✅ Lectura de `platform_resources.work_hours`: `day_of_week (0-6)`, `start_minute`, `end_minute`, `effective_from`, `effective_until`.
- ✅ Filtro correcto por día de la semana (UTC) sobre la fecha del bucket de día.
- ✅ Soporte de fechas efectivas: `effective_from` y `effective_until` permiten horarios con vigencia temporal (temporada de verano, cambio de jornada, etc.).
- ✅ Múltiples franjas en el mismo día (p.ej. mañana 09-13 + tarde 16-20) — el bucle itera sobre todas las ventanas del día.
- ✅ Recurso sin `work_hours` en el día → 0 slots para ese día (correcto; no error).
- ❌ Herencia de horario de tenant/app (horario por defecto que el recurso puede sobreescribir).
- ❌ Horarios especiales temporales directamente desde el módulo de availability (actualmente sólo vía `exceptions`).
- ❌ Zona horaria por tenant/recurso (hoy todo se computa en UTC; el paso de `start_minute`/`end_minute` es relativo al inicio del día UTC, no al día local del tenant).

## 3. Granularidad de slots y alineamiento del cursor

- ✅ `step_minutes` por servicio (migración `0003_step_minutes.sql`): granularidad configurable 1–240 minutos; default 15 si `step_minutes` es `null` o `0`.
- ✅ Alineamiento automático del cursor al múltiplo de `step_minutes` dentro de la ventana (si la ventana empieza en un minuto no alineado, el primer slot se ajusta al siguiente múltiplo válido).
- ✅ El slot sólo aparece si `cursor + totalMinutes ≤ win.end` y `cursor + totalMinutes ≤ toDate`.
- ❌ `step_minutes` a nivel de recurso (hoy sólo existe a nivel de servicio).
- ❌ Granularidades asiméttricas (p.ej. primer slot en horas exactas, resto cada 30 min).

## 4. Buffers de servicio (buffer antes y después)

- ✅ `buffer_before_minutes` y `buffer_after_minutes` leídos de `platform_services.services`.
- ✅ `totalMinutes = duration + buffer_before + buffer_after` — es el bloque que el cursor debe caber dentro de la ventana.
- ✅ `startsAt` publicado al cliente = `cursor + buffer_before` (el buffer de preparación es invisible para el cliente; la cita empieza cuando el buffer termina).
- ✅ `endsAt` publicado = `startsAt + duration` (el buffer después tampoco es visible al cliente).
- ✅ `null` en `buffer_before_minutes` / `buffer_after_minutes` tratado como `0` con `?? 0`.
- ❌ Buffers asimétricos por recurso (hoy sólo por servicio).
- ❌ Buffers distintos según modalidad (in_person vs telehealth).

## 5. Bloqueos duros: excepciones del recurso

- ✅ Lectura de `platform_resources.exceptions` acotada al rango `from…to` (índice `(resource_id, starts_at, ends_at)`).
- ✅ Las excepciones (`vacation`, `sick`, `training`, `holiday`, `other`) bloquean de forma dura: ningún slot que solape la excepción aparece en la respuesta, independientemente de la capacidad.
- ✅ Solapamiento evaluado con `rangesOverlap(aStart, aEnd, bStart, bEnd) = aStart < bEnd && bStart < aEnd` (intervalos semiabiertos).
- ❌ Excepciones creadas directamente desde el módulo de availability (hoy sólo a través de `platform/resources`).
- ❌ Bloqueos ad-hoc a nivel de tenant (p.ej. festivos nacionales aplicados globalmente a todos los recursos sin crear una excepción por recurso).
- ❌ Excepciones parciales de día (hoy las excepciones pueden solapar sólo parte de la ventana; pero no hay API para crear "mañana libre + tarde disponible" como un único objeto).

## 6. Citas existentes descuentan capacidad

- ✅ Lectura de `platform_bookings.bookings` JOIN `platform_bookings.booking_resources` para el recurso en el rango.
- ✅ Estados terminales excluidos: `cancelled`, `no_show`, `rescheduled`, `completed` no bloquean ni descuentan capacidad.
- ✅ Estados activos (`pending`, `confirmed`, …) descuentan del contador `remaining` de cada slot.
- ✅ Solapamiento evaluado con la misma función `rangesOverlap`.
- ❌ Distinción entre bookings `tentative` (confirmación pendiente de pago) y `confirmed` — hoy ambos descuentan por igual.

## 7. Capacidad de grupo / clases

- ✅ `capacity` en `platform_services.services` (número máximo de participantes por slot en el servicio).
- ✅ `capacity` en `platform_resources.resources` (capacidad física del recurso: sala, instructor, etc.).
- ✅ Capacidad efectiva del slot = `min(service.capacity, resource.capacity)` — garantiza que nunca se superan ni la capacidad del local ni la del servicio.
- ✅ `remaining = slotCapacity - count(consumidores solapantes)` — tanto bookings activos como holds activos se cuentan como consumidores.
- ✅ Slots con `remaining === 0` no aparecen en la respuesta (slot lleno).
- ✅ Slots con `remaining > 0` exponen ambos campos (`capacity`, `remaining`) para que el widget pueda mostrar "3 plazas libres".
- ❌ Lista de participantes por slot (quiénes están ya inscritos en un grupo/clase).
- ❌ Lista de espera (waitlist) integrada en el slot: cuando `remaining === 0`, ofrecer posición en cola — hoy `platform/bookings` gestiona waitlist pero no está integrada en el cómputo de disponibilidad.
- ❌ Capacidad mínima de grupo (no arrancar la clase si hay menos de N inscritos).

## 8. Holds atómicos en Redis/Postgres (reserva temporal durante checkout)

- ✅ `POST /v1/availability/holds` — crea un hold temporal para un recurso+servicio+slot.
- ✅ Atomicidad garantizada por SQL CTE `INSERT … WHERE NOT EXISTS (overlapping_holds) AND NOT EXISTS (overlapping_bookings)`: si dos peticiones llegan simultáneamente por el mismo slot, sólo una gana (la otra recibe `null` del repositorio → `ConflictError 409`).
- ✅ El hold incluye: `app_id`, `tenant_id`, `service_id`, `resource_id`, `starts_at`, `ends_at`, `client_user_id`, `expires_at`.
- ✅ `ttlSeconds` configurable en el body (1–3600 s); default 300 s (5 minutos).
- ✅ Al crear el hold se bumpa el `resourceVersionKey` en Redis → invalida inmediatamente el cache de slots de ese recurso.
- ✅ Evento `availability.held` publicado en `platform.events` tras un hold exitoso.
- ✅ El hold falla si ya existe un booking confirmado (no sólo otro hold) solapante — el INSERT NOT EXISTS chequea ambas tablas.
- ❌ Holds multi-recurso en una sola petición (para servicios que requieren sala + equipo + practitioner simultáneamente).
- ❌ Extensión del TTL de un hold existente sin liberarlo y recompetir.
- ❌ Transferencia de hold entre usuarios (p.ej. pase de cesta a otro miembro del grupo).
- ❌ Notificación al usuario cuando su hold está a punto de expirar (T-60s).

## 9. Liberación de holds

- ✅ `DELETE /v1/availability/holds/:id` — libera el hold por su UUID.
- ✅ Scoped por `(app_id, tenant_id)`: sólo puede liberar el hold el tenant que lo creó.
- ✅ Hold inexistente (o de otro tenant) → `NotFoundError 404`.
- ✅ Antes de borrar, el service lee el `resource_id` del hold para poder bumpear la versión correcta en Redis e invalidar el cache.
- ✅ Evento `availability.released` publicado en `platform.events`.
- ❌ Auto-liberación desde el frontend (hoy el ciclo normal es: `holdSlot` → pago → `bookings.create` → `releaseHold`; si el pago falla y el usuario cierra el navegador, el hold caduca por TTL, pero no hay callback).
- ❌ Liberación en lote (liberar todos los holds de un usuario o una sesión de checkout).

## 10. Expiración y purga de holds

- ✅ Purga opportunista dentro de `holdSlot`: al iniciar cada `holdSlot`, se borran los holds expirados del tenant antes de competir por el nuevo slot (reduce la ventana de hold fantasma en checkout).
- ✅ Purga proactiva vía `platform/scheduler` — job `availability-hold-purge` (cron `* * * * *`): borra de `platform_availability.holds WHERE expires_at <= now()` cada minuto, garantizando que los listings de slots ven slots limpios incluso con recursos ociosos sin tráfico.
- ✅ El hold expirado deja de bloquear: `getActiveHolds` filtra `expires_at > now()`, de modo que los slots del listing ya excluyen holds caducados sin esperar a la purga física.
- ❌ Hold expirado sin purgar físicamente puede seguir latente en la tabla (aunque invisible al cómputo); la purga del scheduler borra en masa y no emite evento por cada hold eliminado.
- ❌ Notificación al usuario/sistema cuando el hold expira sin haber completado el pago.
- ❌ Configuración del TTL por tenant (hoy es parámetro en el body con máximo 3600 s; no hay valor por defecto configurable en DB).

## 11. Filtro por recurso concreto

- ✅ `resourceId` en query string es opcional — si se proporciona, el cómputo filtra los recursos del servicio y sólo procesa el indicado.
- ✅ Si el `resourceId` no pertenece al servicio → array vacío (no error).
- ✅ Si no se proporciona → se computan y devuelven slots de todos los recursos activos vinculados al servicio (combinación en el mismo array).
- ❌ Filtro por tipo/kind de recurso (`practitioner` vs `room`) dentro del mismo servicio.
- ❌ Filtro por nombre o atributo de recurso (p.ej. "sólo fisioterapeutas que hablen inglés").
- ❌ Ordenación configurable de recursos (round-robin explícito, por carga, por preferencia del usuario).

## 12. Round-robin de asignación automática

- ❌ Ninguna lógica de round-robin implementada. La respuesta devuelve slots de todos los recursos sin preferir ni rotar. El cliente (portal o app) debe seleccionar el recurso antes de crear el hold.
- ❌ Asignación automática "cualquier recurso disponible" (el motor elige el recurso con menos carga).
- ❌ Afinidad usuario-recurso (preferir el practitioner que ya ha atendido al cliente).
- ❌ Reglas de asignación configurables por tenant (zona geográfica, idioma, especialidad).

## 13. Slots multi-recurso: intersección de disponibilidades

- 🔧 Capacidad efectiva = `min(service.capacity, resource.capacity)` — este modelo cubre servicios con un único recurso por slot (1:1) y clases de grupo con un solo recurso (1:N).
- ❌ Servicios que requieren simultáneamente más de un recurso (p.ej. sala + equipo + practitioner): el motor no computa la intersección de disponibilidades de varios recursos vinculados al mismo servicio. Cada recurso se calcula independientemente.
- ❌ Restricciones entre recursos (p.ej. la sala A sólo puede usar el proyector B).
- ❌ Servicegroups: un servicio que se desglosa en sub-slots con recursos distintos (parte teórica con sala + parte práctica con laboratorio).

## 14. Primer hueco disponible ("next available")

- ❌ No hay endpoint dedicado. El cliente debe llamar a `GET /v1/availability/slots` con un rango amplio y tomar el primer elemento de la respuesta.
- ❌ Búsqueda del primer hueco en rolling-forward (p.ej. "cuándo es lo antes que puedo reservar este servicio con cualquier practitioner").
- ❌ Parámetro `limit=1` + `nextAvailableOnly=true` para minimizar el cómputo y el tamaño de respuesta.

## 15. Antelación mínima y ventana máxima de reserva

- ❌ `lead_time_hours` (antelación mínima): no se implementa bloqueo de slots "demasiado próximos al momento actual". Si el servicio exige reserva con 24h de antelación y alguien pide slots de hoy, el motor devuelve los slots disponibles sin filtrar.
- ❌ `booking_window_days` (ventana máxima): el motor acepta cualquier rango `from…to` sin limitar cuánto al futuro se puede consultar.
- ❌ Ambas restricciones existen como campo en `platform_services.services` → `cancellation_policy JSONB`, pero el módulo de availability no las lee ni aplica.

## 16. Caché de resultados en Redis

- ✅ Clave de caché: `availability:slots:{appId}:{tenantId}:v{version}:{sig}` donde `version` es la concatenación de los contadores de versión por recurso y `sig` es un SHA-1 (16 chars) de los parámetros de la query.
- ✅ La versión por recurso se almacena en Redis como `availability:rv:{appId}:{tenantId}:{resourceId}` y se incrementa en cada `holdSlot` y `releaseHold` exitosos.
- ✅ Cache TTL: 60 segundos (constante `SLOT_CACHE_TTL_SECONDS`).
- ✅ Cache HIT: devuelve el JSON parseado sin ejecutar ninguna consulta a Postgres (work_hours, exceptions, bookings, holds).
- ✅ Cache MISS: computa y escribe en Redis con `SET ... EX 60`.
- ✅ Fallo de Redis (GET o SET) no propaga error — fall-through transparente al cómputo normal.
- 🔧 El TTL de 60 s es fijo: en entornos de alto volumen podría ser demasiado largo si hay muchos holds/releases; en entornos de bajo volumen podría ser innecesariamente corto.
- ❌ Caché configurable por tenant o por servicio (TTL variable).
- ❌ Invalidación de caché activa cuando se modifica un horario de trabajo o una excepción del recurso (hoy sólo se invalida ante holds/releases; un cambio de `work_hours` no bumpa la versión).
- ❌ Pre-warming de caché (calcular los slots del día siguiente durante la madrugada vía scheduler).

## 17. Multi-tenant y aislamiento

- ✅ RLS en `platform_availability.holds`: policy `USING (app_id = ... AND tenant_id = ...)`.
- ✅ Todas las queries del repositorio incluyen `app_id=$1 AND tenant_id=$2` como primeros parámetros.
- ✅ Las consultas cross-schema a `platform_services`, `platform_resources` y `platform_bookings` también incluyen scoping por `(app_id, tenant_id)`.
- ✅ Las claves de caché Redis incluyen `appId:tenantId` — no hay riesgo de colisión entre tenants.
- ✅ `sub_tenant_id` propagado en el contexto (`withTenantTransaction`) aunque la tabla de holds no lo indexa aún.
- ❌ `sub_tenant_id` no se almacena en `platform_availability.holds` — los holds de un sub-tenant (p.ej. una sucursal) no están aislados a ese nivel dentro del tenant.

## 18. Concurrencia y prevención de doble reserva

- ✅ `insertHoldAtomic` usa un CTE PostgreSQL: el INSERT sólo se ejecuta si no existe ninguna fila solapante en `overlapping_holds` ni en `overlapping_bookings`, todo dentro de una única transacción serializable.
- ✅ Solapamiento en la CTE evaluado con `tstzrange(starts_at, ends_at, '[)') && tstzrange($4, $5, '[)')` — operador nativo de Postgres, más robusto que una comparación de fechas manual.
- ✅ El `pool` usa `withTenantTransaction` que abre una transacción Postgres explícita, garantizando atomicidad read-then-write.
- ✅ Tests que simulan dos `holdSlot` concurrentes contra el mismo slot: sólo uno gana (mock del doble INSERT atómico).
- 🔧 El nivel de aislamiento de la transacción depende del `Pool` configurado en `platform-sdk/db` (probablemente `READ COMMITTED`). En `READ COMMITTED`, la CTE NOT EXISTS puede tener ventana de race condition en instancias de alta concurrencia — se debería usar `SERIALIZABLE` o un advisory lock.
- ❌ Advisory lock PostgreSQL sobre `(resource_id, starts_at)` como capa adicional de exclusión mutua en cargas extremas.

## 19. API pública para widgets de reserva (frontend)

- ✅ `GET /v1/availability/slots` — consumible desde el portal de reservas del cliente sin necesidad de lógica en frontend.
- ✅ Todos los endpoints están protegidos con el guard de identidad JWT (`appGuard` de `@apphub/platform-sdk`).
- 🔧 No se declara `schema: { tags, summary, … }` en las rutas con Fastify (faltan anotaciones OpenAPI) — la ruta no aparece en `/docs` del servicio platform-appointments.
- ❌ Endpoint público (sin JWT) para embeds o widgets de terceros que no requieren login (p.ej. botón "Reserva ahora" en la web del negocio).
- ❌ Paginación / cursor para respuestas grandes.
- ❌ Respuesta enriquecida con metadatos del servicio y del recurso (nombre, foto, precio) para evitar un segundo request desde el widget.
- ❌ SDK/helper en `@apphub/sdk-js` que encapsule la llamada a availability + hold + checkout en un flujo de 3 pasos.

## 20. Zona horaria y DST

- 🔧 El cómputo de slots funciona íntegramente en UTC. `start_minute` y `end_minute` en `work_hours` son minutos desde medianoche UTC. Si el tenant está en Europa/Madrid (UTC+1/+2 según DST), los horarios de trabajo deben ser configurados en UTC por el administrador, lo que puede resultar confuso.
- ❌ Campo `timezone` en `platform_resources.resources` o en `platform_tenants` para que `start_minute`/`end_minute` se interpreten en hora local.
- ❌ Ajuste automático de DST: si un horario de trabajo cubre la transición horaria (p.ej. 30 oct a las 3:00), los slots pueden quedar desalineados.
- ❌ Slots devueltos con `tzid` o como offset explícito en vez de puro UTC para que el cliente pueda presentarlos sin reinterpretación.

## 21. Disponibilidad en tiempo real vs cacheada

- ✅ Disponibilidad "casi en tiempo real" gracias al versionado por recurso en Redis: un hold invalida inmediatamente la clave de caché del recurso afectado.
- 🔧 Hasta que el cache invalida, puede haber hasta 60 s de staleness para lectores que ya tengan en caché la versión anterior (aunque la versión se bumpa, el cliente que ya tiene la versión N en su propia caché de red no se entera).
- ❌ WebSocket / Server-Sent Events para notificar al cliente cuando la disponibilidad de un slot cambia en tiempo real (p.ej. "este slot acaba de llenarse").
- ❌ Suscripción a `availability.held` / `availability.released` desde el frontend para refrescar la UI proactivamente.

## 22. Eventos publicados en platform.events

- ✅ `availability.held` — payload: `{ appId, tenantId, holdId, serviceId, resourceId, startsAt, endsAt, expiresAt }`.
- ✅ `availability.released` — payload: `{ appId, tenantId, holdId }`.
- ❌ `availability.hold_expired` — ningún evento se emite cuando un hold caduca (ni la purga del scheduler ni la purga opportunista emiten evento).
- ❌ `availability.slots_updated` — ningún evento ante cambio en `work_hours` o `exceptions` que invalide el cómputo de slots.
- ❌ Los eventos son publicados vía `sdkPublish` en el canal `platform` (no `platform.events` con namespace por módulo). El router del subscriber necesita distinguirlos por `event.type`.

## 23. Rendimiento y escalabilidad

- ✅ Lectura de `exceptions` y `bookings` acotada al rango `from…to` (índices en `starts_at/ends_at`).
- ✅ Caché Redis con TTL de 60 s reduce la carga de Postgres en escenarios de booking widget de alto tráfico.
- 🔧 El cómputo en memoria es O(días × recursos × slots/día): para un servicio con 20 recursos, 30 días y step 15 min, puede generar decenas de miles de iteraciones en una sola petición sin caché.
- 🔧 No hay límite de rango en el endpoint — un cliente malicioso podría pedir 365 días × 50 recursos y saturar el servidor.
- ❌ Caché distribuida compartida entre instancias (hoy la caché Redis ya lo es, pero la versión de recurso se gestiona con INCR atómico — correcto).
- ❌ Pre-cómputo nightly: materializar los slots del día/semana siguiente para los recursos más solicitados vía scheduler.
- ❌ Rate limiting por tenant en el endpoint `GET /v1/availability/slots`.

## 24. Observabilidad y operación

- ✅ Log de inicio del módulo con `logger.info('availability module ready')`.
- ✅ Endpoint `GET /api/availability/health` (público, sin auth) — responde `{ status: 'ok', module: 'availability', timestamp }`.
- ✅ El job `availability-hold-purge` loguea `{ rowCount }` cuando elimina filas.
- ❌ Métricas de negocio: tasa de conversión hold → booking, holds expirados sin convertir, tiempo medio de checkout.
- ❌ Alertas operativas: holds acumulados > N sin ser liberados (posible bug en el ciclo de checkout).
- ❌ Trazas distribuidas (correlation ID entre `holdSlot` → `bookings.create` → `payments.charge`).
- ❌ Dashboard admin con disponibilidad en tiempo real de los recursos del tenant (vista de agenda/calendario para el backoffice).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Anotaciones OpenAPI en rutas** — `schema: { tags, summary, body, params }` en `availability.routes.js`: coste mínimo, desbloquea `/docs` y generación de cliente tipado.
2. **Antelación mínima y ventana máxima** (`lead_time_hours`, `booking_window_days`) — REUSE del campo `cancellation_policy` de `platform_services` o columnas nuevas; el filtro en el service es trivial (2–5 líneas). Valor alto: evita bookings de último minuto no gestionables.
3. **Invalidación de caché ante cambios de `work_hours`/`exceptions`** — REUSE del evento `platform.events`; cuando `platform/resources` publica `resource.updated`, el handler en availability bumpa las versiones de todos los recursos afectados.
4. **Zona horaria por tenant/recurso** — añadir `timezone TEXT` en `platform_resources.resources`; ajustar `workingWindows` para convertir `start_minute`/`end_minute` desde hora local a UTC. Crítico para tenants fuera de UTC.
5. **Endpoint "next available"** — `GET /v1/availability/next?serviceId=…&after=…` con rolling-forward limitado (p.ej. máximo 90 días): reduce el número de llamadas del widget de booking de N a 1.
6. **Nivel de aislamiento SERIALIZABLE o advisory lock** en `insertHoldAtomic` para eliminar el race condition residual en alta concurrencia (especialmente relevante para sistemas de venta de entradas o clases populares).
7. **Evento `availability.hold_expired`** desde la purga del scheduler — permite cerrar el ciclo de checkout abandonado (REUSE `platform/notifications` para avisar al usuario).
8. **Endpoint público sin JWT** (o con token de widget firmado) para embeds de terceros — permite el CTA "Reserva ahora" en la web del negocio sin requerir que el visitante esté autenticado.
9. **Servicio multi-recurso (intersección)** — diseño más complejo; justificado cuando al menos un app necesita reservar sala + equipo + practitioner de forma atómica en un solo slot.
10. **Pre-warming nightly** vía scheduler — job que computa y cachea los slots del día siguiente para los recursos más consultados, reduciendo latencia de cold-start matutino.
