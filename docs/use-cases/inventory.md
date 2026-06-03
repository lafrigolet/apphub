# Casos de uso — `platform/inventory` (platform-marketplace)

> Dominio: stock por SKU, scoped a `(app_id, tenant_id)`. Niveles de stock disponible/comprometido, reservas atómicas con prevención de oversell, commit al pago, variantes de producto, ledger de movimientos, umbral de reposición y eventos de nivel bajo. Reacciona a eventos del ciclo de vida del pedido publicados por `platform/orders` vía Redis `platform.events`.

## Estado actual (implementado)

Tabla `inventory_items` con PK `(app_id, tenant_id, sku)` y columnas `qty_on_hand`, `qty_reserved`, `low_stock_threshold`, más variantes via `parent_sku` / `option_values JSONB` / `display_name` (migración 0002). Tabla `stock_movements` (ledger de auditoría): cada operación deja una fila con `delta`, `reason`, `ref_type`, `ref_id`, `actor_user_id`. FSM de reserva: `reserve` → `commit` (pago) / `release` (cancelación). Cálculo atómico en SQL (`qty_on_hand - qty_reserved >= qty` en un único UPDATE con row-lock). Suscripción a `order.created` → `reserveItem`, `order.paid` → `commitItem`, `order.cancelled` → `releaseItem`. Evento `inventory.depleted` al cruzar `low_stock_threshold`; evento `inventory.adjusted` en cada upsert. RLS habilitado. API REST bajo `/v1/inventory`. Paginación básica en `listItems`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Alta y gestión de ítems (SKUs)

- ✅ Upsert de un ítem por SKU (`PUT /v1/inventory/:sku`) con `qty_on_hand`, `low_stock_threshold`, `parent_sku`, `option_values`, `display_name`.
- ✅ Lectura individual (`GET /v1/inventory/:sku`) y listado paginado (`GET /v1/inventory`).
- ✅ `ON CONFLICT … DO UPDATE` — idempotente; si la cantidad cambia queda registrado el delta en `stock_movements`.
- ✅ Check de integridad DB: `qty_on_hand >= 0`, `qty_reserved >= 0`, `qty_reserved <= qty_on_hand`.
- ✅ RLS y scoping explícito `(app_id, tenant_id)` en todas las queries.
- 🔧 `listItems` sin filtros: no hay filtro por `low_stock`, rango de cantidad, `parent_sku`, ni búsqueda de texto sobre SKU/`display_name`.
- 🔧 No hay `DELETE` / soft-delete de SKUs (solo upsert).
- ❌ Importación masiva (CSV/XLSX) con dry-run y reporte de errores por fila.
- ❌ Exportación (CSV/XLSX) del catálogo de inventario con stock actual.
- ❌ Nombre legible y descripción del producto en el propio módulo (solo `display_name`; riqueza está en `platform/catalog`).
- ❌ Unidad de medida (`uom`: piezas, kg, litros) por SKU.
- ❌ Código de barras / EAN / UPC como campo indexable.
- ❌ Categorización o etiquetas propias del inventario para agrupación.

## 2. Reservas de stock (holds) y prevención de oversell

- ✅ `POST /v1/inventory/:sku/reserve` — incrementa `qty_reserved` si `qty_on_hand - qty_reserved >= qty` (UPDATE atómica; sin filas afectadas → `ConflictError` con mensaje de stock disponible).
- ✅ `POST /v1/inventory/:sku/release` — decrementa `qty_reserved` (cancelación/timeout); usa `GREATEST(qty_reserved - qty, 0)` para evitar negativos.
- ✅ `POST /v1/inventory/:sku/commit` — decrementa `qty_on_hand` y `qty_reserved` simultáneamente al confirmar el pago.
- ✅ Referencia opcional `ref_type` / `ref_id` en cada operación (ej. `ref_type='order'`).
- ✅ Race condition guard: dos reservas concurrentes que superan el stock disponible → solo una gana; la otra recibe `409 ConflictError`.
- ✅ Integración automática vía eventos Redis: `order.created` → reserve, `order.paid` → commit, `order.cancelled` → release.
- ✅ Errores por ítem en procesamiento de eventos se loguean pero no abortan el lote (best-effort).
- ❌ TTL / expiración automática de reservas (ej. carrito abandonado sin pagar en N minutos) — necesita job en `platform/scheduler` que publique `inventory.hold.expired` y llame a release.
- ❌ Backorders: posibilidad de reservar por encima del stock disponible marcando el exceso como `pending_backorder`.
- ❌ Reservas parciales: si el stock cubre 3 de 5 unidades, reservar las 3 e informar la diferencia.
- ❌ Cola de espera (waitlist) por SKU: notificar cuando hay stock disponible (REUSE `platform/notifications`).
- ❌ Cantidad máxima por pedido/cliente para limitar acaparamiento.

