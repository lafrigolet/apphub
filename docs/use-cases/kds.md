# Casos de uso — `platform/kds` (platform-restaurant)

> Dominio: Kitchen Display System — pantallas digitales de cocina que reciben, muestran y gestionan el ciclo de vida de las comandas (tickets) generadas por pedidos de sala (POS), pedidos en línea (orders) y entrega a domicilio (delivery-dispatch). Reemplaza la impresora de tickets y centraliza la coordinación entre sala y cocina.

## Estado actual (implementado)

Tres tablas con RLS estricto (`app_id + tenant_id`): `stations` (pantallas/estaciones configurables con lista de cursos que enrutan), `tickets` (comanda por orden × curso × estación; FSM `fired → in_progress → ready → picked_up / cancelled`; marcas de tiempo `fired_at`, `acked_at`, `ready_at`, `picked_up_at`), `ticket_items` (líneas de ítem con SKU, nombre, cantidad, modificadores JSONB y notas). Suscripción Redis a `order.paid` y `pos.bill.paid` que dispara `fireTicketsForOrder` (agrupa ítems por `course`, resuelve la estación por `routes_courses`, inserta ticket + ítems y publica `kds.ticket.fired`). API REST autenticada: crear/listar estaciones; listar/obtener/avanzar tickets (`PATCH …/status`). Eventos Redis salientes: `kds.ticket.fired`, `kds.ticket.acked`, `kds.ticket.ready`, `kds.ticket.picked_up`, `kds.ticket.cancelled`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Ingestión de comandas desde eventos de plataforma

- ✅ Recepción de evento `order.paid` (marketplace/online) → generación automática de tickets.
- ✅ Recepción de evento `pos.bill.paid` (cobro en sala desde POS) → misma lógica de disparo.
- ✅ Agrupación de ítems por `course` dentro del mismo pedido (un ticket por curso × pedido).
- ✅ Fallback a `course = 'main'` cuando el ítem no especifica curso.
- ✅ Propagación de `tableCode` del evento al campo `table_code` del ticket.
- ❌ Recepción de evento `delivery.order.confirmed` (delivery-dispatch) para pedidos a domicilio.
- ❌ Recepción de `reservation.order.created` (reserva con pre-pedido desde portal de mesas).
- ❌ Creación manual de ticket por staff/camarero desde la interfaz KDS (sin origen en evento externo).
- ❌ Re-disparo / reimpresión de tickets ya existentes (p. ej. si se pierde la pantalla o se reinicia).
- ❌ Modificación de un ticket en vuelo cuando el pedido se edita antes de pasar a cocina (`order.modified`).
- ✅ Cancelación automática de tickets cuando el pedido es cancelado (`order.cancelled`, `pos.bill.voided`) → `cancelTicketsByOrder` + `kds.ticket.cancelled` por ticket.

## 2. Estaciones (pantallas de cocina)

- ✅ Alta de estación: `name`, `display_order`, `routes_courses` (array de cursos), `is_active`.
- ✅ Listado de estaciones por tenant ordenado por `display_order, name`.
- ✅ Resolución automática de estación al disparar ticket: primera estación activa cuyo `routes_courses` contiene el curso del ticket.
- ✅ Tickets sin estación asignada cuando ninguna estación cubre ese curso (`station_id = null`).
- ✅ PATCH/DELETE de estación (`PATCH/DELETE /v1/kds/stations/:id`).
- ✅ Actualización de estación (renombrar, cambiar `display_order`, `is_active`, `routes_courses`) vía PATCH parcial.
- ✅ Baja de estación con reasignación de tickets pendientes (DELETE reasigna a `reassignTo` o a `station_id = null`).
- ❌ Tipos de estación predefinidos (caliente, frío, postres, bar, expedición) con icono/color.
- ❌ Múltiples estaciones que comparten el mismo curso (p. ej. dos woks para `main` en alta carga).
- ❌ Configuración de impresora física vinculada a la estación (IP/puerto Epson TM, etc.).
- ❌ Configuración de sonido/alerta por estación (tono, volumen, vibración en tablet).
- ❌ Gestión de sesión de pantalla (autenticación por PIN de estación, sin JWT de usuario).
- ❌ Historial de cambios de configuración de estación (auditoría).

