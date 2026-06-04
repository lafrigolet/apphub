# Casos de uso — `platform/reservations` (platform-restaurant)

> **Dominio**: reservas de mesa en restaurante + waitlist presencial. Cubre el ciclo completo
> desde la petición del comensal hasta la liberación de la mesa (cubiertos, turnos, horarios de
> servicio, bloqueos, lista de espera).
>
> **Frontera con `platform/bookings`**: `reservations` es exclusivo del dominio restaurante
> (mesas, cubiertos, turnos de comida/cena, walk-ins, plano de sala vía `platform/floor-plan`).
> `bookings` pertenece al dominio de citas/appointments (servicios profesionales: consultas
> médicas, clases, talleres, sesiones de peluquería, etc.). Aunque ambos modelan "una persona
> reserva un recurso en un momento dado", los conceptos son distintos: cubiertos ≠ citas, turno
> gastronómico ≠ disponibilidad de recurso humano. No deben fusionarse.

## Estado actual (implementado)

Tablas `reservations`, `waitlist`, `service_hours` y `blackouts` con RLS `(app_id, tenant_id)`.
FSM `requested → confirmed → seated → completed | cancelled | no_show`. Columnas de idempotencia
para recordatorios T-24h y T-2h (`reminder_24h_sent_at`, `reminder_2h_sent_at`). Soporte de
`locale` por reserva. Canales de entrada: `portal`, `phone`, `walk_in`, `partner`.
Eventos Redis: `reservation.created`, `reservation.<status>`, `waitlist.added`,
`waitlist.notified`. Job `reservation-reminders` en `platform-scheduler`. Integración con
`platform/floor-plan` vía `table_id` (FK lógica, sin FK referencial inter-esquema).

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Crear reserva (canal portal / teléfono / walk-in / partner)

- ✅ Alta con `guest_name`, `guest_email` (opc.), `guest_phone` (opc.), `party_size`, `reserved_for`, `duration_minutes` (default 90 min), `table_id` (opc.), `notes` (opc.), `source`, `locale` (opc.).
- ✅ Vinculación opcional al usuario autenticado (`guest_user_id` desde JWT `sub`).
- ✅ Canales de entrada: `portal`, `phone`, `walk_in`, `partner`.
- ✅ Estado inicial `requested` (requiere confirmación explícita por el local).
- ✅ Evento `reservation.created` publicado en `platform.events`.
- ❌ Creación anónima sin JWT (widget público embebable en la web del restaurante).
- ❌ Integración con Google Reserve / TheFork / OpenTable como canal `partner`.
- ❌ Reserva desde QR en mesa (escanear → reservar para la próxima visita).
- ❌ Reserva telefónica asistida: interfaz optimizada para hostess que toma datos al teléfono.

## 2. Disponibilidad de turnos y control de aforo

- ✅ Tabla `service_hours` con `day_of_week`, `open_minute`, `close_minute`, `service_label` (ej. "Comida", "Cena"), `is_closed`.
- ✅ Tabla `blackouts` con rango `starts_at / ends_at` y `reason` (festivos, eventos privados, cierre excepcional).
- ✅ `service_hours` define cuándo se puede reservar y `createReservation` valida `reserved_for` contra los horarios abiertos del día (rechaza fuera de servicio con 409). Walk-ins omiten la validación; tenants sin `service_hours` configurados para ese día = sin restricción (opt-in).
- ✅ Configuración de aforo máximo por turno (`max_covers` por franja horaria en `service_hours`).
- ✅ Verificación de disponibilidad real al crear reserva: suma de cubiertos activos (`requested|confirmed|seated`) cuya ventana solapa, rechaza si `usados + party_size > max_covers`.
- ✅ Endpoint público `GET /v1/reservations/availability?date=…&partySize=N` — devuelve franjas abiertas del día con `coversUsed` / `coversRemaining` / `available`.
- ❌ Turnos con slots de inicio fijo (ej. comidas solo a las 13:00, 13:30, 14:00, 14:30).
- ❌ Overbooking controlado: porcentaje de sobreasignación configurable por turno.
- ❌ Configuración de duración estimada por tamaño de grupo (2 pax = 75 min, 6 pax = 120 min).

