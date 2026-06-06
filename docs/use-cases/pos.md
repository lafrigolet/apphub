# Casos de uso — `platform/pos` (platform-restaurant)

> Dominio: TPV/POS de restaurante — cuentas (bills), división de cuenta (split), propinas (tips), pagos mixtos (efectivo, tarjeta, vale, monedero, externo). Sin aislamiento por sub-tenant en la lógica de negocio (el campo `sub_tenant_id` se transporta para RLS pero no condiciona el flujo).

## Estado actual (implementado)

Apertura de cuenta (`POST /v1/pos/bills`) con `table_id`, `table_code`, `currency`, `notes` y `metadata`; adición de ítems con `sku`, `name`, `qty`, `unit_price_cents`, `modifiers` (JSONB), `course` y `notes`; recálculo automático de `subtotal/tax/total`; división de cuenta en modos `equal`, `percent` y `amounts`; registro de pagos con métodos `card`, `cash`, `wallet`, `voucher` y `external`, con `tip_cents` y `external_ref`; marcado de sub-splits como pagados y cierre automático de la cuenta cuando la suma de pagos cubre el total; cierre explícito (`POST /v1/pos/bills/:id/close`); RLS por `(app_id, tenant_id)` en las tablas; eventos Redis `pos.bill.opened`, `pos.bill.split`, `pos.bill.paid` y `pos.bill.closed`; tasa de impuesto fija 10 % configurable vía `metadata.taxRate`.

Añadido (casos de uso prioritarios, backend-only): cancelación de cuenta (`POST /:id/cancel`, audit `cancelled_by`/`cancel_reason`, evento `pos.bill.cancelled`); guard de roles `requireRole` en todas las rutas; envío a cocina desacoplado del cobro (`POST /:id/fire`, `fired_at` por ítem, eventos `pos.bill.item_added` y `pos.bill.fired`); sugerencias de propina + IVA por defecto por tenant (`pos_settings`, `GET/PUT /v1/pos/settings`, `tipSuggestions` en `GET /:id`); división por ítems (`split` mode `items`, tabla `bill_split_items`). Migración `0002_cancel_fire_tips_split_items.sql`.

> **Nota de alcance (2026-06-05, [ADR 015](../adr/015-platform-tpv-monolith.md)):** la capa
> de operación de caja y cumplimiento fiscal — apertura/cierre de caja y arqueo (§9),
> facturación/ticket (§11), devoluciones (§13) e informes X/Z (§16) — está **implementada
> en [`platform/tpv`](tpv.md)** (contenedor `platform-tpv`, puerto 3500), que consume los
> eventos de este módulo (`pos.bill.paid` enriquecido + `pos.bill.cancelled`).
> `platform/pos` conserva su alcance: motor de cuentas, ítems, splits, propinas y pagos
> mixtos. Los ❌ de esas secciones siguen siendo válidos *para este módulo* — viven en tpv.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Apertura de cuenta

- ✅ Apertura desde mesa identificada por `table_id` (UUID) o `table_code` (texto libre).
- ✅ Apertura sin mesa (barra, takeaway, delivery) — `table_id` y `table_code` son opcionales.
- ✅ `server_user_id` capturado automáticamente del JWT del camarero que abre la cuenta.
- ✅ `currency` configurable (default `EUR`).
- ✅ `notes` y `metadata` JSONB para información adicional (nº de comensales, tipo de servicio, canal…).
- ✅ Estado inicial `open`; `opened_at` = `now()`.
- ✅ Evento `pos.bill.opened` publicado en `platform.events` con `billId` y `tableId`.
- 🔧 No hay integración con `platform/floor-plan` para validar que la mesa existe o cambiar su estado a "ocupada".
- ✅ Tasa de IVA configurable por tenant sin tocar el payload: `pos_settings.default_tax_rate` (vía `PUT /v1/pos/settings`). Precedencia: `metadata.taxRate` de la cuenta → `default_tax_rate` del tenant → 10 % por defecto.
- ❌ Tipos de cuenta diferenciados (dine-in, barra, takeaway, delivery, room-service) con flujos distintos.
- ❌ Número de comensales (`covers`) como campo de primera clase.
- ❌ Tiempo estimado de espera para takeaway/delivery al abrir.
- ❌ Cuenta pre-autorizada desde reserva (REUSE `platform/reservations`) — abrir automáticamente la cuenta al hacer check-in.
- ❌ Apertura masiva de cuentas al inicio del turno (pre-apertura de mesas configuradas).

