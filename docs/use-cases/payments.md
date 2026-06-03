# Casos de uso — `platform/payments` (platform-core)

> Dominio: pasarela de pagos genérica con Stripe — cobros directos (sin split), métodos de pago,
> intents, reembolsos, webhooks, idempotencia y compliance PCI/SCA.
>
> **Relación con módulos adyacentes:**
> - `platform/splitpay` — cubre Stripe Connect (pagos con split automático a cuentas conectadas,
>   transferencias, reglas de reparto, checkout sessions, reversiones proporcionales). Todo lo
>   relacionado con marketplace multi-vendedor vive allí. **No duplicar.**
> - `platform/donations` — cubre cobros one-shot y recurrentes para campañas de donación, gestión
>   fiscal (Ley 49/2002, AEAT 182) y causas. **No duplicar.**
> - `platform/notifications` — REUSE obligatorio para enviar recibos, confirmaciones, alertas de
>   fallo de cobro y recordatorios de renovación al usuario final.
> - `platform/scheduler` — REUSE obligatorio para reintentos de cobro (dunning), expiración de
>   holds y reconciliación periódica.

## Estado actual (implementado)

Solo la capa de configuración de credenciales Stripe: tabla `platform_payments.config` (tres
claves: `stripe_publishable_key`, `stripe_secret_key`, `stripe_webhook_secret`) cifradas en
reposo con AES-256-GCM vía `@apphub/platform-sdk/crypto`; GET/PATCH `/v1/payments/admin/config`
con guard `super_admin|staff`; tabla `platform_payments.transactions` con RLS por
`(app_id, tenant_id)` creada pero sin rutas ni servicios que la usen; health endpoint
`GET /api/payments/health`. El motor transaccional (PaymentIntents, webhooks, reembolsos, etc.)
está **pendiente de implementación**.

Leyenda: ✅ implementado · 🔧 parcial / skeleton · ❌ no implementado.

---

## 1. Configuración de credenciales Stripe (admin)

- ✅ Almacenamiento cifrado (AES-256-GCM) de `stripe_secret_key`, `stripe_publishable_key` y
  `stripe_webhook_secret` en `platform_payments.config`.
- ✅ GET `/v1/payments/admin/config` — lista qué claves están configuradas (muestra solo flag
  `configured`, nunca el plain text).
- ✅ PATCH `/v1/payments/admin/config` — upsert de una o varias claves a la vez.
- ✅ Guard `requireRole('super_admin', 'staff')` en todas las rutas admin.
- ✅ Fallback a variables de entorno `PLATFORM_STRIPE_*` cuando la clave no existe en DB.
- ❌ Rotación de credenciales con periodo de gracia (doble clave activa durante el rollover).
- ❌ Historial de cambios (quién cambió la clave y cuándo) con audit log.
- ❌ Vista en la consola admin (`apps/console`) para esta sección (`/admin/payments/config`).
- ❌ Soporte multi-cuenta Stripe por `app_id` (hoy hay una única cuenta global por instancia).

## 2. PaymentIntents — cobro único (one-shot)

- 🔧 Tabla `platform_payments.transactions` existe (con `provider_tx_id`, `amount_cents`,
  `currency`, `status`, `metadata`) pero sin servicio ni rutas que la usen.
- ❌ `POST /v1/payments/intents` — crear PaymentIntent en Stripe con idempotency key.
- ❌ Almacenamiento y sincronización de estado del PaymentIntent
  (`pending → requires_action → requires_capture → succeeded / canceled`).
- ❌ `GET /v1/payments/intents/:id` — consulta de estado para el frontend (polling o tras redirect).
- ❌ `DELETE /v1/payments/intents/:id` — cancelación de PaymentIntent no capturado.
- ❌ Scoping obligatorio `(app_id, tenant_id)` en cada operación (RLS ya está en la tabla).
- ❌ Idempotency keys almacenados en Redis (TTL 24h) para deduplicar reintentos del cliente.

## 3. SetupIntents — guardar método de pago sin cobrar

- ❌ `POST /v1/payments/setup-intents` — crear SetupIntent para guardar tarjeta/SEPA en Stripe.
- ❌ Asociación del `SetupIntent` a un `user_id` y almacenamiento del `payment_method_id`
  resultante en la tabla de métodos de pago del usuario.
