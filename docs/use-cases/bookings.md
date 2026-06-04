# Casos de uso — `platform/bookings` (platform-appointments)

> **Dominio:** reservas de cita individual y clases/eventos con cupo — FSM de la cita, recurrencia, reprogramación, waitlist.
>
> **Frontera con `platform/reservations`:** `platform/reservations` gestiona reservas de mesas en restaurantes (floor-plan, covers, walk-in, lista de espera de hostelería). `platform/bookings` gestiona citas de servicios profesionales: consultas médicas, sesiones de fisioterapia, clases de yoga, entrenamientos personales, convocatorias formativas, etc. Las dos tablas y los dos módulos son completamente independientes y no se solapan.

## Estado actual (implementado)

FSM de nueve estados con tabla `booking_events` de auditoría; creación en dos modalidades (cita individual con guard de recurso atómico / inscripción a evento/sesión con chequeo de capacidad); hold atómico de slot vía `platform/availability`; recurrencia RRULE-ish en tabla `recurrences`; reprogramación copy-on-write que clona el booking; política de cancelación JSONB con gracia, ventana libre, fee porcentual o flat; waitlist con estados `waiting → notified → booked/expired/cancelled`; recordatorios T-24h y T-2h con columnas de idempotencia; suscriptor de evento `service.session.cancelled` que cancela inscripciones en masa; `locale` por booking; soporte de `session_id` para eventos; RLS por `(app_id, tenant_id)` en todas las tablas.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Creación de cita individual (autoservicio del cliente)

- ✅ `POST /v1/bookings` con `serviceId + resourceIds + startsAt + endsAt` — Zod-validado, `endsAt > startsAt` comprobado.
- ✅ Guard atómico de recurso: `WITH overlapping AS (…) INSERT … WHERE NOT EXISTS (overlapping)` — devuelve 409 si el slot ya está ocupado por una booking activa.
- ✅ Hold atómico previo: el cliente llama a `POST /v1/availability/holds` y pasa `holdId`; la creación consume el hold dentro de la misma transacción (validando ventana, recurso y servicio). Previene race conditions entre dos clientes concurrentes.
- ✅ `source` enum: `portal | phone | staff | partner | recurrence` — distingue el canal de origen.
- ✅ `clientUserId` del JWT cuando no se especifica en el body.
- ✅ `locale` por booking — el recordatorio usa el idioma del cliente, con fallback al `default_locale` del tenant y luego `'es'`.
- ✅ Evento `booking.requested` publicado en `platform.events` tras crear.
- ❌ Validación de solapamiento desde el punto de vista del **cliente** (un cliente no puede tener dos citas simultáneas en servicios distintos).
- ❌ Depósito/prepago obligatorio al reservar (REUSE `platform/payments` o `platform/splitpay` — actualmente `priceCents` se guarda pero no se cobra).
- ❌ Consumo de bono/paquete en el momento de reserva (`packageId` existe en el schema pero no hay lógica de deducción de sesiones — REUSE `platform/packages`).
- ❌ Selección interactiva de slot libre (la disponibilidad se calcula en `platform/availability`; bookings no expone un endpoint combinado slot-picker + create).
- ❌ Limit de reservas simultáneas por cliente por tenant (política configurable).

## 2. Inscripción a evento / convocatoria (session booking)