## 2. Gestión de ítems — añadir, modificar, cancelar

- ✅ Añadir ítems con `sku`, `name`, `qty`, `unit_price_cents`, `course` y `modifiers` (JSONB libre).
- ✅ Recálculo de `subtotal`, `tax` y `total` tras cada adición.
- ✅ Cursos soportados: `starter`, `main`, `dessert`, `drink`, `side`, `combo`, `other`.
- ✅ Campo `notes` por ítem (alergias, punto de cocción, preferencias).
- 🔧 Los ítems se añaden con precio libre (`unit_price_cents` lo fija el cliente): no hay integración con `platform/menu` para capturar precio desde el catálogo y validar consistencia.
- ❌ Modificación de ítems ya añadidos (cambio de `qty`, `notes`, `modifiers` sin borrar y re-añadir).
- ❌ Eliminación de un ítem de la cuenta con motivo (cancelación de línea: camarero la envió mal, cliente cambió de opinión).
- ❌ Historial de cambios de ítems (quién añadió/canceló, cuándo, motivo) — auditoría.
- ❌ Descuento a nivel de ítem (porcentaje, importe fijo) con motivo.
- ❌ Cortesía / invitación de ítem (precio → 0, indicado como `complimentary`) con causal y permiso por rol.
- ❌ Modificadores con precio adicional sumado automáticamente (p.ej. extra queso +0,50 €).
- ❌ Agrupación de ítems por `course` para envío secuencial a cocina.

## 3. Envío a cocina (integración KDS)

- ✅ Al pagar una cuenta, el evento `pos.bill.paid` incluye el array de ítems (`sku`, `name`, `qty`, `course`, `modifiers`) para que `platform/kds` los procese como comanda.
- ✅ Envío a cocina desacoplado del pago: `POST /:id/fire` emite `pos.bill.fired` antes de cobrar. El evento `pos.bill.paid` sigue incluyendo items como red de seguridad (dine-in sin fire previo).
- ✅ Endpoint `POST /v1/pos/bills/:id/fire` para enviar la comanda a cocina sin cobrar — flujo dine-in estándar. Marca `fired_at` por ítem (idempotente; relanza solo lo no disparado), acepta `itemIds` opcional para envío parcial, publica `pos.bill.fired` (con `orderId`/items para KDS).
- ❌ Envío parcial por curso (estrella a cocina antes que el principal).
- ❌ Reenvío de ítem a cocina (por si se perdió la comanda o necesita rehacerse).
- ❌ Visualización del estado de cada ítem en cocina desde el POS (REUSE `platform/kds` estado de ticket).
- ❌ Comanda de barra separada de cocina (distintos destinos de impresión/display).

## 4. Descuentos, cortesías e invitaciones

- ❌ Descuento a nivel de cuenta (porcentaje o importe fijo) con motivo y `authorized_by`.
- ❌ Descuento a nivel de ítem con motivo y permiso por rol.
- ❌ Cortesía/invitación total: cuenta a 0 € (`complimentary`), indicada en el ticket con motivo.
- ❌ Descuento de fidelidad/cupón (REUSE `platform/catalog` — vouchers) aplicado al abrir o al cobrar.
- ❌ Happy hour / descuento automático por franja horaria configurada.
- ❌ Límite de descuento por rol (camarero puede hasta X %; manager puede más; super_admin sin límite).
- ❌ Registro de descuentos aplicados en `bill_items` / tabla propia para reporting.

## 5. División de cuenta (split bill)

- ✅ División equitativa (`equal`) entre N comensales, con distribución de céntimos sobrantes.
- ✅ División por porcentajes (`percent`) — la suma debe ser 100 %.
- ✅ División por importes explícitos (`amounts`) — la suma debe igualar el total de la cuenta.
- ✅ Estado de cuenta cambia a `split` al ejecutar la operación.
- ✅ Tabla `bill_splits` con `share_index`, `amount_cents`, `paid` y `payment_id`.
- ✅ Al pagar una sub-cuenta (`splitId` en el pago), se marca su `paid = TRUE`.
- ✅ Cuando todos los splits están pagados, la cuenta pasa a `paid` automáticamente.
- ✅ Evento `pos.bill.split` con `mode` y `count`.
- ✅ División por ítems: asignar cada línea de la cuenta a un comensal concreto (`split-by-item`). Modo `items` con `assignments[].itemIds`; importe del share = subtotal de sus ítems + IVA proporcional; valida que cada ítem se asigne exactamente una vez y que se cubran todos. Asociaciones persistidas en `bill_split_items` y devueltas como `splits[].itemIds`.
- ❌ Re-split: modificar los tramos después de haber dividido (un comensal se va y su parte la pagan los demás).
- ❌ Merge de splits: fusionar varios tramos en uno solo.
- ❌ Nombre/alias por comensal en cada split (para identificarlos en el display del camarero).
- ❌ División con propina por split (cada comensal deja su propina independientemente).

