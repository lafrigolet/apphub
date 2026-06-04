# Casos de uso — `platform/shipping` (platform-marketplace)

> Dominio: logística de paquetería y transportistas. Cubre zonas geográficas de envío, tarifas (por peso/rango), creación y seguimiento de envíos (shipments), multi-paquete por pedido, webhooks de transportista, devoluciones/RMA y configuración de credenciales de carriers externos (UPS, FedEx, DHL, EasyPost). **No confundir con `platform/delivery-dispatch`** (reparto local in-house con riders propios, GPS en tiempo real y despacho de flota — contenedor `platform-restaurant`). Shipping es paquetería saliente y devoluciones; delivery-dispatch es la última milla operada por el propio tenant.

## Estado actual (implementado)

Zonas (`shipping_zones`) con `country_codes[]` + `region_codes[]`; tarifas (`shipping_rates`) por zona con rango de peso (`min_weight_g`, `max_weight_g`) y ETA (`eta_days_min/max`); cotización de tarifa (`GET /v1/shipping/quote?country=XX`); envíos (`shipments`) con FSM `pending → in_transit → delivered / returned`; log de eventos de tracking (`shipment_events`); multi-paquete (`shipment_packages`) con dimensiones + código de tracking individual; seguro (`insurance_amount_cents`) y firma requerida (`signature_required`); webhooks entrantes de transportistas (UPS/FedEx/DHL/EasyPost) con verificación HMAC (EasyPost completo, resto parcial), registro idempotente (`carrier_webhook_events`) y auto-transición de estado; configuración de credenciales de transportistas (AES-256-GCM, admin); RMA completo (`returns` + `return_items`) con FSM `requested → approved → label_issued → shipped → received → restocked → refunded / rejected / cancelled`; eventos en `platform.events` (`shipping.shipment.created/shipped/delivered`, `return.*`, `inventory.restock.requested`, `return.refund.requested`); escucha de `order.paid` para crear envío automático; aislamiento por `(app_id, tenant_id)` con RLS en todas las tablas.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## Frontera shipping vs. delivery-dispatch

| Criterio | `platform/shipping` | `platform/delivery-dispatch` |
|---|---|---|
| Transportista | Carrier externo (UPS, FedEx, DHL, EasyPost…) | Riders propios del tenant |
| Tracking | Webhook del carrier + log manual | GPS en tiempo real, plataforma interna |
| Pedido base | `platform/orders` | `platform/pos` / `platform/orders` |
| Devoluciones RMA | ✅ Implementado | ❌ Fuera de ámbito |
| Contenedor | `platform-marketplace` (puerto 3100) | `platform-restaurant` (puerto 3200) |

---

## 1. Zonas de envío

- ✅ Crear zona con nombre + lista de países (`country_codes: TEXT[]`) y regiones (`region_codes: TEXT[]`).
- ✅ Listar zonas del tenant.
- ✅ Aislamiento RLS por `(app_id, tenant_id)`.
- ✅ Actualización (`PATCH /v1/shipping/zones/:id`) y borrado (`DELETE /v1/shipping/zones/:id`) de zona.
- ❌ Zona "resto del mundo" / comodín para países no cubiertos explícitamente.
- ❌ Zonas por código postal (ZIP/CP ranges) o polígono geográfico.
- ❌ Zonas excluidas/prohibidas (países con embargo, regiones sin cobertura).
- ❌ Prioridad / solapamiento de zonas: cuando un país pertenece a varias zonas, sin regla de desempate.
- ❌ Importación masiva de códigos país/región.

## 2. Tarifas de envío

