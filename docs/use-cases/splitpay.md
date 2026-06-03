# Casos de uso — `platform/splitpay` (platform-core)

> Dominio: Stripe Connect / split payments. Cuentas Connect de tipo Express, reglas de reparto configurables por porcentaje, PaymentIntents con `transfer_data` + `application_fee_amount`, transferencias adicionales para splits multi-destinatario disparadas por webhook, reversals proporcionales en reembolsos, Checkout Sessions (one-shot y suscripciones recurrentes), verificación de firma de webhook, idempotencia con clave Redis 24 h. Scoping por `(app_id, tenant_id, sub_tenant_id)` con RLS.

## Estado actual (implementado)

Cuentas Connect Express (`POST /v1/splitpay/connect-accounts`), refresh de enlace de onboarding, sincronización de estado desde webhook `account.updated`; reglas de split por porcentaje con `platform_fee_percent` + array `recipients` (validación: suma == 100 %), caché Redis 60 s, endpoint `/simulate`; PaymentIntents con `application_fee_amount` + `transfer_data.destination` (destinatario primario) + transferencias adicionales on-demand en `payment_intent.succeeded`; reembolsos parciales o totales con reversals proporcionales (`calculateProportionalRefunds`) e idempotencia Redis 24 h; Checkout Sessions `mode=payment|subscription` con split opcional; webhook `POST /v1/splitpay/webhooks/stripe` (verifica `Stripe-Signature`, proceso en background); eventos Redis en `{appId}.events` + `platform.events`; tabla `disputes` (creación y cierre desde webhook); config runtime AES-256-GCM (`platform_account_id`, `stripe_secret_key`, `stripe_publishable_key`, `stripe_webhook_secret`) recargable sin redeploy desde `PATCH /v1/splitpay/admin/config`; staff impersonation de tenant desde console.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Onboarding de cuentas Connect

- ✅ Crear cuenta Express con `email`, `businessType`, `country`, capacidades `card_payments` + `transfers`.
- ✅ Generar enlace de onboarding Stripe (`AccountLink` tipo `account_onboarding`) con `returnUrl` + `refreshUrl`.
- ✅ Refrescar enlace de onboarding cuando el original ha expirado (`POST /:id/onboarding-link`).
- ✅ Persistir la cuenta con estado `pending`/`active`/`restricted`/`disabled` y flags `payouts_enabled`/`charges_enabled`.
- ✅ Sincronizar estado desde evento `account.updated` del webhook.
- ✅ Listar cuentas Connect del tenant (`GET /v1/splitpay/connect-accounts`).
- 🔧 Solo tipo Express; no se crean cuentas Standard ni Custom.
- ❌ Dashboard link (`AccountSession` + Connect embedded components) para que el merchant vea su saldo en la UI propia sin salir del portal.
- ❌ Onboarding por tipo Custom con aceptación de ToS en nombre del merchant (`tos_acceptance`).
- ❌ Prefill de datos de negocio (nombre legal, dirección, tax ID, IBAN/routing) al crear la cuenta.
- ❌ Multiples cuentas Express por tenant (p. ej. varios vendedores dentro de un mismo tenant marketplace).
- ❌ Desactivación/desconexión de cuenta Connect desde el portal (llamada a `stripe.accounts.del` o revocación OAuth).

## 2. KYC / verificación de identidad

- ✅ Estado `restricted` detectado cuando `requirements.disabled_reason` está presente en Stripe.
- 🔧 El estado se sincroniza vía webhook `account.updated`, pero no se notifica proactivamente al merchant ni al staff.
- ❌ Lectura de `requirements.currently_due` / `eventually_due` / `past_due` para mostrar al merchant qué documentos faltan.
- ❌ Upload de documentos de identidad / negocio desde el portal (Stripe Files API + `account.individual.verification`).
- ❌ Notificación automática al merchant cuando Stripe solicita más información (REUSE `platform/notifications`).
- ❌ Alerta de staff cuando una cuenta pasa a `restricted` o `disabled` (evento Redis → notificación interna).
- ❌ Flujo de apelación / soporte para cuentas bloqueadas.
- ❌ Integración con webhooks `account.application.deauthorized` (OAuth revocación).

## 3. Capacidades y payouts de la cuenta Connect