## 6. Propinas (tips)

- ✅ `tip_cents` en el pago (`bill_payments.tip_cents`) — se registra junto al método de pago.
- ✅ `tip_cents` en la cuenta (`bills.tip_cents`) — reflejado en el total.
- 🔧 La propina se registra manualmente en el payload del pago (sin terminal físico).
- ✅ Sugerencias de propina configurables por tenant (p.ej. 5 %, 10 %, 15 %, libre) devueltas junto al total de la cuenta. `GET /v1/pos/bills/:id` incluye `tipSuggestions.options` (porcentaje → céntimos sobre el total) + `allowCustom`; configurables en `pos_settings` vía `GET/PUT /v1/pos/settings`.
- ❌ Propina incluida automáticamente para grupos grandes (mínimo de comensales configurable).
- ❌ Propina compartida entre camareros del turno (pool de propinas) — REUSE `platform/practitioner-payouts` para distribución.
- ❌ Asignación de propina a camarero concreto (`server_user_id`) para reporting de propinas por empleado.
- ❌ Informe de propinas por camarero / turno / día.
- ❌ Propina en tarjeta separada del importe de la cuenta (flujo terminales físicos: autorización + propina post-firma).

## 7. Pagos mixtos (multi-método)

- ✅ Métodos soportados: `card`, `cash`, `wallet`, `voucher`, `external`.
- ✅ Múltiples registros en `bill_payments` para la misma cuenta — pagos parciales acumulativos.
- ✅ La cuenta pasa a `paid` automáticamente cuando la suma de pagos ≥ `total_cents`.
- ✅ `external_ref` para referencias externas (TPE, pasarela, referencia Bizum, etc.).
- 🔧 No hay validación de cambio/vuelta (`cash` por más del total): el exceso se acepta sin registrar el cambio entregado al cliente.
- ❌ Integración real con `platform/payments` (Stripe terminal / card-present) para autorizar el pago con tarjeta y recuperar el `paymentIntentId` como `external_ref`.
- ❌ Integración con Bizum (método de pago diferenciado con QR o número de teléfono).
- ❌ Integración con `platform/splitpay` para pagos con split Stripe Connect (reparto entre local y plataforma).
- ❌ Gestión de vales/vouchers: validación del código, descuento del saldo, caducidad (REUSE `platform/catalog` o módulo vouchers).
- ❌ Monedero interno del cliente (saldo prepagado) con control de saldo antes de aceptar el pago.
- ❌ Anulación / reversión de un pago concreto (p.ej. la tarjeta fue rechazada después de registrar el intento).
- ❌ Cambio/vuelta en efectivo: registrar el importe entregado y el cambio devuelto.

## 8. Cierre de cuenta y estados

- ✅ Estado `paid` asignado automáticamente al cubrir el total (vía pagos acumulativos o splits completados).
- ✅ Cierre explícito `POST /v1/pos/bills/:id/close` — solo factible desde estado `paid`.
- ✅ Estado `closed` con `closed_at` timestamp.
- ✅ Estado `cancelled` en el CHECK (existe en la BD) aunque no hay endpoint de cancelación.
- ✅ Evento `pos.bill.closed` con `totalCents`.
- ✅ Cancelación de cuenta con motivo y `cancelled_by`: `POST /v1/pos/bills/:id/cancel` (solo desde `open`/`split`), columnas `cancelled_by`+`cancel_reason`, requiere rol manager+, publica `pos.bill.cancelled`.
- ❌ Reapertura de cuenta cerrada por error (solo por rol manager/super_admin).
- ❌ Cuenta en espera (`on_hold`): cliente sale a fumar, mesa se libera temporalmente.
- ❌ Transferencia de cuenta entre mesas (REUSE `platform/floor-plan` para marcar nueva mesa como ocupada).
- ❌ Fusión de cuentas: unir dos `bills` en una (p.ej. dos grupos que se juntan).
- ❌ Traspaso de cuenta entre camareros (`server_user_id` cambia de dueño con log de quién lo hizo).

