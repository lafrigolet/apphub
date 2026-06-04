# Casos de uso — `platform/delivery-dispatch` (platform-restaurant)

> Dominio: reparto local de comida — última milla operada con riders propios del tenant. Cubre zonas de reparto (polígonos GeoJSON), tarifas por zona/distancia, gestión de riders (alta, estado, GPS), despacho de pedidos (manual, asignación a rider), FSM del envío (`pending → dispatched → picked_up → delivered / cancelled / failed`), log de eventos con coordenadas GPS, integración con agregadores externos (Glovo, Uber, Stuart) y escucha automática del evento `order.paid`. **No confundir con `platform/shipping`** (paquetería/carriers externos: UPS, FedEx, DHL; devoluciones RMA; marketplace — contenedor `platform-marketplace` puerto 3100). Delivery-dispatch es la última milla in-house con flota propia en el contexto restaurante/delivery.

## Estado actual (implementado)

Zonas (`zones`) con polígono GeoJSON, tarifa base y tarifa por km, pedido mínimo e indicador de activación; riders (`riders`) con vehículo, estado FSM, posición GPS (`last_lat`, `last_lng`, `last_seen_at`); deliveries (`deliveries`) con referencia a `order_id`, `carrier` (own/glovo/uber/justeat/deliveroo/other), `rider_id`, zona, direcciones pickup/drop como JSONB, tarifa, ETA en minutos y timestamps de cada estado; log de eventos (`delivery_events`) con coordenadas GPS y payload libre; FSM con transiciones validadas y publicación de eventos Redis por cada transición; asignación manual de rider (solo si `status=pending`); escucha de `order.paid` para crear deliveries automáticamente cuando `fulfillmentMethod=delivery`; credenciales de integradores externos (Uber Direct, Glovo Partners, Stuart) en tabla `settings` con cifrado AES-256-GCM; admin GET/PATCH de configuración de carriers; aislamiento RLS por `(app_id, tenant_id)` en todas las tablas.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## Frontera delivery-dispatch vs. shipping

| Criterio | `platform/delivery-dispatch` | `platform/shipping` |
|---|---|---|
| Transportista | Riders propios del tenant (flota interna) | Carrier externo (UPS, FedEx, DHL, EasyPost…) |
| Tracking | GPS en tiempo real, FSM interno | Webhook del carrier + log manual |
| Contexto | Restaurante / dark kitchen / último kilómetro | Marketplace / paquetería saliente |
| Devoluciones RMA | ❌ Fuera de ámbito | ✅ Implementado |
| Contenedor | `platform-restaurant` (puerto 3200) | `platform-marketplace` (puerto 3100) |
| Riders | Entidad propia con estado y GPS | No aplica |

---

## 1. Zonas de reparto

- ✅ Crear zona con nombre y polígono GeoJSON (forma libre: rectángulo, polígono irregular, radio convertido a polígono).
- ✅ Tarifa base (`base_fee_cents`) y tarifa por kilómetro (`per_km_cents`) por zona.
- ✅ Pedido mínimo por zona (`min_order_cents`).
- ✅ Activación/desactivación de zona (`is_active`).
- ✅ Listado de zonas del tenant ordenado por nombre.
- ✅ Aislamiento RLS por `(app_id, tenant_id)`.
- ✅ PATCH y DELETE de zona (`PATCH/DELETE /v1/delivery-dispatch/zones/:id`).
- 🔧 No hay validación de superposición de polígonos (dos zonas pueden cubrir la misma área).
- ✅ Comprobación de si una dirección (lat/lng) cae dentro de una zona (`point-in-polygon`, en `utils/geo.js`, usado por el endpoint de cotización).
- ❌ Radio de reparto expresado como radio circular (en lugar de polígono manual).
- ❌ Zona predeterminada ("todo lo que queda fuera de zonas explícitas").
- ❌ Franjas horarias de disponibilidad por zona (la zona A solo activa de lunes a viernes, 12h-22h).
- ❌ Capacidad máxima de pedidos simultáneos por zona (throttling de demanda).