## 3. Asignación de mesa (integración con `platform/floor-plan`)

- ✅ Campo `table_id` en `reservations` (UUID que referencia `platform_floor_plan.tables`).
- ✅ `table_id` se puede asignar al crear o al confirmar (`PATCH /status` acepta `tableId`).
- 🔧 La asignación es manual: no hay motor de asignación automática.
- ❌ Auto-asignación: dado `party_size`, seleccionar la mesa de menor capacidad ≥ N que esté libre en el tramo `[reserved_for, reserved_for + duration_minutes]`.
- ❌ Vista de plano de sala con mesas coloreadas por estado (libre / reservada / ocupada) en tiempo real.
- ❌ Combinación de mesas contiguas para grupos grandes.
- ❌ Preferencias de mesa: terraza, interior, junto a ventana, lejos de cocina, accesible.
- ❌ Bloqueo temporal de mesa durante el proceso de reserva online (hold de N minutos con TTL en Redis).

## 4. Ciclo de vida / FSM de la reserva

- ✅ Estados: `requested → confirmed → seated → completed | cancelled | no_show`.
- ✅ Transiciones válidas codificadas en `TRANSITIONS` (rechaza transiciones ilegales con 409).
- ✅ Evento Redis por cada transición: `reservation.confirmed`, `reservation.seated`, `reservation.completed`, `reservation.cancelled`, `reservation.no_show`.
- ✅ `cancelled` distingue quién cancela y el motivo vía `PATCH /status` (`cancelledBy`, `cancellationReason`).
- ✅ Campo `cancellation_reason` (motivo libre, máx. 512 chars) persistido solo en transición a `cancelled`.
- ✅ Campo `cancelled_by` (`guest` / `staff` / `system`, default `staff`) con auditoría de quién ejecutó la acción; emitido en el evento `reservation.cancelled`.
- ❌ Reapertura de reserva cancelada (ej. cliente llama para reactivar).
- ❌ Historial de transiciones de estado (`reservation_status_history`) con timestamp y actor.
- ❌ Reserva parcial: solo parte del grupo llega → ajustar `party_size` sin cancelar.

## 5. Confirmación y recordatorios (REUSE `platform/scheduler` + `platform/notifications`)

- ✅ Columnas `reminder_24h_sent_at` e `reminder_2h_sent_at` con índices parciales para el scheduler.
- ✅ Job `reservation-reminders` en `platform-scheduler` (`*/5 * * * *`) publica `reservation.reminder.due` (T-24h, T-2h) usando dichas columnas como idempotencia.
- ✅ Campo `locale` por reserva para localizar la notificación; fallback a `tenant.default_locale` y finalmente `'es'`.
- 🔧 Los eventos `reservation.reminder.due` se publican, pero la plantilla de notificación y el canal (email/SMS/push) dependen de que `platform/notifications` tenga los handlers configurados.
- ❌ Confirmación automática (local en modo "auto-confirm" sin intervención de staff).
- ❌ Confirmación activa: email/SMS al cliente con enlace para confirmar o cancelar antes de T-Xh.
- ❌ Recordatorio T-48h configurable (hoy solo T-24h y T-2h).
- ❌ Notificación de rechazo de reserva al huésped si el local no la confirma en N horas.
- ❌ Notificación interna a staff cuando entra una nueva reserva pendiente de confirmar.

## 6. Walk-ins y gestión de llegadas

- ✅ `source: 'walk_in'` registra la reserva en el momento de la llegada.
- 🔧 Un walk-in se crea con estado `requested` y requiere PATCH manual a `confirmed` + `seated`; flujo de dos pasos innecesario para llegadas directas.
- ❌ Creación directa en estado `seated` para walk-ins (atajo: llega cliente → asignar mesa → ya sentado).
- ❌ Pantalla hostess optimizada para alta rápida de walk-in: nombre, cubiertos, mesa, un tap → sentado.
- ❌ Integración con lista de espera: si no hay mesa libre, ofrecer cola de espera al walk-in en lugar de rechazarlo.

## 7. Lista de espera (waitlist)