## 9. Apertura/cierre de caja y arqueo (cash drawer)

- ❌ Tabla de turnos de caja (`cash_drawers` / `shifts`) con `opened_at`, `opened_by`, `base_amount_cents`.
- ❌ Apertura de caja con fondo inicial (base de caja).
- ❌ Cierre de caja: declaración de efectivo en caja + cálculo de diferencia (arqueo).
- ❌ Informe X (parcial, sin zerear) — ventas acumuladas hasta el momento sin cerrar el día.
- ❌ Informe Z (cierre de día) — resumen de ventas por método de pago y zereo de contadores.
- ❌ Registros de movimientos de caja (entradas/salidas de efectivo con motivo): propina, cambio de fondo, retirada.
- ❌ Apertura/cierre de cajón de efectivo (señal a hardware / impresora con kick-out).
- ❌ Multi-caja: varias cajas abiertas simultáneamente en el mismo tenant (barra + caja principal).

## 10. Turnos de camarero

- 🔧 `server_user_id` se registra en la cuenta pero no hay concepto formal de turno ni asignación de mesas.
- ❌ Tabla de turnos (`shifts`): `user_id`, `started_at`, `ended_at`, `type` (apertura/cierre).
- ❌ Asignación de secciones/mesas a un camarero para el turno (REUSE `platform/floor-plan`).
- ❌ Listado "mis cuentas abiertas" filtrado por `server_user_id` del token.
- ❌ Traspaso de turno: todas las cuentas de un camarero reasignadas al camarero entrante.
- ❌ Resumen de ventas y propinas por camarero al cerrar su turno.
- ❌ Control de acceso por sección: un camarero solo puede abrir/editar cuentas de sus mesas asignadas.

## 11. Facturación — ticket simplificado y factura completa

- 🔧 Los datos de la cuenta (ítems, totales, IVA) están disponibles vía `GET /v1/pos/bills/:id`, pero no existe endpoint de generación de documento fiscal.
- ❌ Generación de ticket simplificado (albarán de venta) en PDF con número correlativo, ítems, IVA desglosado y QR de verificación.
- ❌ Generación de factura completa con datos del cliente (NIF/CIF, razón social, dirección) — obligatoria si el cliente la solicita.
- ❌ Integración con `platform/verifactu` para registrar la factura en la cadena de huellas AEAT, firma del registro y código QRCODE verificable — **crítico para cumplimiento Verifactu/SIF (obligatorio desde 2026 en España)**.
- ❌ Número de serie de factura configurable por tenant (serie A, B, …) con numeración correlativa gestionada en BD.
- ❌ Facturas rectificativas / notas de abono (devolución de factura emitida).
- ❌ Envío de ticket/factura por email al cliente (REUSE `platform/notifications`).
- ❌ Reimpresión de ticket (idempotente, sin generar nuevo documento fiscal).
- ❌ Factura pro-forma / presupuesto.

## 12. Impresión de tickets y comandas

- ❌ Integración con impresoras de recibos (ESC/POS) — generación de payload de impresión.
- ❌ Plantillas de ticket configurables por tenant (logo, pie de ticket, mensaje de cortesía).
- ❌ Impresión de comanda de cocina (texto plano, sin precios) al enviar a KDS.
- ❌ Impresión de comanda de barra (bebidas) separada de cocina.
- ❌ Reimpresión de comanda por item (si se perdió o hay incidencia).
- ❌ Gestión de impresoras por sección: comanda → impresora cocina, bebidas → impresora barra.
- ❌ Vista previa de ticket en el frontend antes de imprimir.

## 13. Devoluciones y anulaciones