- ✅ Capacidades `card_payments` + `transfers` solicitadas al crear la cuenta Express.
- ✅ Flag `payouts_enabled` sincronizado desde Stripe.
- ❌ Solicitud de capacidades adicionales: `ideal_payments`, `sepa_debit_payments`, `bacs_debit_payments`, `giropay_payments`, etc.
- ❌ Consulta directa a Stripe de la capacidad actual (`capability.status`) por cuenta.
- ❌ Configuración del payout schedule del merchant (diario/semanal/mensual) desde el portal (`POST /accounts/:id/payouts/…`).
- ❌ Payout instantáneo a debit card (`instant_payouts`).
- ❌ Configuración de cuenta bancaria (external account) desde el portal.
- ❌ Listado y consulta de payouts históricos del merchant en Stripe.

## 4. Reglas de split (split rules)

- ✅ Crear regla con nombre, `platform_fee_percent` y array de `recipients` (`accountId acct_…`, `percentage`, `label`).
- ✅ Validación: `platform_fee_percent` + suma de porcentajes de recipients == 100 % (margen < 0.01).
- ✅ Listar reglas activas del tenant, obtener por ID, desactivar (soft-delete).
- ✅ Caché Redis 60 s por regla; invalidación al desactivar.
- ✅ Endpoint `/simulate` — recibe `splitRuleId`, `amount`, `currency`; devuelve desglose completo (Stripe fee, platform fee, importe por recipient) sin crear ningún objeto en Stripe.
- ✅ Scoping de la tabla `split_rules` por `(tenant_id, sub_tenant_id)` con RLS.
- 🔧 Los porcentajes se refieren al neto después de fee de Stripe (2.9 % + 30 céntimos hardcoded). La tarifa de Stripe no es configurable por tenant ni por país.
- ❌ Splits por importes absolutos (en lugar de porcentajes).
- ❌ Reglas de split condicionales (p. ej. distinto porcentaje según tipo de producto, categoría, o monto del pedido).
- ❌ Actualización de una regla existente (solo crear + desactivar; no hay PATCH de regla).
- ❌ Versioning de reglas: historial de cambios para saber qué regla aplicó a cada transacción en el tiempo.
- ❌ Regla de split "plantilla" heredable a nivel sub-tenant.
- ❌ Límite mínimo de importe por destinatario (skip de transfer si `amount <= 0` está implementado, pero no configurable como umbral).

## 5. Creación de PaymentIntent con split

- ✅ Crear PaymentIntent con `application_fee_amount` + `transfer_data.destination` (primer destinatario).
- ✅ Idempotencia garantizada: clave Redis 24 h (`checkIdempotency` / `storeIdempotency`); la clave se pasa por el caller, no se genera internamente.
- ✅ Propagación de `tenant_id`, `sub_tenant_id`, `split_rule_id` en `metadata` de Stripe para trazabilidad.
- ✅ `automatic_payment_methods: { enabled: true }` para que Stripe seleccione el método óptimo.
- ✅ Persistencia de la transacción en `splitpay_core.transactions` con estado inicial y `platform_fee`.
- 🔧 Solo destinatario primario via `transfer_data`; los adicionales se despachan en el webhook `payment_intent.succeeded` (mayor latencia, riesgo de fallo parcial no recuperado).
- ❌ Separate charges & transfers (modelo alternativo para mayor control sobre timing de fees y destinos múltiples desde el momento del cargo).
- ❌ Destination charges (cobro directamente contra la cuenta Connect del merchant, no la de la plataforma).
- ❌ Configuración de `payment_method_types` explícita por tenant (SEPA, iDEAL, Sofort, Klarna, …).
- ❌ `setup_future_usage` para guardar método de pago del cliente para futuros cobros.
- ❌ Propinas (tip): campo adicional a repartir con regla propia o porcentaje fijo.
- ❌ Cobro en nombre de (`on_behalf_of`) para que el extracto del cliente muestre el nombre del merchant en lugar de la plataforma.

## 6. Splits multi-destinatario