- ✅ Alta en waitlist: `guest_name`, `guest_phone` (opc.), `party_size`, `estimated_wait_minutes`, `notes`.
- ✅ FSM waitlist: `waiting → notified → seated | left | cancelled`.
- ✅ `POST /v1/reservations/waitlist/:id/notify` → cambia estado a `notified` y publica `waitlist.notified` (con `guest_phone` y `guest_name` para que `platform/notifications` envíe SMS/WhatsApp).
- ✅ Listado de waitlist filtrable por `status`.
- 🔧 La notificación al cliente es manual (staff pulsa "notificar"); no hay automatización.
- ❌ Escalado de notificaciones: si el cliente no responde en N minutos tras `notified`, pasar al siguiente de la cola.
- ❌ `guest_email` en waitlist (hoy solo `guest_phone`).
- ✅ Auto-notificación cuando se libera una mesa: al transicionar una reserva a `completed`/`cancelled`/`no_show`, se busca el primer `waiting` en cola FIFO que quepa en los cubiertos liberados, se marca `notified` en la misma transacción y se emite `waitlist.notified` (`reason: auto_table_freed`).
- ❌ Estimación dinámica de espera (actualización de `estimated_wait_minutes` en tiempo real según rotación de mesas).
- ❌ Posición en cola visible al cliente (push/polling al widget público).
- ❌ Confirmación por parte del cliente ("seguís esperando / sí/no" vía enlace en SMS).

## 8. No-show: tracking y penalizaciones

- ✅ Estado `no_show` accesible desde `confirmed` en la FSM.
- ✅ Evento `reservation.no_show` publicado.
- ✅ Contador de no-shows por `guest_email` / `guest_user_id` (`GET /v1/reservations/no-shows?guestUserId=…|guestEmail=…` → `{ count }`).
- ❌ Política de penalización configurable: N no-shows → vetado temporalmente / requiere depósito obligatorio.
- ❌ Lista negra de emails/teléfonos marcados como infractores.
- ❌ No-show automático: si la reserva llega a T+15 min sin `seated`, marcar automáticamente vía scheduler.
- ❌ Dashboard de tasa de no-shows por turno / día / semana.

## 9. Política de cancelación y depósito/prepago (REUSE `platform/payments`)

- ✅ Campo `guarantee_payment_intent_id` en `reservations` (hueco para vincular el PaymentIntent de Stripe).
- 🔧 El campo existe pero no hay lógica de cobro, captura ni devolución implementada.
- ❌ Configuración por tenant de política de cancelación: gratuita hasta Xh antes, cargo parcial o total si se cancela tarde.
- ❌ Depósito de garantía al reservar (REUSE `platform/payments` — charge/hold).
- ❌ Captura automática del depósito si `no_show` o cancelación fuera de plazo.
- ❌ Devolución proporcional o total si se cancela dentro del plazo.
- ❌ Menú de degustación prepagado: cobrar el importe completo al reservar (evento especial).
- ❌ Recibo / factura del depósito al cliente (REUSE `platform/payments` + `platform/verifactu`).

## 10. Peticiones especiales y ocasión

- ✅ Campo `notes` (texto libre, máx. 512 chars) para peticiones del comensal.
- ✅ Campo estructurado `special_requests` (JSONB) con categorías: `allergens[]`, `highChair`, `wheelchair`, `seatingPref` (terrace/indoor/window/quiet/accessible), `occasion` (birthday/anniversary/business/first_date/other), `dietaryNotes`. Validado con zod `.strict()` en el alta.
- ❌ Etiqueta de ocasión: `birthday`, `anniversary`, `business`, `first_date`, etc. con acción de staff (decoración, postre, cava).
- ❌ Notificación automática a cocina / sala cuando la reserva tiene alérgenos o petición especial.
- ❌ Advertencia al hostess si el mismo cliente tiene alergia registrada en visitas anteriores.

## 11. Grupos grandes y eventos privados

- ❌ Flag `is_group_event` o umbral de `party_size` configurable a partir del cual se activa flujo de evento.
- ❌ Flujo de grupo: cotización previa, menú cerrado, señal/depósito más alto, confirmación en dos pasos.
- ❌ Bloqueo de sala / sección completa para grupo privado (usar `blackouts` con referencia a reserva).
- ❌ Gestión de menú preseleccionado para grupos (linkado con `platform/menu`).
- ❌ Asistentes secundarios: varios contactos para un mismo evento (coordinador + contacto de empresa).