## 3. Commit y ciclo de vida de la reserva

- ✅ `commit` es atómico: `qty_on_hand >= qty` en la misma UPDATE; retorna `null` si no hay stock (NotFoundError al caller).
- ✅ Tras commit, se publica `inventory.depleted` si `qty_on_hand <= low_stock_threshold`.
- 🔧 Commit directo sin reserva previa: `commit` no verifica si existía `qty_reserved` asociada — podría decrementar sin haber reservado antes (solo guarda que `qty_on_hand >= qty`).
- ❌ Commit parcial: confirmar solo N unidades de una reserva de M.
- ❌ Devolución / reverse commit: incrementar `qty_on_hand` al procesar una devolución (actualmente solo hay `adjust` via upsert).
- ❌ Restock directo vía evento `order.returned` (REUSE del mismo listener de eventos).

## 4. Ajustes manuales y motivos

- ✅ Ajuste manual implícito via `PUT /v1/inventory/:sku` (nuevo `qty_on_hand` → delta registrado con `reason='adjust'`, `actor_user_id` del JWT).
- ✅ Movimiento registrado solo cuando el delta es distinto de cero.
- 🔧 `reason` del ajuste siempre es `'adjust'` para upserts manuales — sin distinción de motivo (merma, rotura, corrección de recuento, donación…).
- ❌ Endpoint dedicado de ajuste incremental (`PATCH /v1/inventory/:sku/adjust`) con campo `delta` firmado y `reason` enum.
- ❌ Catálogo de motivos de ajuste (`loss`, `damage`, `found`, `cycle_count`, `donation`, `shrinkage`…) configurable por tenant.
- ❌ Ajustes negativos protegidos: evitar que un ajuste deje `qty_on_hand < qty_reserved`.
- ❌ Flujo de aprobación para ajustes grandes (ej. delta > umbral requiere segundo usuario).
- ❌ Notas/comentario libre en el ajuste.

## 5. Ledger de movimientos / historial

- ✅ Tabla `stock_movements` con `(app_id, tenant_id, sku, delta, reason, ref_type, ref_id, actor_user_id, created_at)`.
- ✅ Índice por `(tenant_id, sku, created_at DESC)` para consultas históricas eficientes.
- ✅ Índice por `(ref_type, ref_id)` para trazabilidad desde pedidos.
- ✅ `reason` ∈ `{'reserve', 'release', 'commit', 'adjust', 'restock'}` (enum documental, no CHECK constraint).
- ❌ Endpoint de consulta del ledger: `GET /v1/inventory/:sku/movements` con filtro por fechas, motivo, referencia.
- ❌ Agregación por período: entradas, salidas, ajustes en un rango de fechas.
- ❌ Consulta de movimientos por referencia: "todos los movimientos del pedido X".
- ❌ Paginación del ledger.
- ❌ CHECK constraint en DB sobre el enum de `reason`.

## 6. Umbrales de reposición y alertas de stock bajo

- ✅ `low_stock_threshold` por SKU (default 0).
- ✅ Evento `inventory.depleted` publicado en `platform.events` tras cada `commit` que deja `qty_on_hand <= low_stock_threshold`, con `{ appId, tenantId, sku, qtyOnHand, threshold }`.
- ✅ Umbral persistido y actualizable via `PUT /v1/inventory/:sku`.
- ❌ Evento `inventory.out_of_stock` diferenciado de `inventory.depleted` (cuando `qty_on_hand = 0`).
- ❌ Evento `inventory.low` (nivel de alerta) vs `inventory.depleted` (cruza umbral) — la semántica actual mezcla ambos.
- ❌ Alertas enviadas al staff/admin via `platform/notifications` al recibir `inventory.depleted`.
- ❌ Umbral de reposición configurable por almacén (cuando exista multi-almacén).
- ❌ Historial de disparos de alerta: cuándo se cruzó el umbral, cuántas veces en 30d.
- ❌ Pausa de alertas (snooze) por SKU cuando el reabastecimiento ya está en curso.

## 7. Variantes de producto