## 2. Tarifas de envío por zona y distancia

- ✅ Tarifa base plana por zona (`base_fee_cents`).
- ✅ Tarifa incremental por kilómetro (`per_km_cents`).
- ✅ Pedido mínimo para activar el envío a esa zona (`min_order_cents`).
- ✅ La tarifa se registra en la delivery (`fee_cents`) al crearla — auditable post-entrega.
- 🔧 Cálculo de `fee_cents` en el momento de creación está delegado al caller (no hay lógica de cálculo automático en el módulo con la distancia real).
- ✅ Cotización de tarifa previa a confirmar el pedido (`GET /v1/delivery-dispatch/quote?lat=…&lng=…&orderTotalCents=…`): resuelve la zona activa por point-in-polygon, calcula `base_fee + per_km * distancia` (haversine al centroide de la zona) y valida `min_order_cents`. Devuelve `{ deliverable, reason, zoneId, feeCents, distanceKm }`.
- ❌ Tarifa por tramos de distancia (0-2 km → X, 2-5 km → Y, >5 km → Z).
- ❌ Surcharge/recargo por franja horaria (precio noche/festivo).
- ❌ Tarifa gratuita por superar importe de pedido (umbral "envío gratis a partir de X€").
- ❌ Historial de cambios de tarifa con vigencia temporal.

## 3. Gestión de riders (alta y perfil)

- ✅ Alta de rider con `display_name`, `phone`, `vehicle` (`bike`, `ebike`, `scooter`, `car`, `foot`) y `user_id` opcional (vínculo con cuenta de plataforma).
- ✅ Estado inicial `offline` al dar de alta.
- ✅ Listado de riders filtrable por estado.
- ✅ Aislamiento RLS por `(app_id, tenant_id)`.
- ✅ PATCH de perfil de rider (`PATCH /v1/delivery-dispatch/riders/:id`: nombre, teléfono, vehículo, status, userId) y DELETE de baja (`DELETE /v1/delivery-dispatch/riders/:id`).
- ✅ Soft-delete / baja temporal de rider con motivo (`deleted_at`, `deleted_reason`; los riders dados de baja se excluyen del listado por defecto).
- ❌ Documentación del rider: DNI/NIE, licencia de conducir, fecha de caducidad del carnet.
- ❌ Foto/avatar del rider (para mostrar al cliente en el tracker).
- ❌ Vínculo a `platform/auth` para que el rider pueda autenticarse con su propio JWT.
- ❌ Zona(s) asignadas a un rider (qué zonas cubre).
- ❌ Evaluación/rating del rider (relación con `platform/reviews`).
- ❌ Notas internas sobre el rider.

## 4. Disponibilidad y turnos de riders

- ✅ Estado de disponibilidad básico del rider: `offline`, `available`, `assigned`, `en_route`, `returning`.
- ✅ Actualización de estado vía `ping` (junto con GPS).
- ❌ Gestión de turnos (shift): inicio y fin de jornada programados.
- ❌ Capacidad de carga por rider: número máximo de pedidos simultáneos.
- ❌ Pausa/descanso (estado `break`).
- ❌ Horario semanal por rider.
- ❌ Notificación a dispatcher cuando el número de riders disponibles cae por debajo de umbral mínimo.
- ❌ Balance de carga: indicador de cuántos pedidos activos lleva cada rider en este momento.

## 5. Tracking GPS en tiempo real