- ✅ `POST /v1/bookings` con `sessionId` — la ventana, `service_id`, precio y `resource_id` se derivan automáticamente de la `service_session` leída desde `platform_services`.
- ✅ Validaciones: session `status='scheduled'`, `registration_closes_at` no superada, `starts_at` no pasado.
- ✅ Validación de kind del servicio: sólo acepta `kind='event'`.
- ✅ Guard de capacidad: `countBookingsForSession(…) >= capacity → 409` dentro de la transacción (capacidad en session o fallback al service).
- ✅ Capacidad de override: el caller puede pasar `resourceIds` explícitos; en su defecto se usa `session.resource_id`; si no hay ninguno, no se adjunta recurso (eventos sin sala).
- ✅ La booking queda en estado `confirmed` directamente (eventos suelen auto-confirmar al inscribirse).
- ✅ Evento `booking.confirmed` con `sessionId` en el payload.
- ✅ Suscriptor `service.session.cancelled`: cuando `platform/services` emite `service.session.cancelled`, el handler cancela masivamente todas las bookings activas de esa sesión, registra `booking_events` por cada una y emite `booking.cancelled` por cada inscrito (para que `platform/notifications` avise a los afectados). Bypass de cancellation policy — la cancela el sistema, no el cliente.
- ❌ Lista de inscritos accesible al staff directamente desde el módulo de bookings (existe el filtro `GET /v1/bookings?sessionId=…` pero no hay un endpoint dedicado `/v1/bookings/sessions/:id/attendees`).
- ❌ Exportación de lista de asistentes (CSV/PDF).
- ❌ Check-in masivo de asistentes a un evento.
- ❌ Lista de espera específica para sesiones llenas (la waitlist existe pero es por servicio, no por sesión).

## 3. Creación de cita por staff

- ✅ Staff puede pasar `clientUserId` distinto al suyo propio (campo explícito en body).
- ✅ `source: 'staff'` para distinguir reservas realizadas por personal.
- ✅ `internalNotes` — notas internas sólo visibles a staff.
- ✅ Al cancelar: `opts.skipPolicy=true` + `role in [staff, super_admin]` → bypass de cancellation policy (feeCents=0). Un usuario con `role=user` no puede hacer self-bypass.
- ❌ Creación de cita sin cliente específico (walk-in o bloqueo de agenda sin paciente/socio asignado — "block booking").
- ❌ Vista de agenda del staff para arrastrar/soltar citas (el backend soporta update de ventana vía reschedule pero no hay bulk-update).
- ❌ Permisos granulares: staff sólo puede crear/editar bookings de sus propios clientes o de su sub-tenant (hoy RLS sólo es por tenant, no por recurso asignado).

## 4. FSM — máquina de estados de la cita

- ✅ Nueve estados: `requested → confirmed → reminded → checked_in → in_progress → completed | cancelled | no_show | rescheduled`.
- ✅ Transiciones implementadas y validadas:
  - `requested` → `confirmed | cancelled | rescheduled`
  - `confirmed` → `reminded | checked_in | cancelled | no_show | rescheduled`
  - `reminded` → `checked_in | cancelled | no_show | rescheduled`
  - `checked_in` → `in_progress | cancelled | no_show`
  - `in_progress` → `completed | cancelled`
  - `completed | cancelled | no_show | rescheduled` → (terminales)
- ✅ `PATCH /v1/bookings/:id/status` con Zod enum en body; 409 en transición prohibida.
- ✅ Evento Redis `booking.<toStatus>` en cada transición con `serviceId`, `clientUserId`, `startsAt`, `endsAt`, `resourceIds`.
- ✅ Audit log completo en `booking_events`: `from_status`, `to_status`, `actor_user_id`, `reason`, `ts`.
- ❌ Transición `no_show → rescheduled` (podría ser útil cuando el cliente da señales de vida tarde — hoy `no_show` es terminal).
- ❌ Reversión `cancelled → requested` para cancelaciones por error administrativo (con constraint de no-reversión de política aplicada).
- ❌ Cooldown mínimo entre transiciones (p.ej. no marcar `completed` si la cita no ha empezado aún según el reloj).

## 5. Confirmación y hold de slot

