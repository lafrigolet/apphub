# Casos de uso — `platform/orders` (platform-marketplace)

> Dominio: ledger persistente de pedidos de marketplace. Creación de pedidos con líneas de producto, máquina de estados (FSM) de ciclo de vida, totales (subtotal + tax + shipping), direcciones, historial de transiciones, registro de modificaciones post-creación e integración reactiva con `platform/splitpay` (cobro) y `platform/shipping` (entrega). Módulo de `platform-marketplace`, puerto 3100.

## Estado actual (implementado)

Creación de pedidos con ítems (SKU, nombre, cantidad, precio, vendedor opcional), cálculo de totales (subtotal + taxCents + shippingCents = totalCents), direcciones de envío y facturación, idempotencia por `(app_id, tenant_id, idempotency_key)`, FSM de estados `pending → paid → fulfilled → shipped → delivered → completed` con atajos y tres terminales (`cancelled`, `refunded`, `completed`), historial de transiciones `order_status_history` con actor y motivo, log de modificaciones post-creación `order_modifications` (dirección de envío, notas, ítems añadidos/eliminados/cambiados, totales ajustados), cambio de dirección de envío (solo en `pending`/`paid`), notas internas de staff, listado con filtros por comprador y estado + paginación, lectura completa de pedido (cabecera + ítems + direcciones + historial), consumo reactivo de eventos `splitpay.payment.completed` → `paid` y `shipping.shipment.delivered` → `delivered`, publicación de `order.created` / `order.<status>` / `order.modified`, hidratación del email del comprador desde `platform_auth.users` en el evento de transición (con fallback seguro si auth no está disponible), RLS por `(app_id, tenant_id)` en todas las tablas, rol dedicado `svc_platform_orders`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Creación de pedido

- ✅ `POST /v1/orders` — crea pedido con una o más líneas de producto.
- ✅ Cálculo automático de totales: `subtotalCents = Σ(qty × unitPriceCents)`, `totalCents = subtotal + taxCents + shippingCents`.
- ✅ Idempotencia: clave `idempotency_key` (unicidad compuesta por `app_id + tenant_id + key`) — reintentos devuelven el pedido existente sin efectos secundarios.
- ✅ Dirección de envío y dirección de facturación opcionales al crear.
- ✅ Campo `metadata JSONB` libre en cabecera y por ítem.
- ✅ Registro inicial en `order_status_history` con transición `null → pending`.
- ✅ Evento `order.created` publicado en `platform.events`.
- 🔧 `splitpay_split_rule_id` existe en el esquema pero no se asigna durante la creación — integración Splitpay al crear no está implementada.
- 🔧 `stripe_payment_intent_id` tiene `updatePaymentIntent` en el repositorio, pero no hay ruta ni servicio que lo llame — la creación del PaymentIntent no está conectada.
- ❌ Creación de pedido desde basket (`platform/basket`): no hay orquestador que traduzca `basket → order` + reserve stock en `platform/inventory`.
- ❌ Checkout con reserva atómica de stock (REUSE `platform/inventory`): sin verificación de disponibilidad ni decremento al crear el pedido.
- ❌ Pedido invitado (sin `buyer_user_id` registrado): el campo es `NOT NULL UUID`, no existe modo guest.
- ❌ Pre-order / pedido sobre producto sin stock (backorder).

## 2. Líneas de pedido (ítems)

- ✅ Múltiples ítems por pedido con `sku`, `product_name`, `qty`, `unit_price_cents`.
- ✅ Campo `vendor_tenant_id` por ítem para marketplace multi-vendedor.
- ✅ `metadata JSONB` por ítem (variantes, opciones, personalizaciones).
- 🔧 `product_name` se persiste como texto libre (snapshot en el momento del pedido) — no hay vínculo formal con `platform/catalog` ni validación de existencia del producto.
- ❌ Variantes de producto (talla, color, atributos) modeladas estructuralmente — solo existe `metadata` libre.
- ✅ Modificación de ítems post-creación con recalculo de totales via la API pública: `POST /v1/orders/:id/items`, `PATCH /v1/orders/:id/items/:itemId` (qty), `DELETE /v1/orders/:id/items/:itemId` — registran `item_added/item_removed/item_qty_changed` + `totals_adjusted` y publican `order.modified` (solo en `pending`/`paid`).
- ❌ Precio con descuento por ítem (campo `discount_cents` o `original_price_cents`).
- ❌ Precio de coste o margen registrado en el ledger.
- ❌ Bundle / kit (un ítem que desglosa en sub-ítems).

