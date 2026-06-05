# Casos de uso — `platform/tpv` (platform-tpv)

> Dominio: operación de caja y cumplimiento fiscal de un TPV genérico (cualquier app, no
> solo restaurante) — dispositivos terminal, sesiones/turnos de caja, movimientos de
> efectivo, arqueo, recibos con numeración correlativa, facturas completas, devoluciones
> y abonos, informes X/Z e integración Veri*Factu. **No duplica cuentas ni cobros**: el
> motor de cuentas/líneas/pagos/splits es `platform/pos` (REUSE vía eventos);
> `platform/tpv` añade la capa que convierte un sistema de cobros en un TPV legal y
> operable. Contenedor propio `platform-tpv` (puerto 3500) — ver
> [ADR 015](../adr/015-platform-tpv-monolith.md).

## Estado actual (implementado)

V1 completa (2026-06-05). Contenedor `platform-tpv` (3500) con módulo único `platform/tpv`
(schema `platform_tpv`, rol `svc_platform_tpv`, RLS por `(app_id, tenant_id)`): dispositivos
(`tpv_devices`), series de numeración correlativa sin huecos (`number_series`, `UPDATE …
RETURNING` bajo lock de fila en la misma transacción que el documento — un rollback no
consume número), sesiones de caja con UNIQUE parcial de una abierta por dispositivo,
arqueos ciegos (`cash_counts`), movimientos de efectivo append-only con importes con signo
(`cash_movements`), billing facts (snapshot idempotente del `pos.bill.paid` enriquecido,
con cola de huérfanos re-imputable), recibos con snapshot inmutable (cabecera + tabla
`receipt_lines` + `tax_breakdown`; inmutabilidad forzada por grants — el rol solo puede
UPDATE en las columnas fiscales async), factura completa y canje simplificado→factura
dentro de ventana configurable, abonos con autorización manager y correlativo al autorizar,
informes X (en vivo) y Z (snapshot inmutable numerado al cierre), agregados por periodo,
export CSV contable, settings por tenant (incl. **emisor fiscal** — cada tenant es una
entidad legal) + config service-level, job `tpv-session-autoclose` en platform-scheduler,
e integración Veri*Factu por eventos (`tpv.receipt.issued`/`voided` →
`verifactu.registro.created` con huella encadenada + QR de cotejo que se completa async
sobre el documento). Suite Vitest del módulo + e2e verificado contra pos y verifactu reales.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Dispositivos TPV (terminales)

- ✅ Registro de dispositivo (`tpv_devices`): nombre, ubicación, `sub_tenant_id` opcional, serie por defecto. `POST/GET/PATCH /v1/tpv/devices` (manager+).
- ✅ Activar / desactivar dispositivo (`DELETE /:id` = soft delete) — un dispositivo inactivo no puede abrir sesión ni imputar ventas.
- ✅ Listado de dispositivos del tenant con filtro `active`.
- ✅ Vinculación dispositivo ↔ serie (`default_series_id`; las series además aceptan `device_id`).
- ✅ Metadata JSONB por dispositivo.

## 2. Sesiones / turnos de caja

- ✅ Apertura de sesión: fondo inicial (`opening_float_cents`, genera movimiento `opening_float`), cajero del JWT, una sesión abierta por dispositivo (índice parcial UNIQUE → 409). `POST /v1/tpv/sessions` (cashier+).
- ✅ Cierre de sesión: conteo declarado por método vs teórico de movimientos; `variance_cents` + motivo. Genera el informe Z en la misma transacción.
- ✅ Arqueo intermedio (recuento ciego) sin cerrar: `POST /:id/counts` → `cash_counts` con expected/variance.
- ✅ Cierre forzoso de sesiones colgadas — job `tpv-session-autoclose` (cada 15 min; ventana por tenant `session_autoclose_hours` → config plataforma → 16h) publica `tpv.session.force_closed`. Sin informe Z (no hay conteo declarado); el flujo reopen + cierre lo produce.
- ✅ Histórico de sesiones con filtros: dispositivo, status, fechas. `GET /:id` incluye movimientos, arqueos y teórico.
- ✅ Reapertura de sesión cerrada (manager+, evento `tpv.session.reopened`).

## 3. Movimientos de efectivo (cash management)

- ✅ Entrada de efectivo (cash-in) con motivo obligatorio.
- ✅ Salida de efectivo (cash-out): por encima de `cash_out_manager_threshold_cents` exige rol manager+ (403).
- ✅ Imputación automática de ventas en efectivo: subscriber a `pos.bill.paid` — pagos `cash` (importe + propina) suman a la sesión abierta del `metadata.deviceId` como `sale_cash` con `source='event'`.
- ✅ Devoluciones en efectivo como `refund_cash` automático al autorizar el abono (§6).
- ✅ Tabla `cash_movements` append-only (sin UPDATE/DELETE por grants) con trazabilidad a fact/recibo.
- ✅ Auditoría por sesión: `GET /v1/tpv/sessions/:id/movements`.