## 3. Enrutado de ítems a estaciones (coursing y routing)

- ✅ Enrutado por `course` del ítem: la estación declara los cursos que acepta en `routes_courses`.
- ✅ Un ticket por curso (no un ticket por ítem), agrupando todos los ítems del mismo curso.
- 🔧 Resolución de estación toma la primera coincidencia por `display_order` — sin gestión de carga.
- ❌ Enrutado por categoría de menú (`platform/menu` `category_id`) en lugar de/además de `course`.
- ❌ Enrutado por SKU o prefijo de SKU (algunos ítems deben ir a una estación específica).
- ❌ Enrutado por etiquetas/alérgenos (p. ej. alergias → línea separada / visible alert).
- ❌ Reglas de enrutado configurables con prioridad y fallback (motor de reglas).
- ❌ División de un mismo curso entre dos estaciones cuando la carga supera el umbral.
- ❌ Override manual de la estación asignada en un ticket ya disparado.
- ❌ Sincronización con `platform/menu`'s `86-list` (si un ítem está "86'd", rechazar o alertar).

## 4. Estados del ticket y FSM (flujo de preparación)

- ✅ Estado inicial `fired` al crear el ticket (el pedido ha entrado en cocina).
- ✅ Transición `fired → in_progress`: el cocinero acusa recibo (`acked_at` marcado).
- ✅ Transición `in_progress → ready`: preparación completada (`ready_at` marcado).
- ✅ Transición `ready → picked_up`: camarero recoge el plato para servir (`picked_up_at` marcado).
- ✅ Transición `* → cancelled` desde `fired` o `in_progress` o `ready`.
- ✅ Rechazo de transiciones inválidas con `ConflictError` (no se puede saltar de `fired` a `ready`).
- ❌ Estado `served` diferenciado de `picked_up` (confirmación de sala que el plato llegó a la mesa).
- ❌ Estado `on_hold` / pausa (esperar instrucción de marchar antes de proceder).
- ❌ Recall de ticket: volver de `ready` a `in_progress` si el plato fue rechazado o hubo error.
- ❌ Re-open de ticket cancelado (el staff cancela por error y necesita reabrir).
- ✅ Estado a nivel de ítem individual (`ticket_items.status` + `ready_at`, migración 0002).
- ✅ Bump parcial: `PATCH /v1/kds/items/:itemId/status` (FSM `fired → in_progress → ready`).

## 5. Bump y recall (operativa de pantalla)

- ✅ Bump de ticket: `PATCH /v1/kds/tickets/:id/status` con el nuevo estado.
- ✅ Publicación de evento Redis tras cada bump (`kds.ticket.acked/ready/picked_up/cancelled`).
- ✅ Bump masivo: `PATCH /v1/kds/orders/:orderId/bump` avanza todos los tickets elegibles del pedido a un estado (los no elegibles se omiten, sin error).
- ✅ Bump con un solo toque físico en pantalla táctil (`POST /v1/kds/tickets/:id/bump` sin body, avanza al siguiente estado del FSM).
- ❌ Recall de ticket: `PATCH` de vuelta de `ready` a `in_progress` (actualmente el FSM lo impide).
- ❌ Recall masivo por pedido (toda la comanda retrocede un estado).
- ✅ Cancelación masiva de todos los tickets de un pedido al cancelar el pedido (`cancelTicketsByOrder`, vía evento o no expuesto como ruta directa).
- ❌ Historial de bumps por ticket (quién hizo el bump, cuándo, desde/hasta qué estado).

## 6. Coursing / firing (control de tiempos entre pases)

- ✅ Modelo de `course` por ítem con fallback a `main`; cursos típicos: `starter`, `main`, `dessert`, `drink`.
- ✅ Tickets separados por curso del mismo pedido (entrantes y principales no se disparan mezclados).
- ❌ Firing manual de cursos: el camarero (o el KDS de sala) ordena "marchar principales ahora".
- ❌ Firing automático por tiempo: disparar `main` N minutos después de que `starter` esté `ready`.
- ❌ Modo "retener entrada" para pases de restaurante fine-dining (el ticket existe pero no se muestra hasta que se autoriza).
- ❌ Vista de "cola de firing" donde el pase/expedición ve qué cursos están pendientes de autorización.
- ❌ Notificación al camarero cuando un curso de la mesa está `ready` para poder marchar el siguiente.
- ❌ Agrupación multi-mesa: disparar el mismo curso de varias mesas a la vez (servicio de banquetes).

