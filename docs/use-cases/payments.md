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

- ✅ Almacenamiento cifrado (AES-256-GCM) de los **dos juegos** de claves Stripe — `stripe_test_*`
  y `stripe_live_*` (secret, publishable, webhook secret) — en `platform_payments.config`
  (migración `0004`, que renombró el juego único previo al set test).
- ✅ **Modo activo conmutable**: fila plain `stripe_mode` (`test`|`live`); `reloadStripeFromDb()`
  resuelve el juego del modo activo y `getWebhookSecret()` devuelve el `whsec_` de ese modo.
  `getStripeMode()` expone el modo cargado.
- ✅ GET `/v1/payments/admin/config` — lista qué claves están configuradas (flag `configured`,
  nunca el plain text; `stripe_mode` como `value`).
- ✅ PATCH `/v1/payments/admin/config` — upsert de una o varias claves y/o `stripe_mode`; zod
  valida el prefijo por juego (`sk_test_`/`pk_test_` vs `sk_live_`/`pk_live_`) para que una clave
  live nunca aterrice en el hueco test. Reload del cliente al tocar el modo o una secret key.
- ✅ Guard `requireRole('super_admin', 'staff')` en todas las rutas admin.
- ✅ Fallback a variables de entorno `PLATFORM_STRIPE_*` **solo para el juego test** (lo que vive
  en env son credenciales test; live se resuelve exclusivamente de DB).
- 🔧 Rotación de credenciales: el doble juego test/live cubre el cambio de entorno sin re-pegar
  claves; sin periodo de gracia con doble clave activa *dentro* de un mismo modo.
- ❌ Historial de cambios (quién cambió la clave y cuándo) con audit log (la columna
  `updated_by_user_id` existe; falta el log de revisiones).
- ✅ Vista en la consola admin (`apps/console` → `PaymentsConfig.jsx`): dos bloques de claves
  (test/live) con badge del modo activo y switch segmentado Test|Live que persiste `stripe_mode`
  al guardar.
- ❌ Soporte multi-cuenta Stripe por `app_id` (hoy hay una única cuenta global por instancia).

## 2bis. Terminal — Tap to Pay (card-present)

- ✅ `POST /v1/payments/terminal/connection-token` — emite un Stripe Terminal ConnectionToken
  para el SDK nativo y devuelve el `locationId` (Location creada perezosamente y cacheada en
  `platform_payments.config` clave `terminal_location_id`, migración `0005`).
- ✅ `POST /v1/payments/terminal/intents` — crea un PaymentIntent **`card_present`** para el
  importe del teclado (`payment_method_types: ['card_present']` — la única excepción donde
  Stripe admite ese parámetro; capture automático). Persiste en `transactions` con
  `metadata.source = 'tap_to_pay'`; idempotencia y dev-stub iguales que one-shot.
- ✅ El cobro lo confirma el SDK **en el dispositivo** (el móvil es el lector); el webhook
  `payment_intent.succeeded` ya existente reconcilia la transacción — sin cambios.
- 🔧 Cliente: **app nativa Expo** `apps/tpv/tpv-app` (Tap to Pay solo existe en SDK nativo,
  no en web/PWA). V1 en modo test con reader simulado; tap físico requiere dispositivo
  compatible + Tap to Pay habilitado en la cuenta.
- ❌ Emisión de recibo fiscal `platform/tpv` tras el cobro (fase 2).

## 2. PaymentIntents — cobro único (one-shot)

- ✅ Tabla `platform_payments.transactions` usada por el servicio de PaymentIntents
  (columnas `idempotency_key` UNIQUE por `(app_id, tenant_id)` y `last_error` añadidas en migración
  `0003`).
- ✅ `POST /v1/payments/intents` — crear PaymentIntent en Stripe con idempotency key (dev-stub
  cuando no hay credenciales, igual que splitpay).
- ✅ Almacenamiento y sincronización de estado del PaymentIntent
  (`requires_payment_method → requires_action → requires_capture → succeeded / canceled`); el
  estado final se sincroniza vía webhook.
- ✅ `GET /v1/payments/intents/:id` — consulta de estado; `GET /v1/payments/intents` con paginación
  por cursor.