- ❌ Devolución parcial: reembolso de uno o varios ítems de una cuenta ya cobrada.
- ❌ Devolución total: anulación de la cuenta pagada y reversión del pago (REUSE `platform/payments` para refund Stripe; efectivo se gestiona manualmente).
- ❌ Tabla de devoluciones (`bill_refunds`) con `bill_id`, `items`, `amount_cents`, `method`, `reason`, `authorized_by`.
- ❌ Autorización de devolución por rol (solo manager/super_admin puede autorizar devoluciones).
- ❌ Impacto de devolución en informes de ventas (ventas netas vs brutas).
- ❌ Integración con `platform/inventory` para re-incrementar stock devuelto (si aplica).
- ❌ Generación de factura rectificativa en `platform/verifactu` al anular una factura emitida.

## 14. Integración con inventario

- ❌ Decremento de stock en `platform/inventory` al añadir un ítem a la cuenta (por `sku`).
- ❌ Rollback de stock al cancelar o devolver un ítem.
- ❌ Alerta de stock bajo / 86-list reflejada en el POS (ítems no disponibles marcados en el menú).
- ❌ Control de recetas (escandallo): un plato consume N unidades de ingredientes de inventario.
- ❌ Trazabilidad bidireccional: desde un ítem de cuenta hasta el movimiento de inventario.

## 15. Integración con catálogo y menú

- 🔧 Ítems se añaden con precio libre: no hay validación contra `platform/catalog` ni `platform/menu`.
- ❌ Búsqueda de productos/platos desde el POS (integración `platform/menu` para restaurantes, `platform/catalog` para retail).
- ❌ Precio tomado del catálogo/menú activo para el tenant — el camarero no fija precios manualmente.
- ❌ Modificadores con precio desde `platform/menu` (sobreescrituras o adiciones de precio).
- ❌ Menú diferenciado por franja horaria (desayuno vs almuerzo) reflejado en el POS.
- ❌ Alergenos / advertencias nutricionales mostrados al añadir un ítem (REUSE `platform/menu`).

## 16. Informes de ventas (Z/X reports y analítica)

- ❌ Informe X: ventas acumuladas del turno/día (sin zerear) desglosadas por método de pago, por camarero, por curso, por producto.
- ❌ Informe Z: cierre de día con zereo de contadores y generación de PDF archivable.
- ❌ Ventas netas vs brutas (tras descuentos y devoluciones).
- ❌ Desglose de IVA por tipo impositivo (IVA general 21 %, reducido 10 %, superreducido 4 % — configuración por ítem desde `platform/menu`).
- ❌ Top N productos más vendidos.
- ❌ Ticket medio por mesa / por comensal / por camarero.
- ❌ Propinas por camarero y totales de turno.
- ❌ Comparativa por periodos (semana a semana, mes a mes).
- ❌ Export a CSV/XLSX para contabilidad.

## 17. Gestión de empleados y permisos

- ✅ Guard de acceso por rol (`requireRole` de `@apphub/platform-sdk`) en todas las rutas: roles de operación (waiter/server/cashier/staff/manager/admin/owner/super_admin) para abrir/añadir/dividir/cobrar/fire/cerrar; roles de gestión (manager/admin/owner/staff/super_admin) para cancelar cuentas y editar `pos_settings`.
- 🔧 Permiso diferenciado por rol: cancelación ya restringida a manager+. Descuentos/cortesías/devoluciones aún no implementados (ver §4, §13).
- ❌ PIN de camarero (rápido login en terminales compartidos sin sesión larga).
- ❌ Listado de empleados activos con rol y turno asociado (REUSE `platform/auth` usuarios del tenant).
- ❌ Log de auditoría de operaciones sensibles (descuentos, cortesías, cancelaciones, devoluciones) con `actor_id` y `reason`.

## 18. Modo offline y resiliencia

- ❌ Modo offline en el frontend del POS: continuar operando sin conexión y sincronizar al recuperarla.
- ❌ Cola de operaciones offline con idempotency keys para evitar duplicados al sincronizar.
- ❌ Indicador de estado de conectividad en el terminal.
- ❌ Caché local de menú y precios para operación offline.
- ❌ Gestión de conflictos al sincronizar (p.ej. dos camareros modificaron la misma cuenta offline).

## 19. Multi-local / multi-tenant

- ✅ Aislamiento RLS por `(app_id, tenant_id)` en todas las tablas.
- ✅ `sub_tenant_id` almacenado para aislamiento de locales dentro de un mismo tenant (franquicias).
- 🔧 `sub_tenant_id` se filtra via RLS pero la capa de servicio no lo usa como criterio de negocio (p.ej. informes por local).
- ❌ Informes por local (`sub_tenant_id`) dentro de un tenant multi-local.
- ❌ Transferencia de cuenta entre locales del mismo tenant.
- ❌ Configuración de IVA / moneda / serie de facturas por local.
- ❌ Dashboard consolidado de todos los locales para el tenant principal.