- ✅ Hold previo con `POST /v1/availability/holds` (módulo `platform/availability`) + consumo atómico en `createBooking` con `holdId`.
- ✅ Validación triple del hold: ventana, recurso, servicio — 409 si no coincide o expirado.
- ✅ Defence in depth: incluso con hold válido se ejecuta el overlap-guard del INSERT para capturar bookings creadas por `recurrence-expander` que bypasaron el hold flow.
- ✅ GRANT cruzado `svc_platform_bookings` → `SELECT, DELETE ON platform_availability.holds` — migración 0003 tolerante a orden de ejecución.
- ❌ Notificación automática de confirmación al cliente vía email/push tras pasar de `requested` a `confirmed` (el evento se publica; `platform/notifications` debe suscribirse — no hay suscriptor integrado en este módulo).
- ❌ Tiempo máximo de confirmación configurable (si no se confirma en N horas → auto-cancelar → liberar slot vía scheduler).

## 6. Reprogramación (reschedule)

- ✅ `POST /v1/bookings/:id/reschedule` — patrón copy-on-write:
  1. Marca el booking original como `rescheduled` (libera su slot).
  2. Inserta un nuevo booking con `status=confirmed`, `parentBookingId=<original>`, misma información del cliente, mismos recursos, nuevo `startsAt/endsAt`.
  3. Copia los recursos del original al clon.
  4. Registra dos `booking_events`: original `from→rescheduled` + clon `null→confirmed`.
  5. Publica `booking.rescheduled` con `oldBookingId + newBookingId + startsAt + endsAt`.
- ✅ Validaciones: `endsAt > startsAt`; no permite reschedule si `status in [cancelled, no_show, completed, rescheduled]` → 409.
- ✅ El nuevo booking creado en reschedule pasa por el guard atómico de recursos (`insertBookingAtomic`) cuando tiene recursos: un reschedule sobre un slot ya ocupado devuelve 409. Sólo cae al `insertBooking` legacy cuando la booking no tiene recursos (eventos sin sala, donde el guard por recurso no aplica). Los recursos del original se leen antes de marcarlo `rescheduled` para que el guard vea el slot como liberado.
- ❌ Reglas de reschedule configurable por servicio (p.ej. sólo se puede reprogramar con ≥24h de antelación, máximo N reprogramaciones por booking, fee de reprogramación).
- ❌ Reschedule iniciado por el cliente vs por el staff con distintas restricciones.
- ❌ Notificación automática al cliente/practitioner del cambio de horario (el evento se publica; la lógica debe estar en `platform/notifications`).
- ❌ Historial de reprogramaciones agrupado por cadena `parentBookingId` expuesto como endpoint.

## 7. Cancelación y política de cancelación

- ✅ `POST /v1/bookings/:id/cancel` con `reason` opcional.
- ✅ Política de cancelación leída del campo `cancellation_policy JSONB` del servicio (cross-schema GRANT `svc_platform_bookings → platform_services`).
- ✅ Lógica de evaluación de fee (`evaluateCancellationFee`):
  - `graceMinutesAfterCreate`: sin cargo si se cancela en los N primeros minutos tras reservar.
  - `freeUpToMinutes`: sin cargo si se cancela con suficiente antelación.
  - `feePercent`: cargo proporcional al `price_cents` (prioridad sobre `feeFlatCents`).
  - `feeFlatCents`: cargo fijo alternativo.
  - Sin ninguna de las anteriores: `feeCents=0`.
- ✅ Dos eventos publicados cuando hay fee: `booking.cancelled` (con `feeCents + feeReason`) + `booking.fee.charged` (con `reason: 'late_cancellation'`) — `platform/payments` / `platform/splitpay` deben suscribirse para ejecutar el cobro real.
- ✅ Bypass de política para `staff / super_admin` con `opts.skipPolicy=true` — sin cargo.
- ✅ Protección anti-bypass: un `role=user` que pase `skipPolicy=true` NO omite la política.
- 🔧 El cobro real de la penalización no está implementado en este módulo — sólo se publica el evento. No hay integración activa con `platform/payments` ni `platform/splitpay` para ejecutar el cargo.
- ❌ Devolución (refund) proporcional al cancelar una cita pagada sin penalización — el evento de cancelación incluye `feeCents` pero no incluye el `paymentIntentId` necesario para el reembolso.
- ❌ Política de cancelación configurable por tenant desde el admin (hoy vive en el JSON del servicio en `platform_services`).
- ❌ Cancelación masiva de bookings futuras de un cliente (p.ej. baja del socio).