## 3. Precios, descuentos e impuestos

- ✅ `tax_cents` pasado desde el cliente en la creación y sumado al total.
- ✅ `shipping_cents` pasado desde el cliente y sumado al total.
- ✅ Divisa (`currency CHAR(3)`) por pedido.
- 🔧 Impuesto aceptado como valor calculado externamente — no hay motor de cálculo de IVA/impuestos en el módulo.
- ❌ Aplicación de cupones / códigos de descuento (REUSE potencial de `platform/catalog` o módulo propio).
- ❌ Descuentos por volumen, por usuario fidelizado, por campaña.
- ❌ IVA desglosado por tipo (21 %, 10 %, 4 %, exento) y por ítem.
- ❌ Campo `discount_cents` en cabecera de pedido.
- ❌ Motor de precios (precio base + reglas + modificadores por tenant/segmento).
- ❌ Multi-divisa con conversión de tipo de cambio.
- ❌ Precio bloqueado (precio garantizado hasta expiración del carrito).

## 4. FSM de estados — ciclo de vida del pedido

- ✅ Estados: `pending`, `paid`, `fulfilled`, `shipped`, `delivered`, `completed`, `cancelled`, `refunded`.
- ✅ Transiciones explícitas y controladas: `pending → paid|cancelled`, `paid → fulfilled|shipped|delivered|cancelled|refunded`, `fulfilled → shipped|delivered|refunded`, `shipped → delivered|refunded`, `delivered → completed|refunded`.
- ✅ Atajos (shortcuts) que permiten saltar etapas intermedias en setups MVP (`paid → delivered`).
- ✅ Estados terminales bloqueados (`completed`, `cancelled`, `refunded`): ninguna transición saliente.
- ✅ `PATCH /v1/orders/:id/status` para transiciones explícitas con motivo opcional.
- ✅ `POST /v1/orders/:id/cancel` — atajo a `changeStatus(..., 'cancelled')`.
- ✅ `POST /v1/orders/:id/refund` — atajo a `changeStatus(..., 'refunded')`.
- ✅ Rechazo con `409 ConflictError` en transiciones no permitidas (incluyendo origen desconocido).
- ✅ Rechazo con `404 NotFoundError` si el pedido no existe.
- 🔧 `cancelled` no distingue cancellation por comprador vs por vendedor vs por sistema (timeout, fraude).
- ❌ Estado `on_hold` (pedido en pausa por incidencia de pago, control de fraude, etc.).
- ❌ Estado `disputed` o vinculación con `platform/disputes`.
- ❌ Expiración automática de pedidos `pending` sin pago tras N minutos (REUSE `platform/scheduler`).
- ❌ `cancel_reason` y `refund_reason` como campos tipados (enum) más allá del texto libre.
- ❌ Apertura de pedido (`cancelled → pending`) en casos de error de sistema — la FSM no contempla "reapertura".

## 5. Historial y trazabilidad

- ✅ Tabla `order_status_history` con `from_status`, `to_status`, `actor_user_id`, `actor_role`, `reason`, `ts`.
- ✅ Registro inicial `null → pending` al crear el pedido.
- ✅ Tabla `order_modifications` append-only para cambios post-creación no-estado: `item_added`, `item_removed`, `item_qty_changed`, `shipping_address_changed`, `note_added`, `totals_adjusted`.
- ✅ `actor_user_id` + `actor_role` en cada modificación.
- ✅ `before_value` / `after_value` JSONB en modifications para diff auditable.
- ✅ `GET /v1/orders/:id/modifications` — listado de modificaciones.
- ✅ Pedido completo incluye `items + addresses + history` en un único GET.
- ❌ Timeline unificado (eventos de estado + modificaciones + notas + pagos + envíos) ordenado cronológicamente como vista de actividad.
- ❌ Vinculación de `order_status_history` con el `shipment_id` o `payment_intent_id` correspondiente.
- ❌ Audit log de quién consultó o exportó el pedido (acceso a PII).

## 6. Direcciones de envío y facturación