- ✅ `parent_sku` / `option_values JSONB` / `display_name` en `inventory_items` (migración 0002).
- ✅ Índice por `(app_id, tenant_id, parent_sku)` para listar variantes rápidamente.
- ✅ Unique index sobre `(app_id, tenant_id, parent_sku, option_values::text)` para evitar duplicados de combinación.
- ✅ `GET /v1/inventory/:sku/variants` — lista variantes + devuelve el padre.
- ✅ `POST /v1/inventory/:sku/variants` — crea variante validando: parent existe, no es ya una variante (jerarquía plana), combinación de `option_values` no repetida; `409` en cada caso.
- ✅ FSM reserve/release/commit aplicable a cada variante individualmente (misma lógica que SKU simple).
- 🔧 No hay endpoint para actualizar `option_values` o `display_name` de una variante existente sin tocar `qty_on_hand`.
- 🔧 `listItems` devuelve padres e hijos mezclados — no hay flag `include_variants=false` para ver solo ítems raíz.
- ❌ Ejes de variante (`size`, `color`…) definidos/validados a nivel de producto padre — hoy son JSONB libre sin restricción de claves.
- ❌ Eliminación de variante (DELETE o soft-delete).
- ❌ Reagrupación de variantes: mover una variante a otro padre.
- ❌ Generación automática del producto cartesiano de variantes al registrar los ejes.
- ❌ Stock agregado del padre como suma de sus variantes (calculado, no almacenado).

## 8. Stock disponible vs. comprometido vs. en tránsito

- ✅ `qty_on_hand` — stock físico total en el sistema.
- ✅ `qty_reserved` — stock comprometido (reservas activas pendientes de pago).
- ✅ Stock disponible implícito = `qty_on_hand - qty_reserved` (calculable, no columna).
- ❌ `qty_in_transit` — stock pedido al proveedor pero no recibido aún.
- ❌ `qty_allocated` separado de `qty_reserved` (diferencia entre "en carrito" y "en pedido confirmado").
- ❌ `qty_damaged` / `qty_quarantine` para stock no vendible.
- ❌ Campo calculado `qty_available` expuesto directamente en la respuesta de la API.
- ❌ Reconciliación automática cuando `qty_reserved` queda "huérfana" (pedido cancelado sin evento o con evento perdido).

## 9. Multi-almacén y ubicaciones

- ❌ No hay concepto de almacén (`warehouse`) ni ubicación (`bin/slot`) — el módulo es single-location por tenant.
- ❌ Tabla `warehouses` con nombre, dirección, tipo (físico / virtual / dropship / FBA…).
- ❌ Stock por almacén: `inventory_locations (app_id, tenant_id, warehouse_id, sku, qty_on_hand, qty_reserved)`.
- ❌ Transferencias entre almacenes con trazabilidad (origen → destino, qty, motivo, estado `pending/in_transit/completed`).
- ❌ Asignación de pedido a almacén origen según reglas (más cercano, más stock, coste de envío).
- ❌ Nivel de stock consolidado (suma de almacenes) vs. por almacén.
- ❌ Zona de reposición (qué almacén repone a cuál).
- ❌ Almacén virtual para consignación / stock en poder de terceros.

## 10. Recuentos físicos / inventario cíclico

- ❌ Sesión de recuento (`inventory_count_sessions`): apertura, cierre, estado.
- ❌ Líneas de recuento (`count_lines`): SKU, cantidad contada, discrepancia con `qty_on_hand`.
- ❌ Flujo: draft → contando → revisión → aplicar ajustes masivos.
- ❌ Recuento por zonas / categorías / ABC (A: rotación alta, B: media, C: baja).
- ❌ Bloqueo de reservas durante el recuento de un almacén.
- ❌ Historial de sesiones y precisión histórica de inventarios.
- ❌ Soporte para escaneo de código de barras (integración con escáner de terminal).

## 11. Reabastecimiento y órdenes de compra

- ❌ Tabla `purchase_orders` (PO): proveedor, ítems, cantidades, fechas de entrega esperadas, estado (`draft/sent/confirmed/received/cancelled`).
- ❌ Líneas de PO: `(po_id, sku, qty_ordered, qty_received, unit_cost)`.
- ❌ Recepción parcial de PO: incrementar `qty_on_hand` e `qty_in_transit` por las unidades recibidas, con `reason='restock'` en el ledger.
- ❌ Cierre automático de PO cuando todas las líneas están recibidas.
- ❌ Sugerencia automática de reabastecimiento cuando `qty_on_hand` cruza `low_stock_threshold`.
- ❌ Catálogo de proveedores (`suppliers`) con lead time y coste por SKU.
- ❌ Integración EDI / email / webhook con proveedores.
- ❌ Historial de POs para análisis de coste de aprovisionamiento.