- ✅ Endpoint `POST /v1/delivery-dispatch/riders/:id/ping` — el rider actualiza `last_lat`, `last_lng`, `last_seen_at` y opcionalmente su estado.
- ✅ Coordenadas GPS almacenadas en la tabla `delivery_events` en cada transición de estado.
- ✅ El payload publicado en Redis incluye `lat`/`lng` (por ejemplo `delivery.picked_up`).
- ✅ Las coordenadas publicadas son numéricas puras (sin PII del rider ni del cliente).
- 🔧 Solo el último ping es consultable directamente (campo `last_lat/lng` del rider) — no hay historial de posiciones del rider.
- ❌ Historial de ruta del rider (trail completo de pings, útil para reconstruir la trayectoria).
- ❌ Endpoint de suscripción WebSocket/SSE para que el frontend reciba updates de posición en tiempo real sin polling.
- ❌ Link de tracking público para el cliente final (URL con token de un solo uso, mapa en tiempo real).
- ❌ Geofencing: detectar automáticamente cuando el rider entra en el radio del restaurante (pickup inminente) o del cliente (entrega inminente).
- ❌ Heartbeat/timeout: marcar rider como `offline` si no hace ping en N minutos.
- ❌ Almacenamiento en serie temporal (Timescale / Redis TS) para pings de alta frecuencia.

## 6. Asignación de pedidos a riders

- ✅ Asignación manual: `POST /v1/delivery-dispatch/deliveries/:id/assign` con `riderId`.
- ✅ Validación: solo se puede asignar si la delivery está en estado `pending`.
- ✅ Publicación del evento `delivery.dispatched` con `deliveryId`, `orderId`, `riderId`, `carrier`.
- ❌ Asignación automática por proximidad: encontrar el rider disponible más cercano (menor distancia al pickup) usando `last_lat/lng`.
- ❌ Asignación automática por carga: preferir al rider con menos pedidos en curso.
- ❌ Asignación basada en zonas: solo asignar riders que cubran la zona del pedido.
- ❌ Cola de pedidos sin asignar con vista tipo "dispatch board" para el operador.
- ❌ Notificación push/SMS al rider cuando se le asigna un pedido (REUSE `platform/notifications`).
- ❌ Aceptación/rechazo del pedido por el rider: confirmar que el rider acepta antes de avanzar el estado.
- ❌ Timeout de aceptación: si el rider no responde en N segundos, reasignar automáticamente.
- ❌ Batching (multi-pedido): asignar varios pedidos al mismo rider si están en la misma ruta.

## 7. FSM del envío (máquina de estados)

- ✅ Estados: `pending → dispatched → picked_up → delivered` (camino feliz).
- ✅ Cancelaciones: `pending → cancelled`, `dispatched → cancelled`.
- ✅ Fallos: `dispatched → failed`, `picked_up → failed`.
- ✅ Validación de transiciones: solo las permitidas por la tabla `TRANSITIONS`; cualquier salto ilegal lanza `ConflictError 409`.
- ✅ Timestamps automáticos: `dispatched_at`, `picked_up_at`, `delivered_at` según la transición.
- ✅ Cada transición registra un `delivery_event` con `event_type`, coordenadas GPS y `payload`.
- ✅ Cada transición publica un evento Redis `delivery.<status>` con el payload completo.
- 🔧 `cancelled` y `failed` son terminales: no hay flujo de reapertura ni reintentos.
- ❌ Estado `returning` (el rider recoge, no puede entregar y vuelve al restaurante).
- ❌ Estado `attempted` (intento fallido de entrega — cliente no abre, dirección no encontrada) con reintento posterior.
- ❌ Motivo de fallo o cancelación (`reason` se recibe en `statusBody` y se guarda en el evento, pero no hay campo dedicado ni clasificación en la delivery).
- ❌ Historial de estados en tabla separada (la reconstrucción hoy requiere leer `delivery_events`).

## 8. Log de eventos de la delivery