- ✅ Tabla `order_addresses` con `kind IN ('shipping', 'billing')`, campos estándar (líneas, ciudad, región, CP, país ISO-2, teléfono).
- ✅ Dirección de envío y facturación almacenadas como snapshot en el momento del pedido.
- ✅ `PUT /v1/orders/:id/shipping-address` — reemplaza la dirección de envío solo si el pedido está en `pending` o `paid`.
- ✅ La sustitución registra una entrada `shipping_address_changed` en `order_modifications` con `before`/`after`.
- ✅ Publicación de `order.modified` al cambiar la dirección.
- ❌ Modificación de dirección de facturación post-creación (no hay ruta equivalente para `billing`).
- ❌ Validación de dirección (normalización postal, verificación de código postal por país).
- ❌ Libreta de direcciones del comprador (REUSE potencial de `platform/auth` o módulo propio).
- ❌ Multi-destino: un pedido con ítems enviados a distintas direcciones.

## 7. Integración de pagos

- ✅ Campo `stripe_payment_intent_id` en `orders` para correlacionar con Stripe.
- ✅ Consumo del evento `splitpay.payment.completed` → transiciona automáticamente a `paid`.
- ✅ `splitpay_split_rule_id` en el esquema para vincular el pedido con la regla de reparto.
- 🔧 `updatePaymentIntent` existe en el repositorio pero no hay flujo de servicio que cree el PaymentIntent en Stripe ni lo asigne al pedido.
- ❌ Integración completa con `platform/payments`: creación del PaymentIntent, captura, confirmación → `paid`.
- ❌ Integración directa (no splitpay) para pedidos de un solo vendedor (charge simple).
- ❌ Reintento de pago sobre pedido `pending` tras fallo de autorización.
- ❌ Pago parcial / depósito + saldo (split de cobros en el tiempo).
- ❌ Métodos de pago alternativos (transferencia, contra reembolso, crédito del tenant).
- ❌ Webhook de Stripe procesado dentro del módulo (hoy depende de que `platform/splitpay` publique el evento).

## 8. Integración de envío

- ✅ Consumo del evento `shipping.shipment.delivered` → transiciona automáticamente a `delivered`.
- ✅ `shipping_cents` almacenado en el ledger del pedido.
- ❌ Creación de envío en `platform/shipping` al transicionar a `fulfilled` (publicar `order.fulfilled` para que shipping reaccione, o llamada HTTP directa).
- ✅ Enlace `shipment_id` en el pedido para trazabilidad (columna en `orders` + consumo de `shipping.shipment.created` → `linkShipment` → publica `order.modified` con `modificationType=shipment_linked`). `order.fulfilled` ya lo publica la FSM al transicionar.
- ❌ Tracking de envío visible en el contexto del pedido (URL / número de seguimiento).
- ❌ Pedidos con múltiples envíos parciales (fulfillment parcial por lote o por vendedor).
- ❌ Recálculo de `shipping_cents` al cambiar la dirección post-creación.

## 9. Integración de inventario

- ❌ Reserva de stock al crear el pedido (`platform/inventory`: decrement o hold).
- ❌ Liberación de stock al cancelar o no pagar en tiempo.
- ❌ Validación de disponibilidad antes de crear / añadir ítems.
- ❌ Notificación de agotado (`out_of_stock`) durante el checkout.
- ❌ Vuelta al stock al procesar una devolución/refund.

## 10. Cancelaciones

- ✅ `POST /v1/orders/:id/cancel` con motivo opcional.
- ✅ Solo permitido desde `pending` o `paid` (FSM).
- 🔧 Motivo es texto libre sin vocabulario controlado (`cancel_reason` enum).
- ❌ Cancelación parcial (cancelar solo algunos ítems del pedido).
- ❌ Política de cancelación por tenant (ventana de tiempo, cargos de cancelación).
- ❌ Flujo de aprobación de cancelación (el vendedor debe aprobar si ya está en `fulfilled`).
- ❌ Liberación automática de stock e invalidación del shipment al cancelar.
- ❌ Notificación al comprador (REUSE `platform/notifications`) al confirmar la cancelación.
- ❌ Expiración automática por pago no completado (REUSE `platform/scheduler`).

## 11. Devoluciones y reembolsos (RMA)

- ✅ `POST /v1/orders/:id/refund` → transición a `refunded`.
- ✅ Solo permitido desde `paid`, `fulfilled`, `shipped`, `delivered` (FSM).
- ❌ Flujo de devolución (RMA): solicitud del comprador, aprobación del vendedor, instrucciones de devolución de mercancía.
- ❌ Reembolso parcial (devolver solo N ítems del pedido).
- ❌ Reembolso proporcional en split multi-vendedor (regla: misma proporción que el cobro original — REUSE `platform/splitpay` reversals).
- ❌ Ejecución del reembolso en Stripe (`platform/payments` o `platform/splitpay`).
- ❌ Vinculación del `refund_id` de Stripe en el pedido.
- ❌ Gestión de devolución de mercancía (tracking de retorno).
- ❌ Crédito en tienda como alternativa al reembolso monetario.
- ❌ Restock automático al completar la devolución (`platform/inventory`).