- ✅ `DELETE /v1/payments/intents/:id` — cancelación de PaymentIntent no capturado (libera el hold).
- ✅ Scoping obligatorio `(app_id, tenant_id)` en cada operación (RLS + filtros explícitos).
- ✅ Idempotency keys almacenados en Redis (TTL 24h) para deduplicar reintentos del cliente
  (clave cacheada con el resultado; un reintento devuelve la transacción original sin re-llamar a
  Stripe).

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

- ✅ `capture_method: 'manual'` en la creación del PaymentIntent (campo `captureMethod`).
- ✅ `POST /v1/payments/intents/:id/capture` — capturar el monto autorizado (parcial o total, con
  validación `amountToCapture ≤ autorizado` e idempotency key `cap_<txId>`).
- ❌ Caducidad del hold (Stripe: 7 días para tarjeta) — job en `platform/scheduler`
  (`payment-hold-expire`) para cancelar intents no capturados antes de que expiren.
  **[cross-cutting pendiente — scheduler]**
- ✅ `DELETE /v1/payments/intents/:id` — liberar hold antes de captura (cancela el intent).

## 7. Reembolsos — totales y parciales

- ✅ Tabla `platform_payments.refunds` — `(id, app_id, tenant_id, sub_tenant_id, transaction_id,
  provider_refund_id, amount_cents, currency, reason, status, idempotency_key, created_by_user_id,
  created_at, updated_at)` con RLS por `(app_id, tenant_id)` (migración `0003`).
- ✅ `POST /v1/payments/transactions/:id/refunds` — crear reembolso total o parcial.
- ✅ Validaciones: importe ≤ remanente, transacción en estado `succeeded`, no
  reembolso duplicado (idempotency key Redis + UNIQUE en DB).
- ✅ Motivos de reembolso: `duplicate`, `fraudulent`, `requested_by_customer`.
- ✅ Sincronización de estado `pending / succeeded / failed` vía webhook
  `charge.refund.updated`.
- ✅ Reembolso de reembolsos parciales acumulativos (suma de parciales no-failed ≤ original); la
  transacción pasa a `partially_refunded` o `refunded` según el acumulado.
- ❌ Notificación al usuario sobre el reembolso (REUSE `platform/notifications`).
  **[cross-cutting pendiente — notifications]** (el módulo ya emite el evento
  `payment.refunded` en `platform.events`, listo para que notifications lo consuma).
- ✅ Trazabilidad: `created_by_user_id` + `reason` guardados en cada reembolso.
- ✅ Restricción de rol: solo `staff` / `super_admin` pueden iniciar reembolsos
  (`requireRole` en la ruta). El flujo operacional del usuario final pasa por `platform/disputes`.

## 8. Webhooks Stripe — recepción y verificación de firma

- ✅ `POST /v1/payments/webhooks/stripe` — endpoint público (sin auth JWT) para eventos Stripe.
- ✅ Verificación de `Stripe-Signature` con `stripe.webhooks.constructEvent()` y el
  `stripe_webhook_secret` leído de `platform_payments.config` (nunca hardcoded); rechaza
  `400 MISSING_SIGNATURE` / `400 INVALID_SIGNATURE`.
- ✅ Respuesta `200 { received: true }` inmediata antes de procesar (evita timeout Stripe de 30 s).
- 🔧 Procesamiento asíncrono: el handler se ejecuta fuera del hilo HTTP de respuesta (no se
  bloquea el `200`), pero in-process. Un worker dedicado / cola Redis `platform.stripe.events`
  queda pendiente. **[cross-cutting pendiente — worker/scheduler]**
- ✅ Idempotencia en el procesamiento: `stripe_event_id` se guarda en
  `platform_payments.webhook_events` (`recordReceived` con `ON CONFLICT DO NOTHING`); los
  replays se descartan.
- 🔧 Eventos manejados: `payment_intent.succeeded`, `payment_intent.payment_failed`
  (con `last_payment_error.code`), `payment_intent.canceled`, `payment_intent.requires_action`,
  `charge.refund.updated`. `customer.subscription.*` y `setup_intent.succeeded` quedan
  pendientes (suscripciones / SetupIntents no implementados aún).
- 🔧 Estado por evento persistido en `webhook_events` (`received → processed / failed` con
  `error`). Un dead-letter / retry store con alerta a staff queda pendiente.
  **[cross-cutting pendiente — notifications/scheduler]**
- 🔧 `webhook_events` actúa como audit log básico de eventos recibidos; el detalle redactado
  del payload aún no se almacena.