- ❌ Reuso del SetupIntent completado para cobros futuros (off-session).
- ❌ Confirmación y estado `succeeded` / `canceled` sincronizados vía webhook.

## 4. Métodos de pago — gestión del wallet del usuario

- ❌ Tabla `platform_payments.payment_methods` — `(user_id, tenant_id, app_id, stripe_pm_id,
  type, last4/iban_last4, brand, exp_month, exp_year, is_default, created_at)`.
- ❌ `GET /v1/payments/users/:userId/payment-methods` — listar métodos guardados.
- ❌ `POST /v1/payments/users/:userId/payment-methods` — añadir (vía SetupIntent completado).
- ❌ `DELETE /v1/payments/users/:userId/payment-methods/:pmId` — eliminar método.
- ❌ `PATCH /v1/payments/users/:userId/payment-methods/:pmId/default` — marcar como predeterminado.
- ❌ Tipos soportados: tarjeta (card), SEPA Direct Debit (`sepa_debit`), Bizum (vía Stripe
  `bizum`), Apple Pay / Google Pay (wallets), Link (Stripe).
- ❌ Sincronización con Stripe cuando un PM caduca o es eliminado desde el dashboard Stripe.
- ❌ Aviso de caducidad próxima (REUSE `platform/notifications` + `platform/scheduler`).

## 5. 3DS / SCA — autenticación reforzada (PSD2)

- ❌ Soporte nativo de 3D Secure 2 en el flujo de PaymentIntent (`payment_method_types:
  ['card']` con `automatic_payment_methods` o lista explícita).
- ❌ Gestión del estado `requires_action` — devolver `client_secret` al frontend para que
  Stripe.js complete el challenge.
- ❌ Exenciones SCA (TRA, bajo importe <30 €, suscripciones con acuerdo fuera de banda,
  MIT off-session).
- ❌ Indicadores `setup_future_usage: 'off_session'` y `'on_session'` en los intents.
- ❌ Manejo de `payment_intent.payment_failed` con `last_payment_error.code` en webhook.

## 6. Cobro diferido — autorización y captura separadas

- ❌ `capture_method: 'manual'` en la creación del PaymentIntent.
- ❌ `POST /v1/payments/intents/:id/capture` — capturar el monto autorizado (parcial o total).
- ❌ Caducidad del hold (Stripe: 7 días para tarjeta) — job en `platform/scheduler`
  (`payment-hold-expire`) para cancelar intents no capturados antes de que expiren.
- ❌ `POST /v1/payments/intents/:id/cancel` — liberar hold antes de captura.

## 7. Reembolsos — totales y parciales

- ❌ Tabla `platform_payments.refunds` — `(id, transaction_id, stripe_refund_id,
  amount_cents, reason, status, created_by, created_at)`.
- ❌ `POST /v1/payments/transactions/:id/refunds` — crear reembolso total o parcial.
- ❌ Validaciones: importe ≤ importe original, transacción en estado `succeeded`, no
  reembolso duplicado (idempotency key Redis).
- ❌ Motivos de reembolso: `duplicate`, `fraudulent`, `requested_by_customer`.
- ❌ Sincronización de estado `pending / succeeded / failed` vía webhook
  `charge.refund.updated`.
- ❌ Reembolso de reembolsos parciales acumulativos (suma parciales ≤ original).
- ❌ Notificación al usuario sobre el reembolso (REUSE `platform/notifications`).
- ❌ Trazabilidad: quién solicitó el reembolso + motivo guardado en la transacción.
- ❌ Restricción de rol: solo `staff` / `super_admin` pueden iniciar reembolsos desde el admin;
  el usuario final puede solicitarlo y pasa por el módulo `platform/disputes` si aplica.

## 8. Webhooks Stripe — recepción y verificación de firma

- ❌ `POST /v1/payments/webhooks/stripe` — endpoint público (sin auth JWT) para eventos Stripe.
- ❌ Verificación de `Stripe-Signature` con `stripe.webhooks.constructEvent()` y el
  `stripe_webhook_secret` leído de `platform_payments.config` (nunca hardcoded).