- ✅ Tabla `delivery_events` con `delivery_id`, `event_type`, `lat`, `lng`, `payload JSONB`, `ts`.
- ✅ Los eventos se retornan junto con la delivery en `GET /v1/delivery-dispatch/deliveries/:id`.
- ✅ Índice por `(delivery_id, ts DESC)` para consultas cronológicas.
- 🔧 Los eventos solo se insertan en transiciones de FSM — no hay endpoint para insertar eventos libres (notas del rider, incidencias).
- ❌ Tipos de evento enumerados (enum controlado vs. texto libre `event_type`).
- ❌ Adjuntos en el evento: foto de prueba de entrega, firma del cliente, código OTP.
- ❌ Evento de localización sin cambio de estado (ping del rider durante el trayecto que quede registrado en la ruta).

## 9. Prueba de entrega

- ❌ Foto de prueba de entrega capturada por el rider (REUSE `platform/storage`).
- ❌ Firma digital del receptor en el móvil del rider.
- ❌ OTP de confirmación: el cliente recibe un código y se lo da al rider para acreditar recepción.
- ❌ Confirmación de entrega sin contacto (deixar davant la porta + foto).
- ❌ Instrucciones especiales de entrega por pedido (timbre, piso, código de portal).
- ❌ Registro del nombre del receptor y hora exacta.

## 10. Integración con KDS y Orders

- ✅ El módulo escucha `order.paid` y crea automáticamente una delivery cuando `fulfillmentMethod = 'delivery'`.
- ✅ El evento `order.paid` puede incluir `carrier`, `zoneId`, `pickupAddress`, `dropAddress`, `deliveryFeeCents`, `estimatedMinutes`.
- 🔧 La integración es unidireccional (orders → delivery-dispatch); no hay notificación de vuelta hacia `platform/orders` cuando la delivery termina.
- ❌ Escucha del evento `kds.order_ready` (o similar) para avanzar la delivery a "lista para recoger" y notificar al rider que puede venir a buscarla.
- ❌ Publicar `delivery.delivered` hacia `platform/orders` para que el pedido actualice su estado a entregado.
- ❌ Publicar hacia `platform/notifications` cuando la delivery llega a cada estado relevante (notificación al cliente de que el rider está en camino, ha recogido, etc.).
- ❌ Coordinar con `platform/pos` cuando el reparto forma parte de un ticket de TPV.

## 11. Incidencias y reasignación

- ✅ Estado `failed` para señalizar que la entrega no pudo completarse.
- ✅ Campo `reason` en `statusBody` que se almacena en el `delivery_event`.
- 🔧 No hay clasificación de tipo de incidencia (dirección errónea, cliente no localizado, accidente, pedido dañado…).
- ❌ Flujo de reasignación a otro rider: si la delivery queda en `failed` o `cancelled` con rider asignado, poder crear una nueva delivery para el mismo `order_id` y asignarla a otro rider.
- ❌ Escalado a operador cuando se producen N incidencias en poco tiempo (SLA incumplido) — podría REUSE `platform/scheduler`.
- ❌ Notificación al cliente y al restaurante en caso de incidencia grave.
- ❌ Reembolso automático cuando la delivery falla (REUSE `platform/payments` o `platform/splitpay`).

## 12. Integración con agregadores externos (Glovo, Uber Direct, Stuart)