## 12. Notas internas y comunicación de staff

- ✅ `POST /v1/orders/:id/notes` — añade nota interna (tipo `note_added` en `order_modifications`).
- ✅ Notas aceptadas en cualquier estado del pedido, incluyendo terminales.
- ✅ Las notas NO publican `order.modified` (son internas, no notifican al comprador).
- ❌ Visibilidad de notas diferenciada (nota interna de staff vs mensaje visible al comprador).
- ❌ Mensajería comprador ↔ vendedor sobre el pedido (REUSE `platform/messaging`).
- ❌ Notificaciones al comprador sobre estado del pedido (email, push) — REUSE `platform/notifications` suscribiéndose a `order.*`.
- ❌ Chat de soporte asociado al pedido (REUSE `platform/chat` modalidad support).

## 13. Modificación de pedido post-creación

- ✅ Tabla `order_modifications` con tipos: `item_added`, `item_removed`, `item_qty_changed`, `shipping_address_changed`, `note_added`, `totals_adjusted`.
- ✅ Cambio de dirección de envío implementado (`changeShippingAddress`) con guard de estado mutable (`pending`/`paid`).
- ✅ Notas internas implementadas (`addOrderNote`).
- ✅ Tipos `item_added`, `item_removed`, `item_qty_changed`, `totals_adjusted` generados por el servicio de edición de ítems (`addItem`/`removeItem`/`changeItemQty`).
- ✅ Añadir ítems post-creación con recalculo de totales (`POST /v1/orders/:id/items`).
- ✅ Eliminar ítems post-creación con recalculo de totales (`DELETE /v1/orders/:id/items/:itemId`).
- ✅ Cambiar cantidad de un ítem con recalculo (`PATCH /v1/orders/:id/items/:itemId`).
- 🔧 Ajuste manual de totales: cada edición de ítem emite un `totals_adjusted` (recalculo automático); el ajuste manual independiente (descuento/cargo arbitrario por staff sin tocar ítems) sigue pendiente.
- ❌ Aprobación de modificación por el comprador (flujo de confirmación de cambio).

## 14. Marketplace multi-vendedor (split de pedido)

- ✅ `vendor_tenant_id` por ítem — identifica a qué vendedor pertenece cada línea.
- ✅ `splitpay_split_rule_id` en cabecera de pedido para vincular con la regla de reparto de `platform/splitpay`.
- ❌ Split automático del pedido por `vendor_tenant_id` al pagar (creación de sub-órdenes o aplicación de split rule).
- ❌ Vista de "mis pedidos" por vendedor (filtrado del listado por `vendor_tenant_id` de los ítems).
- ❌ Notificaciones al vendedor cuando llega un nuevo pedido con sus ítems.
- ❌ Confirmación por parte del vendedor de que puede cumplir el pedido (`fulfilled` por vendedor).
- ❌ Pedido parcialmente cumplido: algunos vendedores confirman, otros no.
- ❌ Comisiones de plataforma sobre el pedido (integración con `platform/practitioner-payouts` o equivalente de marketplace).

## 15. Checkout desde basket

- ❌ Orquestador de checkout: `basket → validate stock → create order → create payment intent → redirect to payment`.
- ❌ Transferencia y vaciado de basket al crear el pedido (REUSE `platform/basket`).
- ❌ Bloqueo del basket durante el checkout para evitar modificaciones concurrentes.
- ❌ Expiración del pedido si el pago no se completa en N minutos → liberar stock y basket (REUSE `platform/scheduler`).
- ❌ Re-checkout sobre el mismo basket si el primer intento falla.

## 16. Pedidos de invitado (guest checkout)

- ❌ Creación de pedido sin `buyer_user_id` autenticado (campo actualmente `NOT NULL UUID`).
- ❌ Identificación del invitado por email en el pedido.
- ❌ Conversión de pedido guest a cuenta registrada (vinculación retroactiva al registrarse).
- ❌ Historial de pedidos de invitado accesible por email + token.

## 17. Re-order (repetición de pedido)