## 12. Reservas recurrentes

- ❌ Reserva periódica: "todos los viernes a las 21:00 para 4 personas" con fin de serie.
- ❌ Gestión de excepciones en serie (cancelar o modificar una ocurrencia sin afectar las demás).
- ❌ `recurrence_rule` (iCal RRULE) y `parent_reservation_id` para agrupar la serie.
- ❌ Job en `platform-scheduler` para materializar ocurrencias N días por adelantado.

## 13. Perfil de cliente / CRM e historial de visitas

- ✅ `guest_user_id` vincula la reserva al usuario de `platform/auth` cuando está autenticado.
- ❌ Historial de visitas del cliente: cuántas veces ha reservado, cuándo, cuántos cubiertos, no-shows, valoraciones dejadas.
- ❌ Preferencias persistentes del cliente: mesa habitual, alergias, ocasión, bebida favorita.
- ❌ Lista VIP: clientes con trato preferente (mesa fija, acceso a reservas en horario lleno).
- ❌ Vista de cliente en el sistema hostess (cuando el cliente llama → mostrar historial en pantalla).
- ❌ CRM ligero: notas internas sobre el cliente (no visibles para el comensal).

## 14. Listas VIP y lista negra

- ❌ Tabla `guest_tags` o campo en perfil con etiquetas: `vip`, `regular`, `influencer`, `blacklisted`.
- ❌ Lista negra de emails/teléfonos: rechazo automático de reservas (o alerta a staff) para clientes problemáticos.
- ❌ Reglas de acceso preferencial: VIPs pueden reservar en ventana de tiempo fuera del horario público.
- ❌ Notificación a manager cuando llega una reserva de cliente VIP.

## 15. Duración estimada de mesa y rotación

- ✅ `duration_minutes` por reserva (default 90 min, configurable en alta).
- 🔧 La duración no se usa en ningún cálculo de disponibilidad ni de rotación de mesa.
- ❌ Motor de rotación: calcular cuándo queda libre una mesa (`reserved_for + duration_minutes`) para asignarla a la siguiente reserva o walk-in.
- ❌ Duración variable por tamaño de grupo (mesa de 2 = 75 min, mesa de 6 = 120 min) configurada por tenant.
- ❌ Actualización de duración real al marcar `completed` (hora real de salida vs estimada).
- ❌ Alerta a hostess cuando una mesa lleva más del 110% del tiempo estimado (retraso en rotación).

## 16. Integración con POS y KDS (REUSE `platform/pos` + `platform/kds`)

- ✅ `table_id` es el nexo de unión con `platform/floor-plan`, que a su vez enlaza con POS y KDS.
- 🔧 La integración es estructural (FK lógica vía `table_id`) pero no hay flujo automatizado.
- ❌ Al marcar `seated`, abrir automáticamente la comanda en `platform/pos` para esa mesa y reserva.
- ❌ Al marcar `completed`, notificar al POS para cerrar la comanda (o viceversa: POS cerrado → reserva completed).
- ❌ Al confirmar reserva con menú cerrado de grupo, pre-cargar las líneas de pedido en KDS.
- ❌ Vista de reservas del día en el KDS para anticipar alérgenos y peticiones especiales.

## 17. Widget público y canal online

- ❌ Widget JS embebable (`<script>`) en la web del restaurante (sin JWT, flujo de cliente anónimo).
- ❌ Flujo público: seleccionar fecha → ver franjas disponibles → escoger cubiertos → introducir datos → confirmar → recibir email/SMS de confirmación.
- ❌ Enlace de cancelación / modificación sin login (token de un solo uso vía email).
- ❌ Página de confirmación personalizable con logo y colores del restaurante (tenant branding).
- ❌ Integración con Google Reserve (botón "Reservar" directamente en Google Business Profile).
- ❌ Integración con redes sociales (Instagram / Facebook "Reserve a Table" CTA).

## 18. Analítica y reporting operativo