## 4. Recibos y numeración correlativa

- ✅ Emisión de ticket simplificado desde un billing fact: snapshot inmutable de líneas/totales/IVA (no re-deriva del bill). `POST /v1/tpv/receipts`.
- ✅ Numeración correlativa sin huecos por serie: secuencia en Postgres bajo lock de fila, misma transacción que el INSERT; verificado bajo emisión concurrente. Nunca Redis.
- ✅ Series configurables por tenant (A/B/R por defecto, `default_*_series_code` en settings) y opcionalmente por dispositivo.
- ✅ Render HTML imprimible (80mm) desde el snapshot — idempotente, con QR Veri*Factu cuando está registrado y pie configurable. `GET /:id/render`.
- ✅ Reimpresión / reenvío idempotente — regenera del snapshot sin documento fiscal nuevo.
- 🔧 Envío del recibo por email: `POST /:id/resend` publica `tpv.receipt.send_requested` con el snapshot completo; falta el consumer + plantilla en `platform/notifications` (REUSE pendiente).
- ✅ QR Veri*Factu de cotejo incorporado al recibo (llega async vía `verifactu.registro.created`).
- ❌ Payload de impresión ESC/POS para impresoras de tickets (V2).

## 5. Factura completa (con datos fiscales del cliente)

- ✅ Emisión de factura completa (`type: 'invoice'`) — exige receptor NIF + nombre (CHECK en BD + 422).
- ✅ Serie distinta del ticket simplificado (kind `invoice`), mismo mecanismo de correlativo.
- ✅ Conversión ticket simplificado → factura completa (`POST /:id/convert`) dentro de `convert_window_days`; el original queda `converted` y se excluye del doble conteo en informes.
- ✅ Datos fiscales del receptor en el snapshot del recibo (sin tabla de clientes — V1 sin CRM).
- ❌ Factura pro-forma / presupuesto (V2).

## 6. Devoluciones y abonos (credit notes)

- ✅ Abono total o parcial ligado al recibo original (FK NOT NULL — nunca huérfano), con control de sobre-abono (422).
- ✅ Autorización por rol: cajero solicita (`pending`), manager+ autoriza o rechaza; si el solicitante es manager+ se auto-autoriza. El correlativo (serie R) se consume SOLO al autorizar — un rechazo no quema número.
- 🔧 Reembolso al método original: efectivo → `refund_cash` automático en la sesión abierta indicada; tarjeta → se registra `refund_external_ref` y queda el evento para conciliar — falta el refund real vía `platform/payments` (REUSE pendiente).
- 🔧 Reposición de stock: el evento `tpv.receipt.voided` lleva las líneas; falta el consumer de restock en `platform/inventory` (REUSE pendiente).
- ✅ Registro fiscal de la rectificativa en `platform/verifactu` (alta `R1` con importe negativo — se evita la anulación AEAT porque es total y única, y los abonos pueden ser parciales).
- ✅ Numeración correlativa propia para abonos (serie R).
- ✅ Impacto en informes: ventas netas vs. brutas; abono total → recibo original `voided`.

## 7. Informes X/Z y analítica

- ✅ Informe X (`GET /v1/tpv/reports/x?sessionId=`): ventas de la sesión en curso por método de pago, recibos por tipo, IVA por tipo, propinas, teórico de caja.
- ✅ Informe Z: generado automáticamente al cerrar sesión, snapshot inmutable en `z_reports` con numeración por tenant. `GET /v1/tpv/reports/z/:sessionId`.
- ✅ Agregados por periodo (día/semana/mes) con brutas/netas. `GET /v1/tpv/reports/period` (manager+).
- ✅ Ventas netas vs. brutas (tras abonos); los canjes simplificado→factura no doblan el total.
- ✅ Desglose de IVA por tipo desde `receipt_lines` (relacional, agregable en SQL).
- ✅ Export CSV de recibos + abonos con IVA para contabilidad. `GET /v1/tpv/reports/export.csv` (manager+).
- ❌ Ticket medio, top N productos (V2 — analítica avanzada).

## 8. Integración fiscal Veri*Factu