- ❌ Respuesta `200` inmediata antes de procesar (evitar timeout Stripe de 30 s).
- ❌ Procesamiento asíncrono: encolar evento en Redis `platform.stripe.events` y procesar
  en worker separado para no bloquear el hilo HTTP.
- ❌ Idempotencia en el procesamiento: guardar `stripe_event_id` en tabla
  `platform_payments.webhook_events` y descartar duplicados.
- ❌ Eventos mínimos a manejar: `payment_intent.succeeded`, `payment_intent.payment_failed`,
  `payment_intent.canceled`, `payment_intent.requires_action`, `charge.refund.updated`,
  `customer.subscription.*` (si se integra dunning), `setup_intent.succeeded`.
- ❌ Dead-letter / retry store para eventos que fallan al procesar (con alerta a staff).
- ❌ Audit log de todos los eventos Stripe recibidos (para reconciliación y debugging).

## 9. Idempotencia

- ❌ Generación de `idempotency_key` (`${tenantId}:${userId}:${operationType}:${referenceId}`)
  antes de cada llamada a la API de Stripe.
- ❌ Almacenamiento de la clave en Redis con TTL 24 h (`SETEX payments:idem:{key} 86400 1`).
- ❌ Verificación previa a la llamada: si la clave existe en Redis, devolver la transacción
  ya creada sin llamar a Stripe de nuevo.
- ❌ Persistencia de la clave también en `platform_payments.transactions.idempotency_key`
  (TEXT UNIQUE) para auditabilidad post-TTL.
- ❌ Prueba de carga: garantizar que reintentos concurrentes del mismo cliente no crean
  cobros dobles (test de idempotencia end-to-end).

## 10. Gestión de disputas y chargebacks (operacional)

> Nota: el módulo `platform/disputes` cubre disputas operacionales entre comprador y vendedor
> (pre-chargeback, marketplace). Lo descrito aquí es la gestión de chargebacks formales
> iniciados por el banco/Stripe.

- ❌ Tabla `platform_payments.chargebacks` — `(id, transaction_id, stripe_dispute_id,
  reason, status, evidence_due_by, amount_cents, created_at)`.
- ❌ Webhook `customer.dispute.created` → registrar chargeback, bloquear fondos, notificar staff.
- ❌ `POST /v1/payments/chargebacks/:id/evidence` — subir evidencia a Stripe
  (REUSE `platform/storage` para los archivos adjuntos).
- ❌ `POST /v1/payments/chargebacks/:id/accept` — aceptar la disputa sin evidencia.
- ❌ Webhook `customer.dispute.updated` / `customer.dispute.closed` → actualizar estado.
- ❌ Job en `platform/scheduler` (`chargeback-sla`) — alerta cuando `evidence_due_by` se acerca.
- ❌ Notificación a staff (REUSE `platform/notifications`).
- ❌ Actualización automática del estado de la transacción original a `disputed` / `lost`.

## 11. Reconciliación y reporting financiero

- ❌ Job periódico en `platform/scheduler` (`payment-reconcile`) — compara transacciones
  `platform_payments.transactions` con el balance de Stripe (`/v1/balance_transactions`) y
  detecta discrepancias.
- ❌ Tabla `platform_payments.reconciliation_runs` — resultado de cada ejecución con
  número de transacciones, discrepancias detectadas y estado.
- ❌ Alerta a staff cuando se detecta discrepancia (REUSE `platform/notifications`).
- ❌ `GET /v1/payments/admin/reconciliation` — historial de runs con detalle de gaps.
- ❌ Export CSV/XLSX de transacciones filtradas por `(app_id, tenant_id, fecha, estado,
  currency)` para contabilidad.
- ❌ Dashboard de volumen de pagos (TPV), tasa de éxito, importe reembolsado y neto por
  periodo/moneda.

## 12. Multi-moneda

- ❌ Almacenamiento de `currency` en `platform_payments.transactions` (campo ya existe,
  valor fijo `'eur'` por defecto).
- ❌ Configuración de monedas permitidas por tenant en `platform_payments.config`.
- ❌ Conversión de presentación (formato localizado en el frontend) vs moneda de liquidación
  en Stripe (currency of settlement).