- ✅ Crear tarifa asociada a una zona: `name`, `price_cents`, `min_weight_g`, `max_weight_g`, `eta_days_min/max`.
- ✅ Tarifas sin zona asignada (globales, aplican a todos los destinos del tenant).
- ✅ Listar tarifas, filtro opcional por `zone_id`.
- ✅ Varios tramos de peso en la misma zona (múltiples filas de tarifa).
- 🔧 Criterio de tarifa por peso + free-shipping threshold por valor del pedido; aún sin tramos por cantidad de artículos (`qty`) ni por volumen/dimensiones.
- ✅ Actualización (`PATCH /v1/shipping/rates/:id`) y borrado (`DELETE /v1/shipping/rates/:id`) de tarifa.
- ❌ Tarifa plana fija (ya posible: `min_weight_g=0`, `max_weight_g=null`, pero sin etiqueta semántica "flat rate").
- ✅ Envío gratuito a partir de X€ de pedido (`free_above_cents` en `shipping_rates`); el quote devuelve `effective_price_cents=0` + `free_shipping_applied=true` cuando `orderValueCents >= free_above_cents`.
- ✅ Tarifas por velocidad/nivel de servicio (`service_level`: `economy`/`standard`/`express`/`overnight`/`in_store_pickup`) como dimensión explícita.
- ❌ Descuentos por volumen (escalas de precio según número de envíos del tenant en el periodo).
- ❌ Tarifa negociada por carrier (conectar a la tabla de credenciales para obtener rate en tiempo real).
- ✅ Activar/desactivar tarifa sin borrarla (campo `active`; el quote solo devuelve `active=TRUE`).
- ❌ Ordenación personalizada de tarifas presentadas al comprador.

## 3. Cotización en el checkout

- ✅ `GET /v1/shipping/quote?country=XX` — devuelve las tarifas aplicables a ese país de destino, ordenadas por precio.
- ✅ Tarifas globales (sin zona) incluidas siempre en la cotización.
- ✅ La cotización acepta `weightG` (peso del carrito) y aplica `min_weight_g/max_weight_g` en la query; también acepta `orderValueCents` para resolver free-shipping. `GET /v1/shipping/quote?country=XX&weightG=NNN&orderValueCents=NNN`.
- 🔧 Quote con peso real del pedido: el endpoint ya filtra por `weightG`; falta la integración automática que lo deriva de `platform/basket` o `platform/orders` (hoy lo pasa el llamante).
- ❌ Quote multi-destino (un pedido con ítems enviados a direcciones distintas).
- ❌ Estimación de entrega dinámica (ETA) basada en día/hora de corte del transportista.
- ❌ Rate-shopping en tiempo real contra APIs de UPS/FedEx/DHL/EasyPost para obtener precios reales al checkout (hoy solo tarifas configuradas manualmente).
- ❌ Presentar múltiples opciones de servicio por carrier (economy vs. express).
- ❌ Caché de cotizaciones externas con TTL en Redis.
- ❌ Cotización por código postal destino (más granular que solo país).

## 4. Creación y gestión de envíos

- ✅ Crear envío (`POST /v1/shipping/shipments`) vinculado a `order_id`, con `carrier`, `tracking_code`, `rate_id`, `metadata`, `insurance_amount_cents`, `insurance_currency`, `signature_required`.
- ✅ Obtener envío con su log de eventos (`GET /v1/shipping/shipments/:id`).
- ✅ Creación automática de envío al recibir el evento `order.paid` (status inicial `pending`).
- ✅ Aislamiento RLS + índices por `order_id` y `(tenant_id, status)`.
- 🔧 Solo un envío por pedido en la creación automática desde `order.paid`; multi-envío (split shipment) requiere llamadas manuales.
- 🔧 No hay endpoint de actualización general del envío (no se puede corregir carrier o tracking_code después de crearlo, solo vía transiciones de estado/evento).
- ✅ Listar envíos del tenant (`GET /v1/shipping/shipments` con filtros `status`, `carrier`, `orderId`, `createdSince`, `limit` acotado 1..200).
- ✅ Listar envíos por `order_id` (`GET /v1/shipping/shipments?orderId=…`).
- ❌ Cancelación de envío (estado `cancelled`).
- ❌ División de un pedido en múltiples envíos (split shipment por warehouse o vendor).
- ❌ Envío parcial (partial fulfillment) — ítems de una línea del pedido enviados en varias tandas.
- ✅ Fecha estimada de entrega almacenada en el envío (`estimated_delivery_date`, calculada al crear como `eta_days_max` de la tarifa en días laborables saltando fines de semana; se publica en `shipping.shipment.created`).
- ❌ Dirección de destino almacenada en el envío (hoy solo `order_id`).

## 5. Multi-paquete por envío