## 20. Eventos y webhooks

- ✅ `pos.bill.opened` — al abrir la cuenta.
- ✅ `pos.bill.split` — al dividir la cuenta, con `mode` y `count`.
- ✅ `pos.bill.paid` — al marcar la cuenta como pagada, incluyendo ítems para KDS. **Enriquecido (ADR 015)**: `subTenantId`, `currency`, `subtotalCents`/`taxCents`, `metadata` (donde el frontend TPV viaja `deviceId`), desglose `payments[] {method, amountCents, tipCents, externalRef}` y `unitPriceCents` por ítem — lo consume `platform/tpv` para imputar efectivo y snapshotear recibos.
- ✅ `pos.bill.closed` — al cerrar formalmente la cuenta.
- ✅ `pos.bill.item_added` — ítem añadido (útil para KDS / display de cocina en tiempo real).
- ✅ `pos.bill.fired` — comanda enviada a cocina/KDS desacoplada del cobro (con `orderId` + items).
- ❌ `pos.bill.item_cancelled` — ítem cancelado con motivo.
- ❌ `pos.bill.discount_applied` — descuento/cortesía registrado.
- ✅ `pos.bill.cancelled` — cuenta anulada (con `cancelledBy` + `reason`).
- ❌ `pos.bill.transferred` — cuenta transferida a otra mesa o camarero.
- ❌ `pos.bill.refunded` — devolución registrada.
- ❌ `pos.shift.opened` / `pos.shift.closed` — apertura y cierre de turno de caja.
- ❌ Webhooks salientes configurables por tenant (notificación a sistemas externos: ERP, contabilidad).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ✅ ~~**Endpoint de cancelación de cuenta** (`PATCH` status → `cancelled` con motivo)~~ — `POST /v1/pos/bills/:id/cancel` (open/split → cancelled, `cancelled_by`+`cancel_reason` audit, evento `pos.bill.cancelled`).
2. ✅ ~~**Guard de roles en rutas**~~ — `requireRole` en todas las rutas: operadores (waiter/server/cashier/staff/manager/…) para abrir/añadir/dividir/cobrar/fire/cerrar; manager+ para cancelar y editar settings.
3. ✅ ~~**Evento `pos.bill.item_added`** + endpoint `POST /v1/pos/bills/:id/fire`~~ — `addItem` publica `pos.bill.item_added`; `POST /v1/pos/bills/:id/fire` (todos o `itemIds`) marca `fired_at` (idempotente) y publica `pos.bill.fired` con `orderId` para KDS.
4. **Integración con `platform/verifactu`** para generar tickets y facturas con cadena AEAT — **obligatorio legalmente en España desde 2026**; es el bloqueo de go-live más crítico. *(Cross-cutting: requiere `platform/verifactu`; fuera del scope backend-only de `platform/pos`.)*
5. ✅ ~~**Sugerencias de propina configurables por tenant** devueltas en el `GET /v1/pos/bills/:id`~~ — tabla `pos_settings` (tip_suggestions, tip_allow_custom, default_tax_rate) + `GET/PUT /v1/pos/settings`; `GET /v1/pos/bills/:id` devuelve `tipSuggestions.options` precalculadas sobre el total.
6. ✅ ~~**División por ítems** (`split-by-item`)~~ — modo `items` en `POST /:id/split` con `assignments[].itemIds`; tabla `bill_split_items`; importe por share = subtotal de sus ítems + IVA proporcional; valida cobertura total y exclusividad de cada ítem.
7. **Integración con `platform/menu`** para capturar precios desde el catálogo activo en lugar de precios libres — elimina errores de caja y permite control de precios por tenant. *(Cross-cutting: requiere `platform/menu`.)*
8. **Informes X/Z** básicos (ventas del día por método de pago) — desbloquea el uso real por parte de los restauradores.
9. **Integración con `platform/payments`** (Stripe Terminal / card-present) para cerrar el ciclo de pago con tarjeta con referencia del intento de pago.
10. **Apertura/cierre de caja y arqueo** — exigido por muchos restauradores como requisito mínimo de TPV; tabla `shifts` sencilla como primer paso.