## 12. Lotes, caducidad y números de serie

- ❌ Lotes (`batches`): `(app_id, tenant_id, sku, lot_number, expiry_date, qty_on_hand, qty_reserved)`.
- ❌ Estrategia FEFO (First Expired First Out) para commit de lotes.
- ❌ Alertas de caducidad próxima (REUSE `platform/scheduler` → job `inventory-expiry-warning`).
- ❌ Números de serie (`serial_numbers`): trazabilidad de unidad individual desde recepción hasta venta.
- ❌ Devolución vinculada a número de serie / lote concreto.
- ❌ Quarantine de lotes con defecto.
- ❌ Informe de lotes próximos a caducar / ya caducados.

## 13. Kits, bundles y componentes

- ❌ Definición de kit/bundle: un SKU padre compuesto de N SKUs componentes con cantidades.
- ❌ Explosión de componentes al reservar/commitear un kit (descontar stock de cada componente).
- ❌ Stock disponible de kit = `min(qty_available_componente / qty_por_kit)` para todos los componentes.
- ❌ Reabastecimiento de componentes individuales cuando el kit baja de umbral.
- ❌ Diferencia entre "kits pre-ensamblados" (stock propio) y "kits virtuales" (ensambla al despachar).
- ❌ BOM (Bill of Materials) versionada para cambios de formulación.

## 14. Valoración del inventario

- ❌ Coste unitario (`unit_cost`) por SKU o por lote.
- ❌ Valoración total del inventario `= qty_on_hand × unit_cost`.
- ❌ Método FIFO: coste de la capa más antigua al hacer commit.
- ❌ Coste promedio ponderado (WAC): recalcular al recibir stock con distinto coste.
- ❌ Informe de valoración por SKU / categoría / almacén / fecha.
- ❌ Integración con contabilidad / ERP: publicar eventos de cambio de valoración.
- ❌ Coste de stock inmovilizado (slow-movers).

## 15. Sincronización con el catálogo (`platform/catalog`)

- 🔧 El módulo de inventario es independiente de `platform/catalog` — un SKU en inventario no requiere existir en catálogo, y viceversa.
- ❌ Sincronización bidireccional: cuando se crea un producto en catálogo, crear automáticamente la fila en inventario; cuando se desactiva, bloquear nuevas reservas.
- ❌ Flag `track_inventory` en catálogo para indicar si el producto gestiona stock.
- ❌ Campo `sku` normalizado y compartido entre catálogo e inventario como clave de unión canónica.
- ❌ Stock visible en la respuesta del catálogo (join en tiempo real o desnormalizado via evento).
- ❌ Bloquear `add-to-basket` si `qty_available = 0` (integración con `platform/basket`).

## 16. Eventos publicados y consumidos

- ✅ Publica `inventory.adjusted` (vía Redis `platform.events`) en cada upsert con cambio de cantidad.
- ✅ Publica `inventory.depleted` tras commit cuando `qty_on_hand <= low_stock_threshold`.
- ✅ Consume `order.created` → reserveItem por cada línea.
- ✅ Consume `order.paid` → commitItem por cada línea.
- ✅ Consume `order.cancelled` → releaseItem por cada línea.
- ❌ Publica `inventory.out_of_stock` cuando `qty_on_hand = 0` (diferente de `depleted`).
- ❌ Publica `inventory.back_in_stock` cuando `qty_on_hand` pasa de 0 a positivo.
- ❌ Publica `inventory.hold_expired` cuando expira una reserva por TTL.
- ❌ Consume `basket.abandoned` → release de reservas asociadas al carrito (REUSE `platform/scheduler` + `platform/basket`).
- ❌ Consume `order.returned` → reverse commit (reincorporar stock).
- ❌ Consume `shipment.lost` → ajuste de pérdida.
- ❌ Consume `purchase_order.received` → restock (cuando existan POs).

## 17. Forecasting y análisis de rotación

- ❌ Velocidad de venta (units sold / período) por SKU.
- ❌ Días de stock restante: `qty_available / avg_daily_sales`.
- ❌ Punto de reorden calculado automáticamente: `lead_time_days × avg_daily_sales + safety_stock`.
- ❌ ABC analysis: clasificar SKUs por contribución a ventas (A: top 20 % de ventas, …).
- ❌ Slow-movers: SKUs sin movimiento en N días.
- ❌ Forecasting estacional (historial > 1 año).
- ❌ Dashboard de KPIs de inventario: valor total, rotación, fill rate, stockout rate.