- ❌ Endpoint `POST /v1/orders/:id/reorder` — crea un nuevo pedido con los mismos ítems y precios actualizados.
- ❌ Validación de disponibilidad de stock y precio actual al re-ordenar.
- ❌ Descuento por fidelidad en re-orders.

## 18. Suscripciones / pedidos recurrentes

- ❌ Vinculación de un pedido a una suscripción de `platform/subscriptions`.
- ❌ Generación automática de pedidos recurrentes (REUSE `platform/scheduler`).
- ❌ Ciclo de vida de pedido recurrente: preview → confirmación → cobro → fulfillment.
- ❌ Pausa / cancelación de la recurrencia.

## 19. Facturación (Verifactu / AEAT)

- ❌ Generación de factura asociada al pedido (REUSE `platform/verifactu`): número correlativo, datos fiscales del comprador, IVA desglosado.
- ❌ Descarga de factura en PDF por el comprador.
- ❌ Envío automático de factura por email al pasar a `completed` (REUSE `platform/notifications`).
- ❌ Factura rectificativa al hacer un reembolso (abono).
- ❌ Datos fiscales del comprador en el pedido (NIF/CIF, razón social, dirección fiscal) — `billingAddress` existe pero sin campos fiscales específicos.

## 20. Eventos y mensajería asíncrona

- ✅ `order.created` — payload: `orderId, appId, tenantId, buyerUserId, items (sku+qty), totalCents, currency`.
- ✅ `order.<status>` (paid, fulfilled, shipped, delivered, completed, cancelled, refunded) — payload incluye `buyerEmail` hidratado desde `platform_auth`.
- ✅ `order.modified` — publicado en cambio de dirección de envío con `modificationType` y `modificationId`.
- ✅ Consumo de `splitpay.payment.completed` → `paid`.
- ✅ Consumo de `shipping.shipment.created` → backfill de `shipment_id` (sin avanzar estado).
- ✅ Consumo de `shipping.shipment.delivered` → `delivered`.
- ✅ `order.modified` con `modificationType` `item_added`/`item_removed`/`item_qty_changed`/`shipment_linked` (edición de ítems + enlace de envío).
- ✅ Errores en el consumidor se absorben sin crashear el subscriber.
- ❌ `order.expired` — pedido eliminado por timeout de pago (no existe el job en `platform/scheduler`).
- ❌ `order.item_modified` — para cambios de ítems (no implementado).
- ❌ Consumo de `inventory.stock.restored` para liberar pedidos en hold/backorder.
- ❌ Consumo de `basket.checkout_initiated` para abrir el checkout automáticamente.
- ❌ Dead-letter / replay de eventos fallidos.

## 21. Listado, búsqueda y reporting

- ✅ `GET /v1/orders` con filtros por `buyerUserId`, `status`, `limit`, `offset`.
- ✅ Paginación con `limit` (default 50) y `offset`.
- ✅ Ordenado por `created_at DESC`.
- ✅ Filtro por rango de fechas (`createdAfter`, `createdBefore`) en `GET /v1/orders` y en el export.
- ✅ Filtro por `vendorTenantId` (vista vendedor) vía subquery `EXISTS` sobre `order_items` (scoped por app/tenant).
- ✅ Filtro por rango de importe (`totalMinCents`, `totalMaxCents`).
- ❌ Búsqueda full-text por nombre de producto, SKU, o datos del comprador.
- ❌ Paginación por cursor (keyset pagination) para conjuntos grandes.
- ❌ Aggregaciones: ingresos por periodo, pedidos por estado, AOV (average order value), tasa de cancelación.
- ✅ Export CSV de pedidos para contabilidad o remisión a terceros (`GET /v1/orders/export.csv`, mismos filtros, cap de 50 000 filas). XLSX sigue pendiente.
- ❌ Informes de vendedor: ventas propias, comisiones, devoluciones.
- ❌ Dashboard de operaciones (órdenes pendientes de fulfill, SLA de envío, etc.).

## 22. Idempotencia y concurrencia

- ✅ Índice UNIQUE en `(app_id, tenant_id, idempotency_key)` — nivel de base de datos.
- ✅ Chequeo de clave idempotente al inicio de `createOrder` dentro de la transacción.
- ✅ `withTenantTransaction` aplica `SET LOCAL app.app_id / app.tenant_id` antes de cada consulta (RLS).
- ❌ Idempotencia en transiciones de estado (`PATCH /status`) — actualmente no se rechaza un `PATCH` duplicado con el mismo `to_status` si ya estaba en ese estado.
- ❌ Bloqueo optimista (campo `version` / `ETag`) para evitar actualizaciones concurrentes de totales.
- ❌ Idempotencia en cambio de dirección de envío.