## 8. Recurrencia (citas periódicas)

- ✅ Tabla `platform_bookings.recurrences` con `rrule JSONB` (subconjunto RFC-5545), `starts_on`, `ends_on` y `count`.
- ✅ Campo `recurrence_id` en bookings para agrupar todas las instancias de una serie recurrente.
- ✅ Job `booking-recurrence-expander` en `platform-scheduler` (cada hora) — materializa instancias futuras de bookings recurrentes 30 días por adelantado.
- ✅ Campo `source: 'recurrence'` para identificar bookings creadas por el expander.
- ✅ Rutas REST de recurrences expuestas: `POST /v1/bookings/recurrences` (crea la serie), `GET /v1/bookings/recurrences` (lista por tenant) y `GET /v1/bookings/recurrences/:id` (detalle). El scheduler sigue consumiendo la tabla; ahora el staff puede crear/consultar series vía API.
- ❌ Editar una sola instancia de la serie ("este y siguientes" vs "solo este" vs "todos") — patrón RFC-5545 `EXDATE` / `DTSTART` amendment.
- ❌ Cancelación de toda la serie desde un endpoint único.
- ❌ Vista agrupada de series recurrentes en la UI de admin.
- ❌ Recurrencia para inscripciones a sesiones de eventos (actualmente la recurrencia es para citas individuales, no para eventos con `session_id`).

## 9. Waitlist (lista de espera)

- ✅ Tabla `platform_bookings.waitlist` con estados `waiting → notified → booked | expired | cancelled`.
- ✅ `POST /v1/bookings/waitlist` — alta en waitlist con `serviceId`, `resourceId` opcional, `preferredWindow JSONB` opcional.
- ✅ `GET /v1/bookings/waitlist` — listado filtrado por `serviceId` y/o `status`.
- ✅ `POST /v1/bookings/waitlist/:id/notify` — marca entrada como `notified`, publica `booking.waitlist.notified` con `clientPhone` (para que `platform/notifications` envíe SMS/push).
- ✅ `clientUserId` del body o fallback a `ctx.userId`; admin puede enrolar a un tercero.
- ✅ Evento `booking.waitlist.added` publicado al alta.
- ✅ Promoción automática de waitlist → oferta de hueco: el subscriber `events/waitlist-promotion.handler.js` reacciona a `booking.cancelled` y `booking.rescheduled`, busca la entrada `waiting` más antigua del mismo `serviceId` (y `resourceId` liberado; entradas sin recurso son elegibles para cualquier hueco del servicio) y la promueve a `notified`, publicando `booking.waitlist.notified`. La promoción es atómica (`promoteOldestWaiting` con `FOR UPDATE SKIP LOCKED`) para no ofrecer el mismo hueco dos veces. Los payloads de cancelación/reprogramación se enriquecieron con `serviceId` + `resourceIds` para el matching. El cliente sigue creando la booking real por su cuenta (no auto-reserva).
- ❌ Límite de tiempo en la oferta de hueco (p.ej. si el cliente no responde en 2h, pasar al siguiente de la lista).
- ❌ Prioridad configurable en la lista de espera (FIFO estricto, VIP, antigüedad de socio).
- ❌ Waitlist por `session_id` (para eventos llenos, no sólo por servicio genérico).
- ❌ Auto-expiración de entradas `waiting` pasada la fecha del servicio (REUSE `platform/scheduler`).

## 10. Recordatorios automáticos (REUSE scheduler + notifications)