- ✅ Lógica `calculateRecipientAmounts`: distribuye neto-plataforma entre N recipients; el último recibe el resto exacto para evitar pérdida por redondeo.
- ✅ Transferencias adicionales (recipients 2…N) creadas en `createAdditionalTransfers` disparado por `payment_intent.succeeded`.
- ✅ Idempotencia de cada transfer individual: clave `tr_{paymentId}_{accountId}`.
- ✅ Log de error por transferencia fallida sin detener las restantes.
- 🔧 El `netAmount` para calcular las transferencias adicionales usa un fee de Stripe hardcodeado (2.9 % + 30 c) que puede no coincidir con la tarifa real negociada.
- 🔧 No se persiste en BD el estado de cada transfer individual; si falla, no hay reintento automático.
- ❌ Reintento automático de transferencias fallidas (job scheduler `platform-scheduler` o evento Redis).
- ❌ Modelo "separate charges & transfers": cargo a plataforma + N transfers independientes (más flexible para splits asimétricos).
- ❌ Transfer group explícito para agrupar todos los transfers de un mismo pago y facilitar conciliación.
- ❌ N-vendedores dinámico: split calculado en runtime según participantes del pedido (marketplace de N vendedores con cantidades variables por vendedor).

## 7. Checkout Sessions

- ✅ Crear sesión `mode=payment` (one-shot) con line items y URL de éxito/cancelación.
- ✅ Crear sesión `mode=subscription` (recurrente) con precios recurrentes.
- ✅ Split opcional via `splitRuleId`; sin regla → "no-split" (todo a la cuenta de plataforma).
- ✅ Metadata enriquecido propagado a `payment_intent_data` / `subscription_data` para disponibilidad en todos los webhooks posteriores.
- ✅ Persistencia en `splitpay_core.checkout_sessions`; obtener por ID (`GET /:id`).
- ✅ Evento Redis `splitpay.checkout.created` publicado en `platform.events`.
- 🔧 No se persiste el `amount` conocido hasta que llega el webhook `checkout.session.completed`.
- ❌ Listado paginado de sesiones por tenant (solo existe `GET /:id`).
- ❌ Expiración explícita de la sesión (campo `expires_at` de Stripe) ni manejo del estado `expired`.
- ❌ Recuperación de sesiones abandonadas (cobros de abandono de carrito vía webhook `checkout.session.expired`).
- ❌ Customer portal para autogestión de suscripciones (Stripe Billing Portal).
- ❌ `allow_promotion_codes` / cupones en checkout.
- ❌ Upsells / cross-sells en la pantalla de checkout (Stripe `after_payment`).
- ❌ `phone_number_collection`, `shipping_address_collection` en checkout.
- ❌ Checkout para prueba gratuita (`subscription_data.trial_period_days`).

## 8. Reembolsos y reversals proporcionales

- ✅ Reembolso total o parcial via `POST /v1/splitpay/payments/:id/refunds`.
- ✅ Cálculo proporcional `calculateProportionalRefunds`: cada transfer es revertido en la misma proporción que el monto reembolsado respecto al total original (regla crítica de plataforma).
- ✅ `stripe.transfers.createReversal` por cada transfer con idempotencia `rev_{idempotencyKey}_{transferId}`.
- ✅ Idempotencia del refund con clave Redis 24 h.
- ✅ Motivo del reembolso: `duplicate`, `fraudulent`, `requested_by_customer`.
- 🔧 Los transfers se leen de Stripe via `stripe.transfers.list({ transfer_group })` pero el `transfer_group` no se setea explícitamente al crear el PaymentIntent, lo cual puede dar resultados incorrectos si hay transfers de distintos orígenes.
- ❌ Reembolso parcial con distribución personalizada (p.ej. devolver solo la parte de un recipient).
- ❌ Persistencia del reembolso en BD (no hay tabla `refunds`; solo log + evento Redis).
- ❌ Evento Redis `splitpay.refund.created` para notificar a la app de origen.
- ❌ Reembolso desde Checkout Session (flujo diferente al de PaymentIntent directo).
- ❌ Crédito en lugar de reembolso (Stripe balance credit al cliente).

## 9. Idempotencia