- ❌ Ocupación por turno: cubiertos confirmados vs aforo, tasa de llenado por día/semana/mes.
- ❌ Tasa de no-shows por turno / canal / día de semana.
- ❌ Tasa de cancelaciones y lead time de cancelación.
- ❌ Tiempo medio de mesa (duración real seated→completed).
- ❌ Top fuentes de reserva (portal, teléfono, walk-in, partner, Google…).
- ❌ Previsión de cubiertos para cocina (proyección de los próximos 7 días).
- ❌ Export CSV de reservas filtradas (para planificación de compras, personal, etc.).
- ❌ Dashboard en tiempo real para el turno activo: mesa × estado, cola de espera, próximas llegadas.

## 19. Recordatorios configurables y comunicación con el huésped

- ✅ Job scheduler publica `reservation.reminder.due` (T-24h, T-2h) con idempotencia.
- ✅ `locale` por reserva para localización del mensaje.
- 🔧 El canal de entrega (email/SMS/push) depende de handlers en `platform/notifications` que no están definidos para este módulo aún.
- ❌ Configuración por tenant del timing de recordatorios (T-48h, T-24h, T-4h, T-1h).
- ❌ Mensaje de bienvenida post-llegada ("¡Bienvenidos! Vuestro menú de hoy…").
- ❌ Solicitud de reseña post-visita vía email (T+2h tras `completed`) con link a Google / Tripadvisor (REUSE `platform/reviews`).
- ❌ Encuesta de satisfacción post-visita.
- ❌ Preferencias de canal del cliente (acepta SMS, solo email, no publicidad).

## 20. Multi-local y multi-tenant

- ✅ Aislamiento completo por `(app_id, tenant_id)` con RLS.
- ✅ `sub_tenant_id` soportado en `reservations` (para cadenas con varios locales bajo el mismo `tenant_id`).
- 🔧 `service_hours`, `waitlist` y `blackouts` no usan `sub_tenant_id`; no están preparados para multi-local.
- ❌ Configuración de horarios y aforo por local (`sub_tenant_id`) en cadenas.
- ❌ Vista centralizada de reservas de todos los locales de una cadena.
- ❌ Traslado de reserva entre locales de la misma cadena.
- ❌ Política de reservas global de marca vs configuración por local.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ✅ ~~**Validación de disponibilidad al crear reserva**~~ — `createReservation` lee `service_hours` + `blackouts` + suma de cubiertos activos solapados y rechaza fuera de servicio / sin aforo (409). `max_covers` por franja añadido a `service_hours`. Walk-ins omiten la validación.
2. 🔧 **Endpoint público de disponibilidad** (`GET /availability?date=…&partySize=N`) + widget embebable — ✅ endpoint implementado (franjas + cubiertos restantes + flag `available`). ❌ widget embebable y flujo anónimo sin JWT pendientes (frontend + auth cross-cutting).
3. **Confirmación activa al cliente** (email/SMS con enlace confirm/cancel) — REUSE `platform/notifications`; elimina la incertidumbre del estado `requested`.
4. ✅ ~~**Auto-notificación de waitlist** cuando se libera una mesa~~ — trigger automático en `changeStatus` para transiciones `completed|cancelled|no_show`: busca el primer `waiting` FIFO que quepa, lo marca `notified` en la misma tx y emite `waitlist.notified`.
5. 🔧 **No-show automático** vía scheduler (T+15 min sin `seated` → `no_show`) + contador por cliente — ✅ contador por cliente implementado (`GET /no-shows`). ❌ auto-transición vía scheduler pendiente (cross-cutting `platform-scheduler`).
6. ✅ ~~**`special_requests` estructurado**~~ (alérgenos, trona, ocasión) — columna JSONB + validación zod en el alta. ❌ notificación automática a cocina/sala pendiente (cross-cutting `platform/kds`).
7. **Integración POS**: al marcar `seated`, abrir comanda en `platform/pos` — cierra el ciclo operativo front-of-house/kitchen sin intervención manual.
8. **Política de cancelación y depósito** (REUSE `platform/payments`) — bloquea no-shows en locales de alta demanda.
9. **Solicitud de reseña post-visita** (REUSE `platform/reviews` + scheduler) — automatiza la captación de opiniones sin esfuerzo de staff.
10. **Analítica de ocupación y tasa de no-shows** — datos mínimos para optimizar turnos, personal y compras.