## 7. Tiempos de preparación y alertas de SLA

- ✅ Marca de tiempo `fired_at` al crear el ticket.
- ✅ Marcas `acked_at`, `ready_at`, `picked_up_at` con cada transición.
- ❌ SLA configurable por estación o por curso (p. ej. "los starters deben estar en 8 min").
- ❌ Alerta de retraso: publicar `kds.ticket.sla_breached` cuando el ticket lleva más de X minutos sin ser acked o sin llegar a `ready`.
- ❌ Job en `platform/scheduler` que evalúe SLA cada minuto y publique el evento de incumplimiento.
- ❌ Indicador visual de tiempo en pantalla (semáforo verde/ámbar/rojo por antigüedad del ticket).
- ❌ Tiempo objetivo de preparación por ítem/SKU (importado de `platform/menu`).
- ❌ Cálculo de tiempo medio de preparación por estación/curso para métricas.

## 8. Vista de pantalla KDS (display por estación)

- ✅ `GET /v1/kds/tickets?stationId=…&status=…&limit=…` para filtrar tickets de una estación.
- ✅ Respuesta incluye ítems con sus modificadores y notas.
- ❌ Actualización en tiempo real vía WebSocket (actualmente el cliente debe hacer polling REST).
- ❌ Endpoint de suscripción SSE/WS por estación: el cliente recibe push de `kds.ticket.*` sin polling.
- ❌ Vista de pendientes ordenada por `fired_at` ASC (ya lo hace el repositorio, pero no hay endpoint dedicado de "cola activa").
- ❌ Vista de "terminados recientes" (tickets `picked_up` en los últimos N minutos) para confirmación.
- ❌ Filtro de tickets por rango de tiempo (turno actual, hora actual).
- ❌ Pantalla de expedición/pase: vista cross-estaciones que muestra qué cursos de cada mesa están `ready` y cuáles pendientes.

## 9. Agrupación por mesa y pedido

- ✅ `table_code` en el ticket propagado desde el evento de origen.
- ✅ `order_id` en el ticket permite relacionar tickets de distintos cursos del mismo pedido.
- ✅ Agrupación multi-ticket por `order_id` en la respuesta de la API (`GET /v1/kds/orders/:orderId/tickets`).
- ✅ Endpoint `GET /v1/kds/orders/:orderId/tickets` para obtener todos los tickets de una comanda (con ítems).
- ✅ Estado agregado de la comanda (`all_ready`, `partial_ready`, `in_progress`, `picked_up`, `cancelled`) derivado de sus tickets.
- ❌ Resumen por mesa: cuántos tickets pendientes / listos / recogidos para `table_code`.
- ❌ Notificación a sala/camarero asignado cuando **todos** los cursos activos de una mesa están `ready`.

## 10. Comunicación cocina-sala (avisar listo)

- ✅ Evento `kds.ticket.ready` publicado en `platform.events` cuando el ticket alcanza `ready`.
- ❌ Suscripción en `platform/notifications` al evento `kds.ticket.ready` para push/SMS al camarero asignado.
- ❌ Integración con `platform/chat` — mensaje automático al canal de sala cuando la comanda está lista.
- ❌ Pantalla de sala (runner display) que muestra tickets `ready` pendientes de recoger.
- ❌ Confirmación de recogida desde la pantalla de sala (bump a `picked_up` sin tocar la pantalla de cocina).
- ❌ Alerta sonora configurable en la pantalla de sala al recibir `kds.ticket.ready`.
- ❌ Integración con `platform/delivery-dispatch`: publicar `kds.ticket.ready` con `delivery_order_id` para que el dispatcher avise al rider.

## 11. All-day view y totales por ítem