## 23. Multi-tenant / multi-app

- ✅ RLS por `(app_id, tenant_id)` en todas las tablas: `orders`, `order_items`, `order_addresses`, `order_status_history`, `order_modifications`.
- ✅ Índice compuesto `(tenant_id, status, created_at DESC)` para performance de listado por tenant.
- ✅ `sub_tenant_id` nullable en la cabecera del pedido (soporta modelos de dos niveles de tenencia).
- ✅ `appId` propagado en todos los eventos — consumidores pueden filtrar por app.
- ❌ Visibilidad cross-tenant controlada (e.g. plataforma puede ver pedidos de todos los tenants para soporte).
- ❌ Quotas o límites de pedidos por tenant.

## 24. Seguridad y GDPR

- ✅ RLS garantiza que un token de tenant A no puede leer pedidos de tenant B aunque compartan `tenant_id`.
- ✅ Rol dedicado `svc_platform_orders` con mínimos privilegios — nunca usa el superusuario en runtime.
- 🔧 `GRANT SELECT ON platform_auth.users` concedido a `svc_platform_orders` en la migración 0002 — es una excepción documentada y acotada al campo `email` con fallback.
- ❌ Anonimización/pseudonimización de `buyer_user_id` y datos de dirección al ejercer el derecho de borrado (GDPR Art. 17).
- ❌ Purga automática de pedidos antiguos o de datos PII pasado el periodo de retención legal (REUSE `platform/scheduler`).
- ❌ Enmascaramiento de dirección en respuestas para roles con acceso limitado.
- ❌ Audit log de acceso a PII del pedido (quién y cuándo consultó direcciones o email del comprador).
- ❌ Consentimiento explícito del comprador para tratamiento de datos del pedido (LOPDGDD).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Checkout desde basket + reserva de stock** (REUSE `platform/basket` + `platform/inventory`) — completa el flujo de compra extremo a extremo y es el prerequisito de casi todo lo demás.
2. **Crear PaymentIntent en Stripe al crear el pedido** — conecta el ledger de pedidos con el módulo de pagos; `stripe_payment_intent_id` y `updatePaymentIntent` ya están listos en el repositorio.
3. **Notificaciones al comprador** via `platform/notifications` suscribiéndose a `order.paid`, `order.shipped`, `order.delivered`, `order.cancelled` — alto valor percibido, coste casi nulo (el event bus ya publica los eventos con `buyerEmail` hidratado).
4. ✅ ~~**Modificación de ítems post-creación**~~ (`item_added`, `item_removed`, `item_qty_changed`, `totals_adjusted`) — implementado: servicio `addItem`/`removeItem`/`changeItemQty` + rutas `POST/PATCH/DELETE /v1/orders/:id/items` con recalculo de totales y publicación de `order.modified`.
5. 🔧 **Creación de envío en `platform/shipping`** al transicionar a `fulfilled` + vinculación de `shipment_id` en el pedido — núcleo dentro de `orders` implementado: columna `shipment_id`, consumo de `shipping.shipment.created` (`linkShipment`) y `order.fulfilled` ya lo publica la FSM. **Pendiente (cross-cutting)**: que `platform/shipping` consuma `order.fulfilled` y cree el shipment + emita `shipping.shipment.created`.
6. **Reembolso proporcional con Splitpay** al marcar `refunded` — obligatorio para marketplace multi-vendedor; seguir la regla de reversals proporcionales del ADR/CLAUDE.md.
7. **Expiración de pedidos `pending` sin pago** (REUSE `platform/scheduler` — job `order-expiry`) — evita pedidos zombis y libera stock.
8. ✅ ~~**Export CSV de pedidos**~~ filtrado por rango de fechas — implementado: `GET /v1/orders/export.csv` con filtros de fecha/importe/vendor/estado/comprador (cap de 50 000 filas), y los mismos filtros añadidos a `GET /v1/orders`.
9. **Facturación vía `platform/verifactu`** al completar el pedido — obligatorio en España para cualquier comercio digital sujeto a TicketBAI / Verifactu.
10. **GDPR**: anonimización de PII + purga por retención (`platform/scheduler`) — obligatorio en España/UE.