- ✅ Tabla `shipment_packages` — cada paquete tiene `package_number`, `carrier`, `tracking_code`, dimensiones (`weight_grams`, `length_mm`, `width_mm`, `height_mm`), estado propio y timestamps.
- ✅ Auto-numeración de `package_number` si no se indica.
- ✅ Listar paquetes de un envío (`GET /v1/shipping/shipments/:id/packages`).
- ✅ Añadir paquete a un envío existente (`POST /v1/shipping/shipments/:id/packages`).
- ✅ Tracking cruzado: webhook del carrier resuelve `shipment_id` buscando el `tracking_code` en `shipment_packages`.
- ✅ Índice por `tracking_code` para lookup O(1).
- ❌ Actualizar o eliminar un paquete tras añadirlo.
- ❌ Estado del envío padre derivado automáticamente del estado de sus paquetes (e.g. `delivered` solo cuando todos los paquetes están `delivered`).
- ❌ Peso total del envío calculado como suma de paquetes.
- ❌ Reglas de empaquetado automáticas (cómo agrupar ítems del pedido en paquetes según dimensiones/peso).
- ❌ Packing slip / lista de contenido por paquete.

## 6. Seguimiento (tracking) y FSM de estado

- ✅ Log de eventos de tracking (`shipment_events`) con `code`, `description`, `location`, `ts`; ordenado cronológicamente.
- ✅ Endpoint para añadir evento manualmente (`POST /v1/shipping/shipments/:id/events`).
- ✅ FSM implícito: código `shipped`/`in_transit` → estado `in_transit` + `shipped_at`; `delivered` → `delivered` + `delivered_at`; `returned` → `returned`.
- ✅ Publicación de eventos de plataforma: `shipping.shipment.shipped`, `shipping.shipment.delivered`.
- ✅ Eventos de tracking también en `shipment_packages` (estado por paquete individual).
- 🔧 Estados del envío: `pending`, `in_transit`, `delivered`, `returned` — falta `cancelled`, `failed`, `lost`, `on_hold`, `out_for_delivery`, `attempted_delivery`.
- ❌ Transiciones de estado explícitas con validación FSM (actualmente cualquier código arbitrario puede enviarse sin guardia; solo `shipped/in_transit/delivered/returned` tienen efecto).
- ❌ Tracking público por token (buyer consulta sin JWT).
- ❌ Enlace de tracking del carrier (URL al portal de seguimiento del transportista).
- ❌ Polling activo contra APIs de carrier para refrescar tracking sin depender de webhooks.
- ❌ ETA actualizada dinámicamente a medida que el envío avanza por checkpoints.
- ❌ Alertas de retraso o anomalía (paquete sin movimiento N días tras `in_transit`).

## 7. Webhooks de transportistas

- ✅ Endpoint público `POST /v1/shipping/webhooks/:carrier` (UPS/FedEx/DHL/EasyPost) — sin JWT.
- ✅ Registro idempotente en `carrier_webhook_events` con `(carrier, event_external_id)` UNIQUE — duplicados descartados silenciosamente.
- ✅ Verificación HMAC para EasyPost + UPS (HMAC-SHA256) y DHL (HMAC-SHA1), usando los secretos cifrados de `settings` (`easypost_webhook_secret`, `ups_client_secret`, `dhl_api_secret`); `signature_valid` almacenado en la tabla.
- ✅ Auto-transición del envío y paquete al recibir `in_transit`, `delivered`, `returned` desde el payload del carrier.
- ✅ Persistencia del payload completo en `JSONB` para auditoría.
- ✅ Índice de webhooks no procesados (`WHERE processed_at IS NULL`) para re-procesamiento.
- 🔧 Verificación de firma implementada para EasyPost + UPS (HMAC-SHA256) y DHL (HMAC-SHA1); FedEx (Bearer token) aún recibe el payload y lo persiste con `signature_valid = NULL`.
- 🔧 La resolución del tenant (`app_id`, `tenant_id`) en el webhook depende de que el `tracking_code` esté registrado en `shipment_packages`; si el paquete se creó sin `tracking_code` el webhook queda sin vincular.
- ❌ Re-procesamiento automático de webhooks no vinculados / `signature_valid=null` (hoy queda como registro inerte).
- ❌ Alerta a staff cuando llega un webhook con firma inválida.
- ❌ Soporte para otros carriers (SEUR, MRW, Correos, GLS, Chronopost, Australia Post…).
- ❌ Retry del carrier cuando respondemos 5xx (garantía de entrega del webhook).
- ❌ Dashboard de eventos de webhook recibidos (¿cuántos por carrier?, ¿cuántos sin procesar?).

## 8. Rate-shopping y generación de etiquetas (carriers API)