- ❌ Stripe Automatic Currency Conversion (presentational currency) para cobros
  cross-border.
- ❌ Validación: rechazar currency no soportada por la cuenta Stripe del tenant.
- ❌ Reporting separado por moneda (no sumar EUR + USD como si fueran iguales).

## 13. Impuestos, IVA y recibos (fiscal)

> Nota: la facturación verificable AEAT (VeriFactu) vive en `platform/verifactu`. Lo descrito
> aquí es el plano fiscal básico de los cobros (IVA, recibos simples, Stripe Tax).

- ❌ `tax_amount_cents` y `tax_rate` en `platform_payments.transactions` para desglosar IVA.
- ❌ Integración con Stripe Tax (`automatic_tax: { enabled: true }`) para cálculo automático
  de IVA/GST por jurisdicción del cliente.
- ❌ Generación de recibo simple en PDF (REUSE `platform/notifications` canal email, plantilla
  de recibo) adjunto al evento `payment_intent.succeeded`.
- ❌ Configuración de `tax_id` del tenant en la ficha de cliente de Stripe (CIF/NIF/VAT).
- ❌ Validación de NIF/VAT de cliente B2B (VIES para UE, formato ES para España).
- ❌ Línea de IVA en recibo (tipo, base imponible, cuota).
- ❌ Integración con `platform/verifactu` para emitir factura verificable cuando la
  operación lo requiere (B2B o importes altos).

## 14. Suscripciones y pagos recurrentes (dunning)

> Nota: el módulo `platform/subscriptions` está planificado. El módulo `platform/payments`
> debe proveer la plomería de cobro recurrente (Stripe Subscriptions / Payment Schedules) sobre
> la que `platform/subscriptions` se apoye, o bien delegar completamente en él cuando esté
> implementado.

- ❌ Creación de `stripe.customers` asociados a `(user_id, tenant_id, app_id)` y almacenados
  en `platform_payments.customers`.
- ❌ Creación de Stripe Subscriptions (`monthly`, `yearly`, custom interval) con
  `default_payment_method`.