- ✅ Columnas `reminder_24h_sent_at` y `reminder_2h_sent_at` en `bookings` con índices parciales para selección eficiente.
- ✅ Job `booking-reminders` en `platform-scheduler` (`*/5 * * * *`) — publica `booking.reminder.due` para bookings en `confirmed | reminded` con T-24h y T-2h no enviados; stampa las columnas en la misma transacción para idempotencia.
- ✅ `locale` per booking — el payload del evento lleva el idioma del cliente para que `platform/notifications` localice la plantilla.
- ✅ Estado `reminded` en la FSM — el scheduler puede avanzar la booking de `confirmed → reminded` al enviar el primer recordatorio.
- ❌ Recordatorio configurable por tenant (ventanas y canales — hoy T-24h/T-2h son hardcoded en el scheduler).
- ❌ Recordatorio al practitioner/staff asignado (hoy sólo se avisa al cliente).
- ❌ Recordatorio de confirmación pendiente (si el booking lleva N horas en `requested` sin confirmar → aviso al staff).
- ❌ Recordatorio de follow-up post-cita (REUSE `platform/scheduler` — ver sección 16).

## 11. Check-in y sala de espera

- ✅ Transición `confirmed | reminded → checked_in` disponible en la FSM.
- ✅ Transición `checked_in → in_progress` disponible.
- ❌ Endpoint de check-in con QR/código corto (el cliente escanea → `PATCH /v1/bookings/:id/status` con `checked_in`).
- ❌ Vista de sala de espera en tiempo real (lista de bookings `checked_in` del día por recurso/practitioner, ordenadas por `starts_at`).
- ❌ Notificación push/pantalla al practitioner cuando el cliente hace check-in.
- ❌ Auto-check-in por geofence o integración con lector NFC.

## 12. Intake forms previos a la cita (REUSE intake-forms)

- ❌ Asociación de intake form a una booking (`intakeFormId` en `metadata JSONB` de forma libre hoy).
- ❌ Envío automático de intake form al confirmar la booking (evento `booking.confirmed` → `platform/intake-forms` crea la solicitud).
- ❌ Bloqueo de transición a `in_progress` si el intake form obligatorio no está completo.
- ❌ Acceso al intake form desde el detalle de la booking para el practitioner.

## 13. Citas de grupo y clases (capacidad > 1)

- ✅ Inscripción a sesiones con capacidad N vía `session_id` (control de aforo en `countBookingsForSession`).
- ✅ Soporte de `capacity` en `service_sessions` con fallback a `services.capacity`.
- 🔧 El listado de inscritos a una sesión concreta requiere `GET /v1/bookings?sessionId=…` — no hay endpoint dedicado para el staff que muestre nombre, estado y datos de contacto.
- ❌ Booking de grupo para citas individuales con varios clientes en el mismo slot (p.ej. pareja de fisioterapia) — hoy sería una booking por cliente.
- ❌ Reagrupación de clientes dispersos en la misma sesión desde el panel admin.

## 14. Asignación y reasignación de practitioner / recurso

- ✅ `booking_resources` vincula N recursos (practitioners, salas, equipos) a cada booking.
- ✅ Los recursos se copian al clonar en reschedule.
- ❌ Reasignación de practitioner sin cancelar la cita (PATCH de recursos de una booking activa).
- ❌ Notificación al nuevo practitioner asignado.
- ❌ Vista "mis citas de hoy" filtrada por practitioner (recurso) — se puede construir con `GET /v1/bookings?resourceId=…` pero no existe endpoint semántico.
- ❌ Disponibilidad del practitioner consultada en tiempo real al reasignar (REUSE `platform/availability`).

## 15. Prevención de doble reserva y solapamiento

- ✅ Guard atómico de recurso con `tstzrange(starts_at, ends_at, '[)') && …` en el INSERT de bookings individuales — el INSERT falla si hay solapamiento activo para el mismo recurso.
- ✅ Defence in depth: el overlap-guard corre incluso cuando hay hold válido.
- ✅ Estados excluidos del guard: `cancelled | no_show | rescheduled | completed` — los slots liberados quedan disponibles inmediatamente.
- ✅ El guard corre en reschedule (usa `insertBookingAtomic` cuando hay recursos).
- ✅ Guard de doble inscripción del mismo cliente a la misma sesión: check explícito `clientAlreadyEnrolled` en `createBookingForSession` (409) + índice único parcial `uq_platform_bookings_session_client_active` sobre `(app_id, tenant_id, session_id, client_user_id)` para inscripciones vivas (defensa en profundidad ante carreras).
- ❌ Detección de solapamiento desde la perspectiva del cliente (dos citas en distintos servicios a la misma hora).