- ✅ Vista "all-day": recuento total de cada SKU/nombre pendiente (tickets activos `fired`/`in_progress`).
- ✅ Endpoint `GET /v1/kds/allday?stationId=…` que agrega `SUM(qty)` por `(sku, name)` de tickets activos.
- ✅ Desglose de totales por estado (`fired`, `in_progress`).
- ❌ Filtro por estación o por turno (definir turnos de cocina en configuración).
- ❌ Exportación de totales del turno (para compras, control de merma).

## 12. Modo expedición / pase

- ❌ Rol o perfil de "expedidor" que ve tickets de todas las estaciones simultáneamente.
- ❌ Vista consolidada cross-estación agrupada por pedido/mesa.
- ❌ Bump de expedición: el expedidor marca el pedido como servido cuando recoge todos los platos.
- ❌ Verificación de completitud: el expedidor no puede hacer bump si alguna estación aún no ha marcado `ready`.
- ❌ Pantalla de pase: disposición configurable en columnas por estación con color-coding de estado.

## 13. Priorización y reordenación

- ❌ Bump manual de prioridad: mover un ticket al tope de la cola de una estación.
- ❌ Priorización automática por tiempo de espera del cliente en sala (mesas con más espera primero).
- ❌ Pedidos VIP o con alergia marcados con bandera visual de alta prioridad.
- ❌ Reordenación drag-and-drop de la cola en la pantalla KDS.
- ❌ Prioridad de delivery vs mesa (configurable: mesa primero, o FIFO estricto).

## 14. Sonidos y alertas visuales

- ❌ Sonido de nuevo ticket (`kds.ticket.fired`) configurable por estación (tono, volumen).
- ❌ Alerta visual (parpadeo, banner) para tickets que superan el tiempo objetivo.
- ❌ Modo silencio por horario (pausar alertas sonoras en horas de alta carga).
- ❌ Vibración en tablets durante el bumping.
- ❌ Configuración de alertas por tenant/estación almacenada en `platform_kds.stations` o tabla de config.

## 15. Métricas y analítica de cocina

- ✅ Tiempo medio de preparación por estación: `AVG(ready_at - fired_at)` agrupado por `(station_id, course)` (`GET /v1/kds/metrics`).
- ✅ Tiempo medio de ack (reacción de cocina): `AVG(acked_at - fired_at)`.
- ✅ Tiempo medio de recogida (sala): `AVG(picked_up_at - ready_at)`.
- ✅ Tasa de cancelaciones por estación/curso (`COUNT FILTER (status='cancelled')` sobre el total).
- ❌ Número de tickets SLA-breached vs total.
- ❌ Tendencia horaria de volumen de tickets (heatmap de carga por hora del día).
- ❌ Export CSV/XLSX de métricas por turno o rango de fechas.
- ❌ Dashboard en `apps/portal` o app de restaurante con gráficas de tiempo real y resúmenes históricos.

## 16. Impresión de tickets

- ❌ Impresión automática en impresora de red (Epson TM, Star) al disparar un ticket (`kds.ticket.fired`).
- ❌ Configuración de impresora por estación (IP, puerto, driver ESC/POS).
- ❌ Reimpresión manual desde la interfaz KDS.
- ❌ Plantilla de ticket configurable (logo, `table_code`, ítems, modificadores, notas, hora).
- ❌ Impresión de comanda general (todas las estaciones) para el expedidor.
- ❌ Cola de impresión con reintentos en caso de error de conexión a la impresora.

## 17. Tiempo real (WebSocket / SSE)

- ✅ Eventos Redis salientes (`kds.ticket.*`) disponibles para consumidores internos vía `platform.events`.
- ❌ Gateway WebSocket dedicado para pantallas KDS (análogo al gateway de `platform/chat`).
- ❌ Suscripción por `(app_id, tenant_id, station_id)` — cada pantalla solo recibe sus propios tickets.
- ❌ Reconexión automática con estado (entrega de eventos perdidos durante la desconexión).
- ❌ Endpoint SSE `GET /v1/kds/stations/:id/stream` como alternativa ligera a WS para clientes web.
- ❌ Presencia de pantalla (heartbeat que detecta si una pantalla KDS se ha desconectado → alerta al staff).

## 18. Integración con `platform/menu` (86-list y datos de ítem)