- ✅ La tabla `deliveries` soporta `carrier IN ('own','glovo','uber','justeat','deliveroo','other')` y `external_ref` (referencia del agregador).
- ✅ Tabla `settings` con credenciales cifradas (AES-256-GCM) para Uber Direct, Glovo Partners y Stuart.
- ✅ Admin GET/PATCH para configurar las credenciales de cada proveedor (`/v1/delivery-dispatch/admin/config`).
- ✅ Toggle de entorno `sandbox/production` y flag `enabled` por proveedor.
- 🔧 Las credenciales se almacenan pero no hay código de llamada **saliente** a la API de ninguno de los tres proveedores — la integración real (crear pedido en Glovo, obtener ETA de Uber, asignar Stuart) sigue pendiente (`services/carriers.js` deja el punto de extensión documentado).
- ✅ Webhook entrante del agregador (`POST /v1/delivery-dispatch/webhooks/:provider`, público): verifica HMAC-SHA256 sobre el body crudo con el `*_webhook_secret` almacenado, localiza la delivery por `(carrier, external_ref)`, mapea el estado del proveedor al FSM interno (`services/carriers.js`) y auto-transiciona (respetando transiciones legales e idempotencia), emitiendo el evento Redis `delivery.<status>`.
- ❌ Cotización de coste de los agregadores para comparar con flota propia antes de decidir.
- ❌ Selección automática del proveedor más barato/rápido según zona y disponibilidad.
- ✅ Sincronización de estado: cuando el agregador reporta `delivered`/`picked_up`/`cancelled`/`failed` vía webhook, la delivery interna se auto-transiciona al estado equivalente.
- ❌ Credenciales per-tenant (hoy son a nivel plataforma, lo que limita tenants con cuentas propias de Glovo/Uber).

## 13. ETA y optimización de rutas

- ✅ Campo `estimated_minutes` en la delivery (fijado manualmente al crear o al recibir `order.paid`).
- ❌ Cálculo automático de ETA basado en distancia real y velocidad media del vehículo.
- ❌ Actualización dinámica del ETA a medida que el rider se mueve (recalcular con posición real).
- ❌ Integración con API de mapas/routing (Google Maps Directions, OSRM, Mapbox) para obtener la ruta óptima.
- ❌ Optimización multi-pedido (batching de rutas): dado un rider con N pedidos, calcular el orden óptimo de paradas.
- ❌ Notificación al cliente con ETA actualizado ("tu pedido llegará en ~12 minutos").
- ❌ Estimación de tiempo de cocina (TTR, time-to-ready) del KDS para mejorar la coordinación con la llegada del rider al restaurante.

## 14. Seguimiento del cliente (customer-facing tracker)

- ❌ Link de tracking público con token efímero (`/track/<token>`) accesible sin autenticación.
- ❌ Mapa embebible en tiempo real con posición del rider.
- ❌ Progreso visual de estados: "En preparación → Rider en camino → Casi ahí → Entregado".
- ❌ Notificaciones push/SMS al cliente en cada cambio de estado relevante (REUSE `platform/notifications`).
- ❌ Tiempo restante estimado visible al cliente.
- ❌ Canal de chat directo cliente ↔ rider o cliente ↔ restaurante para el pedido en curso (REUSE `platform/chat`).

## 15. Pago y liquidación a riders

- ❌ Registro de comisión/ganancia por entrega para cada rider.
- ❌ Acumulado periódico (diario/semanal/quincenal) de importes a pagar a cada rider.
- ❌ Liquidación automática vía Stripe Connect / transferencia bancaria — posible REUSE o adaptación de `platform/practitioner-payouts`.
- ❌ Desglose: tarifa base + km recorridos + propina recibida.
- ❌ Descuentos/penalizaciones por incidencias imputables al rider.
- ❌ Recibo/nómina periódico exportable por el rider.

## 16. Propinas al rider

- ❌ Campo `tip_cents` en la delivery para reflejar la propina declarada en el pedido.
- ❌ Propina seleccionable por el cliente en el checkout (porcentaje o importe fijo).
- ❌ Distribución de la propina al rider en la liquidación periódica.

## 17. Geocoding y direcciones

- ✅ La dirección de entrega (`drop_address`) y recogida (`pickup_address`) se almacenan como JSONB con campos `line1`, `city`, `postalCode`, `country`, `lat`, `lng` opcionales.
- 🔧 No hay geocoding automático: si la dirección llega sin coordenadas, no se calculan.
- ❌ Geocoding de dirección textual a coordenadas (Google Maps Geocoding, HERE, Nominatim/OpenStreetMap).
- ❌ Validación de que la dirección cae dentro de alguna zona activa del tenant.
- ❌ Normalización/autocompletado de dirección en el checkout (Places Autocomplete).
- ❌ Detección de direcciones duplicadas o sospechosas.