## 9. Idempotencia

- ✅ Generación de `idempotency_key` escopada por tenant (`${appId}:${tenantId}:${callerKey}`)
  antes de cada llamada a Stripe; además se pasa una clave a la API de Stripe (`pi_…`, `ref_…`,
  `cap_…`).
- ✅ Almacenamiento de la clave en Redis con TTL 24 h (`SETEX payments:idem:{key} 86400 …`,
  cacheando el *resultado* de la operación).
- ✅ Verificación previa a la llamada: si la clave existe en Redis, se devuelve el resultado
  cacheado sin llamar a Stripe de nuevo.
- ✅ Persistencia de la clave también en `platform_payments.transactions.idempotency_key` y
  `refunds.idempotency_key` con índice UNIQUE por `(app_id, tenant_id, idempotency_key)` para
  auditabilidad post-TTL.
- 🔧 Cubierto por tests unitarios (cache hit/miss, scoping por tenant, clave Stripe). Una prueba
  de carga concurrente end-to-end queda pendiente.

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

> Nota: el módulo `platform/payments` ya **publica** los eventos de dominio en `platform.events`
> (`payment.succeeded`, `payment.failed`, `payment.refunded`, `payment.captured`,
> `payment.requires_action`, `payment.intent.created/canceled`, `payment.refund.updated`). Falta
> el **consumidor** en `platform/notifications` que los traduzca a emails/push.
> **[cross-cutting pendiente — notifications]**

- 🔧 Email de confirmación de pago (REUSE `platform/notifications`): evento `payment.succeeded`
  ya emitido; falta la plantilla y el consumidor.
- 🔧 Email de fallo de pago: evento `payment.failed` (con `errorCode`) ya emitido; falta plantilla.
- 🔧 Email de reembolso emitido: evento `payment.refunded` ya emitido; falta plantilla.
- ❌ Email de chargeback resuelto (plantilla `payment.dispute.resolved`).
- ❌ Push / in-app (REUSE `platform/notifications` canal push) para notificaciones en tiempo real.
- ❌ Preferencias de notificación por usuario (opt-out de confirmaciones de pago si ya
  llega recibo por otra vía).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ~~**PaymentIntents básico + webhook `payment_intent.succeeded/failed`**~~ ✅ — desbloquea el
   primer cobro real. Implementado sobre `platform_payments.transactions` con dev-stub.
2. ~~**Idempotencia con Redis (TTL 24 h)**~~ ✅ — clave escopada por tenant, resultado cacheado;
   regla crítica CLAUDE.md §3.
3. ~~**Verificación de firma de webhook**~~ ✅ — `constructEvent` con `stripe_webhook_secret` de
   DB; `400` sin firma o firma inválida (regla crítica §5).
4. **Gestión de métodos de pago (wallet del usuario)** — habilita cobros off-session y
   suscripciones; base para dunning y renovaciones. *(pendiente: tabla `payment_methods` +
   SetupIntents — UI + flujo Stripe.js)*
5. ~~**Reembolsos totales y parciales**~~ ✅ — totales/parciales acumulativos, gate `staff`,
   sync vía `charge.refund.updated`; se apoya en `platform/disputes` para el flujo operacional.
6. 🔧 **Notificaciones de pago** (REUSE `platform/notifications`) — el módulo ya **emite** los
   eventos `payment.succeeded` / `payment.failed` / `payment.refunded` / `payment.intent.*` a
   `platform.events`; falta el consumidor en `platform/notifications`.
   **[cross-cutting pendiente — notifications]**
7. 🔧 **3DS/SCA** — el flujo `requires_action` se sincroniza por webhook y `setupFutureUsage`
   (`off_session`/`on_session`) ya se acepta en la creación; falta el manejo completo de
   exenciones SCA y la pieza frontend (Stripe.js challenge).
8. **Vista admin en consola** (`/admin/payments/config` + historial de transacciones) — sin
   ella el staff no puede operar el módulo; REUSE del patrón ya establecido en otros módulos.
9. **Reconciliación periódica** (REUSE `platform/scheduler`) — detecta discrepancias antes
   de que se conviertan en problemas contables; coste bajo una vez que hay transacciones en DB.
10. **Dunning y suscripciones** — coordinado con `platform/subscriptions` cuando ese módulo
    se implemente; no bloqueante para los casos de uso de pago único.