- ✅ SKU y nombre del ítem se almacenan en `ticket_items` (snapshot, sin JOIN a menú).
- ✅ Modificadores de ítem en `ticket_items.modifiers` (JSONB).
- ❌ Resolución automática de estación desde la categoría/tipo del ítem en `platform/menu` (hoy solo por `course`).
- ❌ Consulta de la 86-list de `platform/menu` al disparar un ticket: si un ítem está fuera de stock, rechazar o alertar antes de enviar a cocina.
- ❌ Alerta en pantalla KDS cuando un ítem en un ticket activo pasa a 86'd durante la preparación.
- ❌ Sync de tiempos de preparación estándar desde `platform/menu` a la configuración de SLA de `platform/kds`.

## 19. Multi-local / multi-tenant

- ✅ RLS estricto por `(app_id, tenant_id)` en las tres tablas.
- ✅ Suscripción a eventos incluye `app_id` y `tenant_id` en el payload; solo se procesan eventos con datos válidos.
- ❌ `sub_tenant_id` soportado a nivel de contexto (`ctx`) pero no filtrado en queries de repositorio.
- ❌ Configuración de estaciones por `sub_tenant_id` (p. ej. distintas cocinas dentro del mismo tenant/local).
- ❌ Vista de coordinación multi-local (cadena de restaurantes con dashboard central).
- ❌ Exportación y comparativa de métricas cross-tenant para franquiciadores.

## 20. Gestión de configuración de módulo (admin)

- ❌ Endpoint `GET/PATCH /v1/kds/admin/config` protegido por `requireRole('super_admin','staff')`.
- ❌ Configuración de SLA por defecto, número máximo de tickets en pantalla, cursos disponibles.
- ❌ Vista en `apps/portal` para gestión de estaciones sin necesidad de llamadas directas a la API.
- ❌ Integración con el sistema de config cifrada de `@apphub/platform-sdk/crypto` para parámetros sensibles.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ✅ ~~**PATCH/DELETE de estación**~~ (`PATCH/DELETE /v1/kds/stations/:id`; el DELETE reasigna los tickets abiertos a `reassignTo` o a `station_id = null`).
2. **WebSocket / SSE por estación** — las pantallas KDS necesitan tiempo real; polling REST no es viable en producción. REUSE el patrón del gateway de `platform/chat` o añadir SSE en el propio módulo.
3. ✅ ~~**Bump masivo por pedido + endpoint `/orders/:orderId/tickets`**~~ (`GET /v1/kds/orders/:orderId/tickets` con `aggregateStatus` derivado; `PATCH /v1/kds/orders/:orderId/bump`; además `POST /v1/kds/tickets/:id/bump` one-touch).
4. **SLA configurable + job en `platform/scheduler` (`kds-sla`)** — alertas de retraso ya existe la infraestructura de cron; añadir un job `*/1` que publique `kds.ticket.sla_breached`.
5. **Notificación a sala via `platform/notifications` / `platform/chat`** — REUSE directo; suscribirse a `kds.ticket.ready` y enviar push/chat al camarero asignado.
6. **Integración `kds.ticket.ready` → `platform/delivery-dispatch`** — avisar al dispatcher cuando la comanda está lista para el rider; suscripción unilateral, sin cambio de esquema.
7. ✅ ~~**Cancelación automática de tickets al cancelar pedido**~~ (suscripción a `order.cancelled` y `pos.bill.voided` → `cancelTicketsByOrder` cancela los tickets abiertos del pedido, persiste `cancel_reason` y publica `kds.ticket.cancelled` por cada uno).
8. ✅ ~~**All-day view** (`GET /v1/kds/allday`)~~ (agregación `SUM(qty)` por `(sku,name)` de tickets activos, desglose por estado, filtro opcional `stationId`).
9. ✅ ~~**Estado a nivel de ítem** (`ticket_items.status`) + bump parcial~~ (columna `status` + `ready_at` en `ticket_items`; `PATCH /v1/kds/items/:itemId/status` con FSM `fired → in_progress → ready`).
10. ✅ ~~**Métricas de tiempos** (`GET /v1/kds/metrics`)~~ (AVG de ack/prep/pickup + tasa de cancelación por `(station_id, course)`, ventana opcional `from`/`to`).