## 18. Slots de entrega programada

- ❌ Capacidad de elegir franja horaria de entrega en el checkout ("entregar el viernes 14:00-15:00").
- ❌ Tabla de slots disponibles por zona con capacidad máxima por franja.
- ❌ Reserva de slot al confirmar el pedido.
- ❌ Planificación anticipada de riders: asignar turnos sabiendo los slots comprometidos.
- ❌ Despacho diferido: la delivery se mantiene en `pending` hasta N minutos antes del slot.

## 19. Métricas y analítica de reparto

- ❌ Tiempo medio de entrega (desde `dispatched_at` hasta `delivered_at`) por tenant/zona/rider/franja.
- ❌ Tasa de éxito (delivered / total) y tasa de incidencias (failed + cancelled) por rider y zona.
- ❌ Pedidos por hora y capacidad utilizada vs. disponible.
- ❌ Distancia media recorrida y coste por kilómetro real vs. tarifado.
- ❌ Comparativa flota propia vs. agregador (coste, tiempo, tasa de éxito).
- ❌ Dashboards en tiempo real para el dispatcher (mapa con riders + pedidos en curso).
- ❌ Export CSV de deliveries filtrado por rango de fechas.
- ❌ Webhooks salientes o integración con BI externo (Metabase, Looker).

## 20. Multi-local y multi-tenant

- ✅ Aislamiento completo por `(app_id, tenant_id)` con RLS en todas las tablas.
- ✅ Un tenant puede tener múltiples zonas, múltiples riders y múltiples deliveries en paralelo.
- 🔧 `sub_tenant_id` se recibe en el contexto pero no se graba en ninguna tabla — no hay soporte de reparto multi-local dentro del mismo tenant (p. ej. una cadena con varias cocinas).
- ❌ Zonas por local (`sub_tenant_id`): que cada establecimiento de la cadena tenga sus propias zonas y riders.
- ❌ Transferencia de pedido entre locales (reasignar el despacho a otro establecimiento más cercano al cliente).
- ❌ Vista consolidada multi-local para el gestor de flota de la cadena.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ✅ ~~**Cotización de tarifa previa al checkout** (`GET /v1/delivery-dispatch/quote`)~~ (point-in-polygon + base_fee + per_km·distancia + validación min_order; `utils/geo.js`).
2. ✅ ~~**PATCH y DELETE de zonas y riders**~~ (CRUD completo; riders con soft-delete + motivo).
3. **Notificaciones al cliente por cambio de estado** — REUSE directo de `platform/notifications`; impacto en experiencia de usuario muy alto con poco código.
4. ✅ ~~**Webhook entrante de Glovo/Uber/Stuart** + **auto-transición de FSM**~~ (`POST /v1/delivery-dispatch/webhooks/:provider`, HMAC-verificado, mapeo de estado → FSM interno y emisión de evento Redis). La **llamada saliente** a las APIs de los proveedores sigue pendiente.
5. **Publicar `delivery.delivered` hacia `platform/orders`** — cierra el ciclo de estado del pedido; actualmente el pedido no sabe que fue entregado.
6. **Link de tracking público** — genera confianza del cliente, muy diferenciador; puede apoyarse en el campo `last_lat/lng` ya existente.
7. **Geocoding automático** de `drop_address` cuando no llegan coordenadas — necesario para point-in-polygon y cálculo de ETA real.
8. **ETA automático** basado en distancia + velocidad media por tipo de vehículo — coste bajo si ya se tiene geocoding.
9. **Liquidación a riders** (REUSE o adaptación de `platform/practitioner-payouts`) — necesario en cuanto los riders son autónomos o reciben nómina de la plataforma.
10. **Asignación automática por proximidad** — requiere geocoding y riders con GPS activo; eleva la operación de manual a semi-automática.