- ✅ Configuración de credenciales para UPS, FedEx, DHL y EasyPost (cifradas AES-256-GCM) en tabla `settings`.
- ✅ Admin para gestionar credenciales (`GET/PATCH /v1/shipping/admin/config`, requiere `super_admin|staff`).
- 🔧 Las credenciales están almacenadas pero **no hay integración real** con las APIs de los carriers: no se llama a UPS/FedEx/DHL/EasyPost para obtener tarifas ni generar etiquetas desde el código de producción.
- ❌ Rate-shopping real: cotizar el mismo envío contra múltiples carriers y devolver la opción más barata o más rápida.
- ❌ Generación de etiquetas de envío (label generation): llamada a carrier API → PDF/ZPL → URL almacenada en el paquete (REUSE `platform/storage` para el PDF).
- ❌ Validación de dirección de destino contra APIs de carrier antes de generar etiqueta.
- ❌ Manifest / EOD (End of Day) para cierre de jornada con UPS/FedEx.
- ❌ Pickup scheduling (solicitar recogida al carrier).
- ❌ Multi-carrier aggregator (EasyPost ya soportado en settings; activar llamada real a su API de rates + labels).
- ❌ Sandbox / production toggle por carrier (campo `*_environment` ya existe en settings, listo para usarse).

## 9. Seguro y opciones de envío premium

- ✅ Campo `insurance_amount_cents` + `insurance_currency` en `shipments`.
- ✅ Campo `signature_required` (boolean) en `shipments`, pasado al carrier en la generación de etiqueta (cuando se implemente).
- ❌ Activación de seguro como opción de checkout para el comprador (checkbox + sobreprecio calculado automáticamente).
- ❌ Integración con proveedor de seguros externo (declaración de valor al carrier).
- ❌ Gestión de reclamaciones de seguro (claim workflow).
- ❌ Opciones adicionales: adulto-only delivery, leave-safe, instrucciones de entrega, safe place.
- ❌ Restricciones de contenido (artículos peligrosos, materiales regulados) con validaciones.

## 10. Devoluciones / RMA

- ✅ Solicitud de devolución del comprador (`POST /v1/shipping/returns`) con `order_id`, `reason`, lista de ítems (`sku`, `qty`, `reason`, `condition`, `unit_price_cents`).
- ✅ FSM completo: `requested → approved → label_issued → shipped → received → restocked → refunded / rejected / cancelled`.
- ✅ Aprobación y rechazo por staff/admin con `decision_notes`.
- ✅ Emisión de etiqueta de devolución (`issue-label`) con carrier + tracking_code optativos (entrada manual mientras no hay label generation automática).
- ✅ Marcado de enviado por el comprador con `tracking_code` optativo.
- ✅ Recepción en almacén con `qty_received` y `condition` (`new`, `open_box`, `used`, `damaged`, `missing`) por línea.
- ✅ Restock automático de ítems en condición `new`/`open_box`: publica `return.restocked` + `inventory.restock.requested` por SKU (consumido por `platform/inventory`).
- ✅ Solo ítems `damaged`, `used`, `missing` quedan sin restock (permanecen en el return para reporting).
- ✅ Reembolso: publica `return.refund.requested` → `platform/splitpay` emite el Stripe refund.
- ✅ Cancelación por el comprador o staff (desde `requested` o `approved`).
- ✅ Listar devoluciones con filtros: `status`, `orderId`, `buyerUserId`, paginación `limit`.
- ✅ Eventos de plataforma en cada transición: `return.requested`, `return.approved`, `return.rejected`, `return.label_issued`, `return.shipped`, `return.received`, `return.restocked`, `return.refund.requested`, `return.refunded`, `return.cancelled`.
- ✅ Tabla `return_items` con `qty_received` independiente de `qty` (permite recepción parcial).
- 🔧 Solo staff puede emitir la etiqueta — no hay generación automática de pre-paid label desde la API del carrier.
- 🔧 Un retorno puede transitar a `restocked` o `refunded` de forma independiente (modelo flexible), pero el código de `refundReturn` solo permite `refunded` desde `received` o `restocked`, no desde `label_issued` directamente.
- ❌ Política de devolución por tenant configurable (ventana de días, condiciones aceptadas, artículos excluidos).
- ❌ Portal de auto-gestión de devoluciones para el comprador (buyer self-service returns).
- ❌ QR code / portal de etiqueta pública para el comprador (genera la etiqueta sin login).
- ❌ Reembolso parcial proporcional a ítems recibidos (hoy `amountCents` es libre, staff lo fija manualmente).
- ❌ Cambio / sustitución de artículo en lugar de reembolso (exchange flow).
- ❌ Devolución en tienda física (in-store return vinculada a un RMA).
- ❌ Despacho automático de etiqueta al comprador por email (REUSE `platform/notifications`).
- ❌ Dashboard de KPIs de devoluciones: tasa por SKU, coste total, motivos frecuentes.