- ✅ Cada emisión de recibo/factura publica `tpv.receipt.issued` (payload fiscal completo); `platform/verifactu` crea el registro de alta encadenado (huella) — F2 simplificado, F1 factura, con `idEmisor` del emisor por-tenant.
- ✅ Cada abono publica `tpv.receipt.voided`; verifactu registra rectificativa `R1` (importe negativo).
- ✅ El recibo incorpora el QR de cotejo devuelto por verifactu (`verifactu.registro.created` → único UPDATE permitido sobre el snapshot); fallos → `verifactu.registro.failed` → `verifactu_status='failed'`.
- 🔧 Remisión a AEAT — responsabilidad de `platform/verifactu`, cuyo SOAP/firma sigue stubbed a la espera de specs (skeleton).
- ✅ Diseño fire-and-forget: el TPV opera aunque verifactu caiga; el estado fiscal del documento queda `pending` y se completa async.

## 9. Integraciones con otros módulos (REUSE)

- ✅ `platform/pos` — motor de cuentas: evento `pos.bill.paid` **enriquecido** (subTenantId, currency, subtotal/tax, metadata con deviceId, desglose `payments[]`, `unitPriceCents` por línea — cambio aditivo en `platform/pos/src/services/pos.service.js`) + `pos.bill.cancelled`. El frontend TPV abre/cobra bills contra `/api/pos/*` con `metadata.deviceId`.
- ✅ `platform/catalog` — productos por SKU textual (mismo patrón que pos).
- 🔧 `platform/inventory` — el evento `tpv.receipt.voided` está listo; falta el consumer de restock.
- 🔧 `platform/payments` — refund de tarjeta pendiente de cablear (hoy `refund_external_ref` manual).
- 🔧 `platform/notifications` — `tpv.receipt.send_requested` publicado; falta consumer + plantilla.
- ✅ `platform/verifactu` — ciclo completo por eventos (§8).

## 10. Configuración

- ✅ Settings por tenant (`platform_tpv.settings`, RLS): **emisor fiscal** (NIF/razón social/dirección — obligatorio para emitir, se snapshotea en cada recibo), `auto_issue_simplified`, umbral cash-out, horas autoclose, ventana de canje, series por defecto, pie de ticket. `GET/PUT /v1/tpv/settings` (manager+).
- ✅ Config service-level (`platform_tpv.config`, patrón estándar con cifrado AES-256-GCM listo aunque V1 no tiene secretos): defaults de plataforma. `GET/PATCH /v1/tpv/admin/config` (`super_admin`/`staff`).
- ✅ Vista en console: `apps/console/console-portal/src/views/staff/config/TpvConfig.jsx` (sidebar "TPV / Caja").
- ✅ Emisión automática del simplificado (`auto_issue_simplified`) al consumir `pos.bill.paid` — falla blando: si el emisor/serie no están configurados el fact queda `pending` para emisión manual.

## 11. Modo offline y resiliencia (V2)

- ❌ Cola local de operaciones con idempotency keys; sincronización al recuperar red.
- ❌ Caché local de catálogo y precios.
- ❌ Numeración offline: rango pre-reservado por dispositivo.
- ❌ Gestión de conflictos al sincronizar.
- ✅ Idempotencia frente a reentrega de eventos: `billing_facts` UNIQUE por bill (la reentrega no duplica imputación ni recibo).

## 12. Eventos

- ✅ `tpv.session.opened` / `tpv.session.closed` (con `varianceCents` y `zReportId`) / `tpv.session.reopened`.
- ✅ `tpv.session.force_closed` — emitido por el job del scheduler.
- ✅ `tpv.cash.moved` — movimientos manuales de efectivo.
- ✅ `tpv.receipt.issued` — payload fiscal completo (consumido por verifactu).
- ✅ `tpv.receipt.voided` — abono autorizado (consumido por verifactu; listo para inventory).
- ✅ `tpv.receipt.send_requested` — reenvío por email (pendiente el consumer en notifications).
- ✅ `tpv.zreport.generated` — informe Z disponible.
- ✅ Suscripciones entrantes: `pos.bill.paid`, `pos.bill.cancelled`, `verifactu.registro.created`, `verifactu.registro.failed`.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Consumer de `tpv.receipt.send_requested` en `platform/notifications`** + plantilla de
   email con el render del recibo — cierra el reenvío al cliente (§4) con muy poco código.
2. **Consumer de restock en `platform/inventory`** sobre `tpv.receipt.voided` — cierra el
   ciclo de devoluciones con stock (§6).
3. **Refund de tarjeta vía `platform/payments`** al autorizar abonos `card` con
   `external_ref` de Stripe — hoy es conciliación manual (§6).
4. **Desbloquear `platform/verifactu`** (huella/firma/SOAP contra specs AEAT reales) — el
   feed desde tpv ya está; es el bloqueo legal de go-live en España.
5. **Frontend TPV** (vista de caja en el portal de cada app): abrir bill en pos con
   `metadata.deviceId`, cobrar, emitir/convertir/abonar e imprimir el render.
6. **Modo offline** (V2, §11) — rango de numeración pre-reservado + cola local.