## 18. Expiración de reservas / integración con scheduler

- ❌ Las reservas no tienen TTL propio — pueden quedar huérfanas si el pedido no llega a `order.paid` ni `order.cancelled` (ej. fallo de webhook de Stripe).
- ❌ Job `inventory-hold-purge` en `platform/scheduler`: seleccionar reservas activas sin pedido asociado cuyo TTL haya expirado → release + publicar `inventory.hold.expired`.
- ❌ TTL configurable por tenant / por tipo de reserva (carrito vs. pedido confirmado).
- ❌ Notificación al usuario cuando su reserva expira (REUSE `platform/notifications`).
- ❌ Reconciliación periódica: comparar `qty_reserved` con reservas activas conocidas en `platform/orders`.

## 19. Multi-tenant y aislamiento

- ✅ PK `(app_id, tenant_id, sku)` — scoping completo a nivel de fila.
- ✅ RLS habilitado y forzado; policy usa `current_setting('app.app_id')` y `current_setting('app.tenant_id')`.
- ✅ `appGuard` de `@apphub/platform-sdk` valida `app_id` en el JWT.
- ✅ `withTenantTransaction` establece los settings de sesión antes de cada query.
- ✅ `sub_tenant_id` propagado en el contexto (`ctxFromRequest`), aunque no se usa en queries actuales (nullable, correcto).
- 🔧 `sub_tenant_id` no aplicado como filtro adicional — si el tenant tiene sub-tenants, todos comparten el mismo inventario.
- ❌ Visibilidad de inventario restringida por `sub_tenant_id` cuando cada rama tiene su propio stock.

## 20. Admin UX / operación

- ✅ API REST documentada bajo `/v1/inventory` con tags OpenAPI `['inventory']` y `['inventory · variants']`.
- ✅ Endpoint de health en `/api/inventory/health`.
- ❌ Interfaz admin en `apps/portal` (o en el portal de la app) para gestionar stock: list, edit, ajustar.
- ❌ Búsqueda por SKU / `display_name` en el listado.
- ❌ Filtros en listado: `qty_available < N`, `low_stock=true`, con/sin variantes.
- ❌ Vista de historial de movimientos por SKU desde el admin.
- ❌ Acciones masivas: ajuste masivo, cambio de umbral masivo, exportación.
- ❌ Notificaciones push/email al staff cuando se publica `inventory.depleted` (REUSE `platform/notifications`).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Expiración de reservas** via `platform/scheduler` (`inventory-hold-purge` job) — previene stock permanentemente bloqueado por pedidos zombi; riesgo operativo inmediato.
2. **Endpoint de movimientos** `GET /v1/inventory/:sku/movements` con filtro de fechas — desbloquea trazabilidad y auditoría sin cambios de schema.
3. **Evento `inventory.out_of_stock`** diferenciado de `depleted` + consumidor en `platform/notifications` para alerta al staff — valor operativo alto, coste mínimo.
4. **Stock disponible calculado** (`qty_available = qty_on_hand - qty_reserved`) devuelto directamente en la respuesta de la API, y **filtro `low_stock=true`** en `listItems` — mejora UX sin cambios de schema.
5. **Sincronización catalógo ↔ inventario**: consumir `catalog.product.created` para crear fila en inventario automáticamente; exponer `qty_available` en respuesta del catálogo — elimina la desconexión actual entre los dos módulos.
6. **Devoluciones / reverse commit** via `order.returned` → `adjustOnHand(+qty)` con `reason='return'` — cierra el ciclo post-venta; bajo coste (la función `adjustOnHand` ya existe en el repositorio).
7. **Multi-almacén** — tabla `warehouses` + `inventory_locations`; necesario cuando los tenants tienen almacenes separados o lógica de fulfillment por zona.
8. **Caducidad y lotes** — tabla `batches` + job `inventory-expiry-warning` en scheduler; prioritario para tenants de alimentación, farmacia o cosmética.
9. **Kits/bundles** — explosión de componentes al reservar; necesario para tiendas con productos compuestos; requiere modelado de BOM.
10. **Valoración (FIFO/WAC)** + integración contable — útil para tenants con obligación de reporte de inventario; mayor complejidad de implementación.