## 11. Dropshipping / multi-vendor

- ❌ Envíos directamente desde el proveedor/vendor al comprador (dropship flow).
- ❌ `vendor_id` / `sub_tenant_id` en el envío para segmentar por proveedor.
- ❌ Notificación al vendor de que tiene que preparar/enviar un pedido.
- ❌ Consolidación de envíos de múltiples vendors en un solo paquete (ship-from-same-warehouse).
- ❌ Reglas de fulfillment: desde qué almacén/vendor enviar según disponibilidad de stock.

## 12. Click & collect / recogida en tienda

- ❌ Opción de envío "recogida en tienda" (`in_store_pickup`) como tipo de tarifa especial.
- ❌ Ubicaciones de recogida configurables por tenant (tiendas, oficinas, almacenes).
- ❌ Slot de recogida (fecha/hora) reservado por el comprador (REUSE `platform/availability`).
- ❌ Notificación "tu pedido está listo para recoger" (REUSE `platform/notifications`).
- ❌ QR code o PIN de verificación para entregar el pedido en mostrador.
- ❌ Registro de recogida efectuada (quién lo recogió, cuándo).

## 13. Puntos de conveniencia / lockers

- ❌ Catálogo de puntos de entrega (lockers, tiendas PUDO — Pick Up Drop Off).
- ❌ Integración con redes de puntos (InPost, Correos, Amazon Locker, Kiala, Mondial Relay).
- ❌ Selección de punto de entrega en el checkout como alternativa a la dirección de domicilio.
- ❌ Notificación al comprador cuando el paquete llega al locker + código de apertura.
- ❌ TTL en locker (paquete devuelto al seller si no recoge en N días).

## 14. Comercio internacional y aduanas

- ❌ Formularios aduaneros (CN22/CN23, Commercial Invoice) generados al crear el envío.
- ❌ Código HS (Harmonized System) por SKU de catálogo para declaración aduanera.
- ❌ Valor declarado de la mercancía por paquete.
- ❌ Cálculo de impuestos de importación / aranceles estimados para el comprador (DDP vs DDU).
- ❌ Restricciones de importación por país (artículos prohibidos, cuotas).
- ❌ EORI number / VAT number del exportador almacenado por tenant.
- ❌ Integración con servicios de aduanas electrónicas (ICS2 — UE, CBP ACE — EEUU).
- ❌ Multi-moneda en `insurance_currency` y `refund_currency`: validación real de código ISO 4217.

## 15. Estimación de entrega (SLA / ETA)

- ✅ Campos `eta_days_min` / `eta_days_max` en la tarifa como referencia estática.
- ✅ ETA calculada y guardada en el envío concreto (`estimated_delivery_date`) al crearlo.
- 🔧 ETA calculada al crear el envío: usa días laborables (salta sábados/domingos) sobre `eta_days_max` de la tarifa; aún sin calendario de festivos por país/región.
- ❌ Calendario de corte del carrier (cutoff time) por zona — pedido después de las 14:00 se envía al día siguiente.
- ❌ ETA dinámica actualizada por webhooks de carrier (carrier comunica fecha comprometida).
- ❌ "Entregado a tiempo" vs. "entregado tarde" para SLA reporting.
- ❌ ETA comunicada al comprador en la confirmación de pedido (REUSE `platform/notifications`).
- ❌ Promesa de entrega en el checkout ("llega el jueves si pides antes de las 15:00").

## 16. Notificaciones al cliente