## 16. Historial del cliente y vista 360º

- ✅ `GET /v1/bookings?clientUserId=…` — listado de todas las citas de un cliente en el tenant, filtrable por ventana de fechas y estado.
- ✅ `GET /v1/bookings/:id` — detalle con `resourceIds` y `events` (historial de transiciones de estado con actor y reason).
- ✅ `parentBookingId` permite reconstruir la cadena de reprogramaciones.
- ❌ Endpoint de historial de series recurrentes agrupado por `recurrence_id`.
- ❌ Estadísticas del cliente: total de citas, asistencia, no-shows, cancelaciones, gasto acumulado.
- ❌ Exportación del historial del cliente (CSV para RGPD/portabilidad).

## 17. Follow-up y reseña post-cita (REUSE reviews + scheduler)

- ❌ Job de follow-up post-cita (REUSE `platform/scheduler`) — al pasar a `completed`, programar envío de encuesta/reseña N horas después.
- ❌ Integración con `platform/reviews`: solicitud de reseña automática al cliente tras la cita completada — evento `booking.completed` → `platform/reviews` crea solicitud pendiente.
- ❌ Link directo en el email de follow-up a la vista de reseña del servicio.

## 18. Pago y cobro al reservar (REUSE payments + splitpay + packages)

- ✅ Campos `price_cents`, `currency`, `package_id` en el schema de bookings.
- ✅ Evento `booking.fee.charged` publicado con `feeCents` y `currency` — la integración de pago real debe implementarse en `platform/payments` o `platform/splitpay`.
- ❌ Cobro real del depósito/totalidad al crear la booking (REUSE `platform/payments`: crear PaymentIntent, adjuntar `bookingId`).
- ❌ Consumo de sesiones de bono al reservar (REUSE `platform/packages`: `deductSession(packageId)` dentro de la tx de creación — `package_id` existe en la booking pero sin lógica de deducción).
- ❌ Reembolso proporcional al cancelar sin penalización (REUSE `platform/splitpay` — evento `booking.cancelled` con `feeCents=0` no incluye `paymentIntentId`).
- ❌ Split de pago entre practitioner y plataforma/tenant (REUSE `platform/splitpay`).
- ❌ Pago aplazado: reserva gratis → cobro el día de la cita → confirmación automática.

## 19. Comisiones al practitioner (REUSE practitioner-payouts)

- ❌ Acumulación de comisión al pasar a `completed` (evento `booking.completed` → `platform/practitioner-payouts` acumula el porcentaje del practitioner).
- ❌ Reversión de comisión al cancelar con fee (el fee va al tenant; el practitioner pierde la comisión acumulada).
- ❌ Informe de citas atendidas por practitioner para el cálculo de nómina/liquidación.

## 20. Telehealth — sala virtual (REUSE telehealth)

- ❌ Asociación de sala de vídeo a una booking (evento `booking.confirmed` → `platform/telehealth` provee room + tokens).
- ❌ Campo `telehealth_room_id` en `metadata JSONB` de la booking (actualmente libre).
- ❌ Botón "Unirse a la consulta" visible N minutos antes de `starts_at` (lógica de disponibilidad de la sala).
- ❌ Auto-cierre de sala al pasar a `completed` o `cancelled`.

## 21. Eventos Redis publicados