- ❌ Webhooks de ciclo de vida de suscripción: `invoice.payment_succeeded`,
  `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
- ❌ Lógica de dunning: reintentos escalonados (D+3, D+7, D+14) con notificaciones
  (REUSE `platform/notifications`) y job en `platform/scheduler` (`payment-dunning`).
- ❌ Periodo de gracia configurable antes de suspender acceso (coordinado con
  `platform/subscriptions` / `platform/auth`).
- ❌ `POST /v1/payments/subscriptions/:id/cancel` — cancelación al final del periodo o inmediata.
- ❌ Prorrateado automático al hacer upgrade/downgrade de plan.
- ❌ Factura manual (`stripe.invoices.create + finalize + pay`) para cobros puntuales
  a un cliente con `payment_method` guardado (off-session).

## 15. Payouts — liquidación a cuentas bancarias del tenant

> Nota: los payouts de Stripe Connect (reparto entre plataforma y vendedores) son competencia
> de `platform/splitpay`. Los payouts de practicantes/freelancers son competencia de
> `platform/practitioner-payouts`. Lo descrito aquí son los payouts de la cuenta Stripe
> estándar de AppHub hacia sus propias cuentas bancarias.

- ❌ Configuración del schedule de payout (automático `daily/weekly/monthly` o manual)
  en la cuenta Stripe del tenant vía admin.
- ❌ Webhooks `payout.created`, `payout.paid`, `payout.failed` — registrar en
  `platform_payments.payouts` y notificar a staff.
- ❌ `GET /v1/payments/admin/payouts` — historial de payouts con estado y fecha de
  llegada estimada.
- ❌ Alerta de payout fallido (REUSE `platform/notifications`).

## 16. Reintentos y resiliencia

- ❌ Wrapper de la librería `stripe-node` con retry automático en errores transitorios
  (HTTP 429 / 500 / 503) — Stripe SDK ya tiene `maxNetworkRetries` pero debe configurarse.
- ❌ Circuit breaker / fallback cuando Stripe no responde (cola de pagos pendientes para
  reintentar cuando el servicio se recupere).
- ❌ Timeout configurado en las llamadas Stripe (por defecto 80 s — reducir a 30 s).
- ❌ Alertas cuando la tasa de error de Stripe supera un umbral (REUSE `platform/notifications`).
- ❌ Modo "mantenimiento": rechazar con `503` y mensaje localizado cuando el módulo está
  degradado (por ejemplo, rotación de credenciales en curso).

## 17. PCI DSS / compliance

- ❌ Uso de Stripe.js / Stripe Elements en el frontend (nunca enviar datos de tarjeta al
  servidor de AppHub — SAQ A-EP / SAQ A según el modelo de integración).
- ❌ Uso de `payment_method` tokenizado (Stripe PM ID), no datos de tarjeta en claro.
- ❌ No almacenar PAN, CVV ni `exp_*` en tablas propias — solo `stripe_pm_id` y metadatos
  de presentación (`last4`, `brand`).
- ❌ Headers HTTP de seguridad en el endpoint de webhooks (CSP estricto, no CORS).
- ❌ Audit log de todas las llamadas salientes a la API Stripe (método, payload redactado,
  respuesta HTTP code, latencia).
- ❌ Restricción de IP (allowlist) para llamadas desde `platform-core` a Stripe API.
- ❌ Gestión de secretos con rotación periódica y sin exposure en logs
  (actualmente el plaintext de `stripe_secret_key` solo debe aparecer en llamadas cifradas).
- ❌ Test de penetración periódico y escaneo de vulnerabilidades en el endpoint de webhooks.

## 18. Notificaciones de pago al usuario final

- ❌ Email de confirmación de pago (REUSE `platform/notifications` — plantilla
  `payment.succeeded`): importe, descripción, fecha, últimos 4 dígitos.
- ❌ Email de fallo de pago (plantilla `payment.failed`): motivo localizado + enlace para
  actualizar método de pago.
- ❌ Email de reembolso emitido (plantilla `payment.refunded`): importe, plazo de acreditación.
- ❌ Email de chargeback resuelto (plantilla `payment.dispute.resolved`).
- ❌ Push / in-app (REUSE `platform/notifications` canal push) para notificaciones en tiempo real.
- ❌ Preferencias de notificación por usuario (opt-out de confirmaciones de pago si ya
  llega recibo por otra vía).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **PaymentIntents básico + webhook `payment_intent.succeeded/failed`** — desbloquea el primer
   cobro real; sin esto el módulo es inerte. Construir sobre la tabla
   `platform_payments.transactions` ya existente.
2. **Idempotencia con Redis (TTL 24 h)** — obligatorio junto con #1 para evitar cobros dobles
   en reintentos de red; es una regla crítica del proyecto (CLAUDE.md §3).
3. **Verificación de firma de webhook** — obligatorio junto con #2; sin firma verificada el
   endpoint es un vector de ataque (regla crítica §5 de CLAUDE.md).
4. **Gestión de métodos de pago (wallet del usuario)** — habilita cobros off-session y
   suscripciones; base para dunning y renovaciones.
5. **Reembolsos totales y parciales** — necesario para cualquier flujo de devolución /
   cancelación de pedido; se apoya en `platform/disputes` para el flujo operacional.
6. **Notificaciones de pago** (REUSE `platform/notifications`) — confirmación y fallo de cobro;
   bajo coste porque solo requiere publicar eventos Redis bien tipados.
7. **3DS/SCA** — obligatorio para tarjetas europeas (PSD2); el flujo `requires_action` debe
   gestionarse antes de ir a producción en la UE.
8. **Vista admin en consola** (`/admin/payments/config` + historial de transacciones) — sin
   ella el staff no puede operar el módulo; REUSE del patrón ya establecido en otros módulos.
9. **Reconciliación periódica** (REUSE `platform/scheduler`) — detecta discrepancias antes
   de que se conviertan en problemas contables; coste bajo una vez que hay transacciones en DB.
10. **Dunning y suscripciones** — coordinado con `platform/subscriptions` cuando ese módulo
    se implemente; no bloqueante para los casos de uso de pago único.