- ✅ Eventos de plataforma publicados (`shipping.shipment.shipped`, `shipping.shipment.delivered`, `return.*`) — otros módulos pueden suscribirse.
- 🔧 Ninguna notificación directa al comprador está implementada dentro del módulo — depende de que otro módulo (e.g. un listener ad-hoc en el portal) consuma los eventos.
- ❌ Notificaciones de ciclo de vida del envío al comprador: confirmación de envío, en camino, entregado, intento fallido, retraso (REUSE `platform/notifications`).
- ❌ Notificaciones de devolución al comprador: solicitud recibida, aprobada/rechazada, etiqueta emitida, reembolso procesado (REUSE `platform/notifications`).
- ❌ Notificaciones al vendor / fulfillment team: nuevo pedido a preparar, devolución recibida en almacén.
- ❌ Preferencias de notificación del comprador (email vs. push vs. SMS).
- ❌ Tracking link personalizado por tenant (branded tracking page).

## 17. Reglas de configuración por tenant

- ✅ Zonas y tarifas son por `(app_id, tenant_id)` — cada tenant configura las suyas de forma completamente independiente.
- ✅ Credenciales de carrier (`settings`) son globales al módulo (nivel plataforma), no por tenant — correcto para SaaS donde un solo operador usa los mismos contratos con UPS/FedEx.
- 🔧 No hay reglas de envío condicionales por tenant (e.g. "solo envíos nacionales para el plan básico").
- ❌ Configuración de carrier preferido por defecto del tenant.
- ❌ Restricciones de envío por plan de suscripción del tenant (REUSE `platform/subscriptions`).
- ❌ Mensaje personalizado del tenant al comprador en el email de envío.
- ❌ Logo del tenant en la etiqueta de envío generada.
- ❌ Reglas de empaquetado del tenant (caja estándar, dimensiones máximas, material de embalaje).

## 18. Analítica y reporting

- ❌ Dashboard de envíos: total por estado, por carrier, por zona, por periodo.
- ❌ Tiempo medio de preparación (pedido pagado → envío creado).
- ❌ Tiempo medio de entrega real vs. ETA comprometida.
- ❌ Tasa de entrega a la primera / intentos de entrega.
- ❌ Coste de envío total por tenant / por canal.
- ❌ Envíos perdidos o con incidencia (estado `returned` sin RMA abierto, webhooks sin resolver).
- ❌ KPIs de devoluciones: tasa, coste, motivos, SKUs con mayor devolución.
- ❌ Export CSV de envíos / devoluciones filtrados.
- ❌ Cohortes de tiempo: envíos por semana/mes, tendencia.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Notificaciones al comprador** (shipped / delivered / devolución aprobada / reembolso) — REUSE `platform/notifications` escuchando `shipping.shipment.*` y `return.*`; alta visibilidad para el comprador con coste bajo.
2. **Rate-shopping real con EasyPost** — las credenciales ya están almacenadas; conectar la llamada a `GET /rates` de EasyPost en `quote()` y añadir label generation (`POST /shipments` de EasyPost → PDF a S3 via `platform/storage`).
3. ✅ ~~**Filtro por peso en el quote**~~ — `GET /quote` acepta `weightG` y aplica `min/max_weight_g` en la query.
4. ✅ ~~**Envío gratuito a partir de X€**~~ — `free_above_cents` en `shipping_rates`; el quote devuelve `effective_price_cents=0` + `free_shipping_applied=true` cuando el pedido supera el umbral (precio base preservado).
5. ✅ ~~**PATCH zona y tarifa + listar envíos por pedido**~~ — `PATCH/DELETE` de zonas y tarifas (incl. `active` para desactivar), `GET /v1/shipping/shipments` con filtros (incl. `orderId`).
6. ✅ ~~**Verificación HMAC para UPS y DHL**~~ — UPS (HMAC-SHA256, `ups_client_secret`) y DHL (HMAC-SHA1, `dhl_api_secret`) verificados sobre el raw body; `signature_valid` persistido.
7. ✅ ~~**ETA en el envío**~~ — `estimated_delivery_date` calculado al crear (días laborables sobre `eta_days_max` de la tarifa) y publicado en `shipping.shipment.created`. (Festivos y notificación al comprador: pendientes/cross-cutting.)
8. **Política de devolución configurable por tenant** — ventana de días y condiciones aceptadas como parámetros en `tenant-config`; el servicio de devoluciones valida contra ellos.
9. 🔧 **Click & collect** — `in_store_pickup` ya disponible como `service_level` de tarifa; faltan ubicaciones de recogida, slot y verificación.
10. **Aduanas internacionales** — código HS por SKU + formulario CN22/CN23 al generar la etiqueta; requisito legal para envíos fuera de la UE.