- ✅ Clave de idempotencia obligatoria (`idempotencyKey`) en `CreatePaymentIntentSchema` y `CreateRefundSchema`.
- ✅ Verificación en Redis antes de ejecutar (`checkIdempotency`), almacenamiento del resultado tras éxito (`storeIdempotency`, TTL 24 h).
- ✅ Clave de idempotencia propagada a Stripe: `pi_{key}` para PaymentIntent, `ref_{key}` para Refund, `tr_{paymentId}_{accountId}` para cada Transfer, `rev_{key}_{transferId}` para cada Reversal.
- 🔧 La clave la genera y gestiona el caller; el módulo no valida formato ni unicidad entre tenants (un `key` podría colisionar si dos apps distintas usan la misma cadena).
- ❌ Idempotencia para la creación de Checkout Sessions (no hay campo `idempotencyKey` en el schema de checkout).
- ❌ Namespacing de la clave por `(tenant_id, idempotency_key)` para evitar colisiones cross-tenant.
- ❌ Audit de claves ya usadas (para detectar reutilización indebida de claves).

## 10. Webhooks y verificación de firma

- ✅ Endpoint `POST /v1/splitpay/webhooks/stripe` — recibe payload raw, verifica `Stripe-Signature` con `stripe.webhooks.constructEvent`.
- ✅ Error 400 explícito si falta la cabecera o la firma no es válida.
- ✅ Respuesta inmediata `{ received: true }` + procesamiento asíncrono en background.
- ✅ Secreto de webhook cargado desde BD (`getWebhookSecret`) con fallback a env var.
- ✅ Eventos soportados: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `account.updated`, `charge.dispute.created`, `charge.dispute.closed`, `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.
- 🔧 El procesamiento en background no tiene dead-letter queue ni reintento; un error es solo logueado.
- ❌ Deduplicación de eventos webhook por `event.id` (Stripe puede entregar el mismo evento más de una vez).
- ❌ Soporte para `payment_method.attached` / `customer.created` / `payout.paid` / `transfer.failed`.
- ❌ Endpoint separado por app/tenant con su propio secret (hoy un único endpoint para toda la plataforma).
- ❌ Alerta de latencia o fallo de webhooks (monitoreo del lag entre `event.created` y procesamiento).

## 11. Publicación de eventos Redis (integración entre módulos)

- ✅ `splitpay.checkout.created` → `platform.events` al crear sesión.
- ✅ `splitpay.checkout.completed` → `{appId}.events` al recibir `checkout.session.completed`.
- ✅ `splitpay.invoice.paid` → `{appId}.events` en renovaciones recurrentes.
- ✅ `splitpay.invoice.payment_failed` → `{appId}.events` en fallo de renovación.
- ✅ `splitpay.subscription.updated` / `splitpay.subscription.deleted` → `{appId}.events`.
- ✅ Caso especial `platform_subscription`: también publica en `platform.events` para que `tenant-config` actualice el estado del tenant.
- 🔧 Si `app_id` no está presente en el metadata, el evento se descarta con `logger.warn` (posible pérdida silenciosa).
- ❌ `splitpay.payment.succeeded` / `splitpay.payment.failed` (PaymentIntents directos, no Checkout) no emiten evento Redis hacia la app de origen.
- ❌ `splitpay.refund.created` — las apps no son notificadas de reembolsos.
- ❌ `splitpay.dispute.created` / `splitpay.dispute.closed` — las apps no son notificadas de chargebacks.
- ❌ `splitpay.transfer.failed` — no hay evento cuando una transferencia adicional falla.

## 12. Gestión de disputas (chargebacks)

- ✅ Registro de disputa en `splitpay_core.disputes` al recibir `charge.dispute.created` (campos: `stripe_dispute_id`, `stripe_charge_id`, `amount`, `currency`, `reason`, `status`, `due_by`).
- ✅ Actualización de estado al recibir `charge.dispute.closed`.
- ✅ Índice para consulta rápida de disputas `needs_response`.
- 🔧 La tabla `disputes` no tiene `tenant_id` — no está aislada por tenant ni por app; cualquier disputa del webhook queda en la tabla global.
- ❌ API de consulta de disputas para el staff (`GET /v1/splitpay/admin/disputes`).
- ❌ Submission de evidencia desde el portal (`stripe.disputes.update` con `evidence`).
- ❌ Alerta automática al merchant/staff cuando se crea una disputa (REUSE `platform/notifications`).
- ❌ SLA tracking: alertar cuando `due_by` se acerca y `evidence_sent == false` (REUSE `platform-scheduler`).
- ❌ Impacto del chargeback en el split: reversal parcial de transferencias si el merchant pierde la disputa.
- ❌ Reconciliación de disputas ganadas/perdidas con el ledger de transacciones.

## 13. Suscripciones recurrentes

- ✅ Checkout Session `mode=subscription` con precios recurrentes (intervalos `day/week/month/year`).
- ✅ Metadata propagado a `subscription_data` para que esté disponible en `invoice.paid` de renovaciones.
- ✅ Persistencia de `stripe_subscription_id` en `checkout_sessions`.
- ✅ Webhook `invoice.paid` → evento `splitpay.invoice.paid`.
- ✅ Webhook `invoice.payment_failed` → evento `splitpay.invoice.payment_failed`.
- ✅ Webhooks `customer.subscription.updated` / `customer.subscription.deleted` → eventos Redis.
- ❌ API para cancelar / pausar una suscripción desde el portal del cliente (Stripe `subscriptions.cancel`, `subscriptions.update`).
- ❌ Cambio de plan (upgrade/downgrade) con prorrateo (`proration_behavior`).
- ❌ Período de prueba gratuito (`trial_period_days`, `trial_end`).
- ❌ Cupones y descuentos en suscripciones (`coupons`, `promotion_codes`).
- ❌ Smart Retries / dunning automático en fallos de cobro (configurable en Stripe Dashboard, no expuesto en el módulo).
- ❌ Customer portal self-service para que el suscriptor gestione su plan, datos de pago y facturas.
- ❌ Métricas de suscripciones: MRR, churn, upgrades, downgrades por tenant.

## 14. Application fees y modelo de ingresos de plataforma

- ✅ `application_fee_amount` calculado sobre el neto (gross − stripe_fee) × `platform_fee_percent`.
- ✅ Aritmética entera en todo el split engine para evitar drift por coma flotante.
- ✅ El último recipient recibe el resto exacto para absorber el centavo del redondeo.
- 🔧 La tarifa de Stripe está hardcodeada (2.9 % + 30 c); no refleja tarifas negociadas ni varía por método de pago.
- ❌ Fee calculado sobre el gross (antes de Stripe fee) como opción alternativa.
- ❌ Fee fijo por transacción (en lugar de o adicional a un porcentaje).
- ❌ Fee escalado por volumen (tiers).
- ❌ Fee diferente por método de pago (tarjeta crédito vs débito vs SEPA vs iDEAL).
- ❌ Exención de fee para tenants específicos (tarifa 0 % configurada por tenant, no global).

## 15. Multi-moneda y conversión

- ✅ Campo `currency CHAR(3)` en transacciones y sesiones; se acepta cualquier moneda soportada por Stripe.
- 🔧 El fee de Stripe hardcodeado (2.9 % + 30 c) solo es correcto para EUR/USD; tarifas para otras monedas difieren.
- ❌ Conversión de moneda automática al transferir a cuentas en divisa distinta (Stripe FX).
- ❌ Configuración de moneda preferida por tenant (default currency).
- ❌ Soporte explícito para `presentment_currency` vs `settlement_currency` (cliente paga en una moneda, merchant recibe en otra).
- ❌ Multi-currency: un mismo split con recipients en distintas monedas.
- ❌ Cálculo correcto de tarifa de Stripe por moneda/región (tabla de tarifas configurable).

## 16. Configuración runtime (admin)

- ✅ Tabla `splitpay_core.config` con claves `platform_account_id`, `stripe_secret_key`, `stripe_publishable_key`, `stripe_webhook_secret`.
- ✅ Valores sensibles cifrados en reposo con AES-256-GCM via `@apphub/platform-sdk/crypto`.
- ✅ `GET /v1/splitpay/admin/config` y `PATCH /v1/splitpay/admin/config` con guard `super_admin|staff`.
- ✅ `reloadStripeFromDb()` tras PATCH para que el cliente Stripe use las nuevas credenciales sin redeploy.
- ✅ Staff impersonation: `super_admin`/`staff` pueden sobrepasar el tenant via `?appId=&tenantId=` query params.
- 🔧 No hay validación de que la `stripe_secret_key` proporcionada sea válida (podría guardarse una clave incorrecta sin detectarlo hasta la primera llamada a Stripe).
- ❌ Config per-tenant / per-app: hoy la config es global (una sola cuenta Stripe de plataforma); sin soporte para instancias multi-plataforma con cuentas distintas por app o tenant.
- ❌ Rotación de clave con período de gracia (mantener clave antigua activa durante N minutos mientras se configura la nueva).
- ❌ Vista en console para splitpay config (`apps/console/console-portal/src/views/staff/config/splitpay.jsx`).

## 17. Reconciliación y audit

- ✅ Tabla `transactions` con `stripe_payment_intent_id`, `amount`, `currency`, `status`, `platform_fee`, `metadata`; índices por `(tenant_id, created_at DESC)`, por `stripe_payment_intent_id` y por estado.
- ✅ Comentario en tabla con hint de particionado por `tenant_id` para volúmenes altos.
- ✅ Listado de pagos con cursor-based pagination (`GET /v1/splitpay/payments?limit&cursor`).
- 🔧 No hay tabla de transfers individuales en BD; solo existen en Stripe. La reconciliación requiere llamar a la API de Stripe.
- 🔧 No hay tabla de reembolsos en BD.
- ❌ Export CSV / XLSX de transacciones por rango de fechas.
- ❌ Reconciliación diaria automática contra el balance de Stripe (diferencias → alerta; REUSE `platform-scheduler`).
- ❌ Ledger contable: asientos dobles por transacción (débito/crédito) para cierre contable.
- ❌ Dashboard de ingresos de plataforma (application fees acumuladas por tenant/periodo).
- ❌ Desglose de fees por tipo: Stripe fee / platform fee / recipient amounts.
- ❌ Audit log de quién creó o modificó reglas de split, qué staff hizo cambios de config.

## 18. Fiscalidad, 1099 y retenciones

- ❌ Generación de 1099-K para merchants (EE.UU.): Stripe Tax puede delegarse, pero el módulo no provee ningún flujo.
- ❌ Modelo 347 / Modelo 190 (España): detección de transacciones que superan umbrales declarables.
- ❌ Retención fiscal en la fuente para merchants no residentes (withholding).
- ❌ Configuración de tax rate por producto / región en Checkout Sessions (Stripe Tax).
- ❌ Reporte de IVA / VAT: separar base imponible de impuesto en cada transacción.
- ❌ Facturación automática a compradores (Stripe Invoicing) desde el flujo de checkout.
- ❌ Validación de NIF/VAT de merchants al crear la cuenta Connect.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **`transfer_group` explícito** en `stripe.paymentIntents.create` — corrige el lookup de transfers en `createRefund`; impacto directo en la integridad de los reversals proporcionales (regla crítica de plataforma). Coste: 2 líneas.
2. **Deduplicación de eventos webhook por `event.id`** — Stripe puede entregar el mismo evento múltiples veces; sin dedup, `createAdditionalTransfers` se ejecuta dos veces para el mismo pago. Coste: tabla `processed_webhook_events(id)` + ON CONFLICT DO NOTHING.
3. **`tenant_id` en tabla `disputes`** — sin este campo las disputas no están aisladas por tenant; consultar disputas de otro tenant es posible con acceso directo a BD. Coste: migración + política RLS.
4. **Evento `splitpay.refund.created` + `splitpay.transfer.failed`** — las apps de origen no saben cuándo hay un reembolso o una transferencia fallida; necesitan reaccionar (marcar pedido, alertar al merchant). REUSE del bus `publish(redis, appId, …)` ya implementado.
5. **Dashboard link (Connect embedded components)** — permite al merchant ver su saldo, payouts y disputas en el propio portal sin redirigir a Stripe Express Dashboard. Altamente demandado en marketplaces.
6. **Listado y export de transacciones** + **reconciliación diaria** via `platform-scheduler` → alerta de diferencias con Stripe balance. Debloquea cierre contable.
7. **Tabla `refunds` en BD** — trazabilidad completa de quién pidió el reembolso, cuándo y por qué, ligada a la transacción y a los reversals individuales.
8. **Idempotencia de Checkout Sessions** + **namespacing de claves por `(tenant_id, key)`** — evita colisiones cross-tenant y duplicados de sesiones.
9. **Tarifa de Stripe configurable por método de pago / región** — eliminar el hardcode de 2.9 % + 30 c que hace incorrecto el cálculo de recipients adicionales en muchos países europeos.
10. **Cancelación / pausa de suscripciones desde el portal** + **Customer Portal** — imprescindible para apps SaaS o de membresía que usen `mode=subscription`.