- ✅ `booking.requested` — al crear con `status='requested'`.
- ✅ `booking.confirmed` — al confirmar (directo desde create o vía changeStatus).
- ✅ `booking.reminded` — al marcar `reminded`.
- ✅ `booking.checked_in` — al hacer check-in.
- ✅ `booking.in_progress` — al iniciar la sesión.
- ✅ `booking.completed` — al completar.
- ✅ `booking.cancelled` — al cancelar (incluye `feeCents`, `feeReason`, contacto del cliente).
- ✅ `booking.no_show` — al marcar no-show.
- ✅ `booking.rescheduled` — al reprogramar (incluye `oldBookingId`, `newBookingId`).
- ✅ `booking.fee.charged` — cuando `feeCents > 0` al cancelar.
- ✅ `booking.waitlist.added` — al añadir a waitlist.
- ✅ `booking.waitlist.notified` — al notificar a un cliente de waitlist.
- ❌ `booking.reminder.due` suscripción en este módulo (lo gestiona el scheduler; `platform/notifications` debe suscribirse).
- ❌ `booking.session.completed` (evento específico para cerrar todos los inscritos de una sesión cuando el staff la marca completada desde `platform/services`).

## 22. Multi-tenant y aislamiento de datos

- ✅ RLS habilitada y forzada en `bookings`, `booking_resources`, `recurrences`, `booking_events`, `waitlist` — política `(app_id, tenant_id)` via `current_setting`.
- ✅ `sub_tenant_id` soportado y propagado (nullable — soporta tenants de un solo nivel y de dos niveles).
- ✅ `withTenantTransaction` de `@apphub/platform-sdk` inyecta los `current_setting` antes de cada query.
- ✅ Índices compuestos `(tenant_id, starts_at)` y `(tenant_id, status, starts_at)` para eficiencia en tenants con mucho volumen.
- ❌ Sub-tenant scoping en listado: `GET /v1/bookings` filtra sólo por `tenant_id` — no hay filtro por `sub_tenant_id` para staff de una rama concreta.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ✅ ~~**Promoción automática de waitlist → booking al cancelar**~~ (subscriber `waitlist-promotion.handler.js` reacciona a `booking.cancelled`/`booking.rescheduled`, promueve la entrada `waiting` más antigua del `serviceId/resourceId` a `notified` con `FOR UPDATE SKIP LOCKED` y publica `booking.waitlist.notified`).
2. **Cobro real al reservar** (REUSE `platform/payments`: `booking.confirmed` → PaymentIntent) + **consumo de sesiones de bono** (REUSE `platform/packages`: deducción en `createBooking` tx) — monetización bloqueada hoy; los campos ya están en el schema. *(cross-cutting: requiere payments/packages — fuera de alcance backend-only de bookings).*
3. ✅ ~~**Fix del overlap-guard en reschedule**~~ (el clon usa `insertBookingAtomic` cuando hay recursos → 409 si el slot destino está ocupado; fallback a `insertBooking` legacy sólo sin recursos).
4. ✅ ~~**Exposición del endpoint de recurrencias**~~ (`POST/GET /v1/bookings/recurrences` + `GET /v1/bookings/recurrences/:id`).
5. ✅ ~~**Guard de doble inscripción por cliente en la misma sesión**~~ (check `clientAlreadyEnrolled` en `createBookingForSession` → 409 + índice único parcial `uq_platform_bookings_session_client_active`).
6. **Integración con `platform/intake-forms`** — al confirmar, solicitar el formulario previo; bloquear `in_progress` si está pendiente de firma.
7. **Follow-up post-cita** (REUSE `platform/scheduler` + `platform/reviews`) — `booking.completed` → programa solicitud de reseña T+Nh.
8. **Comisiones al practitioner** (REUSE `platform/practitioner-payouts`) — `booking.completed` → acumulación; `booking.fee.charged` → ajuste.
9. **Acumulación de comisión al pasar a `completed`** y **asociación de sala de telehealth** (REUSE `platform/telehealth`) — baja complejidad si los módulos ya están operativos.
10. **Recordatorio configurable por tenant** — mover las ventanas T-24h/T-2h del scheduler a configuración por tenant vía `platform/tenant-config`.
