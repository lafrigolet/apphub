# Casos de uso — `platform/disputes` (platform-marketplace)

> Dominio: disputas operacionales PRE-chargeback — resolución entre comprador y vendedor antes de que la controversia llegue a un chargeback bancario. Reclamaciones, mediación, recopilación de evidencias, resolución con reembolso automático y, si no hay acuerdo, escalado formal al proceso de chargeback de Stripe.

## Estado actual (implementado)

Apertura de disputa por el comprador referenciando un `order_id`; unicidad por pedido (una disputa activa a la vez); FSM `open → investigating → resolved_buyer | resolved_vendor | escalated_chargeback`; hilo de mensajes con inferencia de rol (`buyer / vendor / staff`); subida de evidencias JSONB; resolución exclusiva de staff con auto-publicación del evento `dispute.refund.requested` (idempotente vía `refund_requested_at`); consumidor de evento `splitpay.chargeback.created` que vincula el `stripe_dispute_id` y eleva el estado; endpoint `submit-to-stripe` para reenviar evidencias al API de Stripe a través de splitpay; job `dispute-sla` en el scheduler (cada 30 min) que estampa `sla_breached_at` y publica `dispute.sla_breached` en los casos `open` sin respuesta de vendor tras 48 h; consumidor `handleSlaBreached` que mueve el estado a `investigating`; RLS por `(app_id, tenant_id)` en las tablas; OpenAPI completo en todos los endpoints.

**Añadido (prioridades 1, 3 y 4-parcial):** vocabulario controlado `reason_code` (enum con CHECK); tabla append-only `dispute_status_history` (actor + from/to + nota, con RLS) registrada en apertura/resolución/retirada y expuesta en `GET /:id`; notas internas de staff (`is_internal`, sólo staff, no publicadas al bus, ocultas a buyer/vendor); guardas FSM (no re-resolver un estado terminal; no mensajes de buyer/vendor sobre disputa cerrada); estado `withdrawn` + `PATCH /:id/withdraw` con evento `dispute.withdrawn`; escopado de visibilidad del lado comprador (listado forzado a sus propias disputas).

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Apertura de disputa por el comprador

- ✅ `POST /v1/disputes` — abre una disputa para un `order_id` dado con `reason` (texto libre hasta 128 chars) y `description` opcional (hasta 4 000 chars).
- ✅ Unicidad por pedido: si ya existe una disputa para el `order_id` → 409 `ConflictError`.
- ✅ `buyer_user_id` se toma del JWT del solicitante — el comprador no puede abrir disputas en nombre de otro.
- ✅ Evento `dispute.opened` publicado en `platform.events` con `disputeId`, `orderId`, `buyerUserId`, `reason`.
- ✅ `reason` (texto libre) ahora acompañado de `reason_code` opcional con vocabulario controlado (`item_not_received`, `item_not_as_described`, `item_damaged`, `wrong_item`, `quantity_mismatch`, `unauthorized_transaction`, `duplicate_charge`, `service_not_rendered`, `other`); validado por enum en la ruta, persistido en columna propia e incluido en `dispute.opened`.
- ❌ Validación de que el `order_id` pertenece realmente al comprador autenticado (hoy confía en el JWT del llamante; no verifica contra `platform/orders`).
- ❌ Ventana temporal para abrir una disputa (por ejemplo, no permitir abrir tras N días de la entrega).
- ❌ Límite de disputas simultáneas por usuario o por tenant.
- ❌ Formulario guiado por tipo de motivo (campos adicionales según `reason`: número de tracking, fecha de recepción, descripción del daño…).

## 2. Tipos y motivos de disputa

- ✅ Enum de motivos estándar (`reason_code`): `item_not_received`, `item_not_as_described`, `item_damaged`, `wrong_item`, `quantity_mismatch`, `unauthorized_transaction`, `duplicate_charge`, `service_not_rendered`, `other` — CHECK en BD + validación zod en la ruta + filtro `reasonCode` en el listado. (El `reason` libre se conserva.)
- ❌ Sub-motivos por categoría (por ej. `damaged` → `packaging_damaged`, `product_defective`).
- ❌ Reglas de elegibilidad por motivo (plazos distintos, documentación requerida distinta).
- ❌ Localización de los textos de motivo para múltiples idiomas.

## 3. FSM — ciclo de vida del estado

- ✅ Estados: `open → investigating → resolved_buyer | resolved_vendor | escalated_chargeback`.
- ✅ Transición `open → investigating` se produce automáticamente cuando el job `dispute-sla` detecta incumplimiento del SLA de 48 h (vía `handleSlaBreached`).
- ✅ Transición a `resolved_*` o `escalated_chargeback` sólo la ejecuta `staff` o `super_admin` (guarda `ForbiddenError` en caso contrario).
- ✅ Evento `dispute.resolved` publicado en toda transición de resolución.
- 🔧 La transición de `open` a `investigating` también debería dispararse cuando el vendor publica su primera respuesta (hoy solo la dispara el SLA job, no el postMessage del vendor).
- ✅ Guardas explícitas de transición: `resolve` rechaza con `ConflictError` si la disputa ya está en estado terminal (`resolved_*` / `escalated_chargeback` / `withdrawn`) — no se sobreescribe un resultado cerrado.
- ✅ Historial de transiciones (`dispute_status_history`) con `from_status`, `to_status`, `actor_user_id`, `actor_role`, `note`, timestamp y RLS por `(app_id, tenant_id)`; se registra en apertura, resolución y retirada; expuesto en `GET /v1/disputes/:id` como `statusHistory`.
- ❌ Reapertura de disputas cerradas por apelación del comprador.
- ✅ Estado `withdrawn` para que el comprador retire voluntariamente la reclamación: `PATCH /v1/disputes/:id/withdraw` (sólo dueño o staff, sólo desde `open`/`investigating`), publica `dispute.withdrawn`.
- ❌ Estado `pending_buyer_info` para solicitar documentación adicional al comprador antes de investigar.

## 4. SLA y plazos

- ✅ Job `dispute-sla` (scheduler, cada 30 min): detecta disputas `open` sin respuesta de vendor transcurridas >48 h, estampa `sla_breached_at` (idempotente), publica `dispute.sla_breached`.
- ✅ Índice parcial `idx_platform_disputes_open_sla` sobre `(created_at) WHERE status='open' AND sla_breached_at IS NULL` para eficiencia del job.
- 🔧 El SLA es fijo (48 h) y global — no configurable por tenant ni por tipo de motivo.
- ❌ SLA de respuesta del staff tras escalado (p. ej. 24 h para que staff tome acción una vez la disputa llega a `investigating`).
- ❌ SLA de resolución total (p. ej. 7 días para cerrar la disputa desde apertura).
- ❌ Notificación al comprador y al vendedor al breachear el SLA (hoy sólo se publica el evento Redis — ningún módulo lo consume para notificar).
- ❌ Cuenta regresiva visible en la UI (cuánto tiempo le queda al vendor para responder).
- ❌ Tabla `dispute_sla_config` por tenant para personalizar plazos (REUSE `platform/tenant-config`).

## 5. Hilo de mensajes y comunicación dentro de la disputa

- ✅ `POST /v1/disputes/:id/messages` — cualquier parte autenticada puede publicar mensajes con `body` (hasta 10 000 chars) y `attachments` (array JSONB libre).
- ✅ Inferencia automática de `sender_role`: `staff`/`super_admin` → `'staff'`; `userId === buyer_user_id` → `'buyer'`; resto → `'vendor'`.
- ✅ Evento `dispute.message` publicado con `senderRole` para que otros módulos puedan reaccionar.
- ✅ `GET /v1/disputes/:id` devuelve mensajes ordenados por `created_at ASC`.
- 🔧 Adjuntos son JSONB libre (sin esquema) — falta integración formal con `platform/storage` (presigned URLs, tipos MIME, tamaño máximo).
- 🔧 Lectura de mensajes restringida del lado comprador: `GET /v1/disputes` fuerza `buyer_user_id = userId` para roles no-staff y `getDispute` oculta las notas internas; falta aún el scoping del vendor por propiedad de la orden (necesita `platform/orders` — ver §12, cross-cutting).
- ❌ Paginación de mensajes (disputas con muchos mensajes devuelven todo de una vez).
- ✅ Mensajes internos de staff: `is_internal` en `dispute_messages`; sólo `staff`/`super_admin` pueden publicarlos (`POST /messages` con `isInternal:true`), no se publican al bus y se ocultan a buyer/vendor en `getDispute`.
- ❌ Notificaciones en tiempo real al interlocutor cuando llega un mensaje nuevo (REUSE `platform/chat` modo support, o `platform/notifications`).
- ❌ Indicador de "leído / no leído" por participante.
- ❌ Plantillas de respuesta (macros) para staff — respuestas frecuentes predefinidas.

## 6. Evidencias

- ✅ `POST /v1/disputes/:id/evidence` — cualquier autenticado puede subir evidencia con `kind` (texto libre, ≤64 chars) y `data` (objeto JSONB arbitrario).
- ✅ `GET /v1/disputes/:id` devuelve array de evidencias con `kind`, `data`, `uploaded_by`, `created_at`.
- 🔧 `kind` es texto libre — sin vocabulario controlado (`tracking_screenshot`, `photo_damage`, `invoice`, `delivery_proof`, `chat_screenshot`, `return_label`…).
- ❌ Integración formal con `platform/storage`: hoy `data` lleva URLs o blobs directamente en JSONB; debería almacenar `storage_key` y generar presigned URL en el GET.
- ❌ Restricción de tipos de fichero y tamaño máximo por evidencia.
- ❌ Visibilidad de evidencias: algunas evidencias del vendor no deberían ser visibles al buyer antes de que staff decida (compartir selectivo).
- ❌ Evidencias del vendedor diferenciadas de las del comprador en la vista de staff.
- ❌ Borrado/reemplazo de evidencias antes de que staff inicie la investigación.
- ❌ Contador de evidencias requeridas por motivo (p. ej. `damaged` requiere al menos una foto).

## 7. Respuesta del vendedor

- ✅ El vendor puede publicar mensajes en el hilo (`sender_role='vendor'`).
- ✅ La existencia de un mensaje del vendor es detectada por el job SLA (`NOT EXISTS ... sender_role='vendor'`) para no flagear disputas que ya tienen respuesta.
- 🔧 No existe endpoint dedicado `POST /v1/disputes/:id/vendor-response` — la respuesta es sólo un mensaje; no hay campo estructurado de aceptación/rechazo de la reclamación.
- ❌ Respuesta estructurada del vendor: `accept` (acepta reembolso), `reject` (rechaza la reclamación), `counter_offer` (propone reembolso parcial) con campo de importe.
- ❌ Notificación al buyer cuando el vendor responde (REUSE `platform/notifications`).
- ❌ Transición automática `open → investigating` cuando el vendor publica su primera respuesta (hoy sólo la dispara el SLA breach).
- ✅ Bloqueo de mensajes de buyer/vendor una vez la disputa está en estado terminal (`resolved_*` / `escalated_chargeback` / `withdrawn`): `postMessage` lanza `ForbiddenError` para no-staff (staff sí puede seguir anotando).

## 8. Mediación por staff de plataforma

- ✅ Staff (`staff` / `super_admin`) puede publicar mensajes en el hilo con `sender_role='staff'`.
- ✅ Sólo staff puede ejecutar `PATCH /v1/disputes/:id/resolve` — la guarda es explícita en el service (`ForbiddenError` para cualquier otro rol).
- ✅ Staff aporta `resolutionAmountCents` y `resolutionNotes` al resolver.
- 🔧 No existe vista de mediación dedicada en el admin portal — sólo la API.
- ❌ Asignación de una disputa a un agente de staff concreto (`assigned_to`).
- ❌ Cola de trabajo de staff: disputas sin asignar, ordenadas por antigüedad / prioridad.
- ❌ SLA de respuesta del agente asignado (cuánto tiempo desde asignación hasta primera acción de staff).
- ❌ Escalado interno entre niveles de staff (L1 → L2 → L3).
- ✅ Notas internas de staff (mensajes con `is_internal=true`, no visibles para buyer/vendor, no publicados al bus).
- ❌ Macros / respuestas predefinidas para agilizar la mediación.

## 9. Resolución — tipos y auto-refund

- ✅ `resolved_buyer` — resolución a favor del comprador; si `resolutionAmountCents > 0` y es la primera vez que se alcanza este estado, se publica `dispute.refund.requested` (idempotente vía `refund_requested_at`).
- ✅ `resolved_vendor` — resolución a favor del vendedor; no se dispara reembolso.
- ✅ `escalated_chargeback` — la disputa se escala al proceso formal bancario; consumidor en splitpay lo gestiona.
- ✅ Idempotencia del auto-refund: `refund_requested_at` se estampa con `COALESCE(refund_requested_at, now())` — re-llamadas no generan doble reembolso.
- ✅ El evento `dispute.refund.requested` incluye `amountCents`, `orderId`, `stripeDisputeId` para que splitpay ejecute el refund vía Stripe Connect.
- 🔧 No existe reembolso parcial estructurado como tipo propio — se maneja con `resolutionAmountCents` libre, sin validar que no supere el importe del pedido.
- ❌ Validación de que `resolutionAmountCents` no supera el importe original del pedido (necesita cruzar con `platform/orders`).
- ❌ Reenvío de artículo como opción de resolución (sin reembolso monetario).
- ❌ Crédito en cuenta (store credit) como alternativa al reembolso en efectivo.
- ❌ Reembolso parcial proporcional cuando el pedido tiene múltiples líneas (REUSE lógica de splitpay para repartir el importe entre transferencias Connect).
- ❌ Notificación al buyer del resultado de la resolución (REUSE `platform/notifications`).

## 10. Integración con Stripe Disputes (chargeback bancario)

- ✅ Consumidor de evento `splitpay.chargeback.created`: cuando splitpay recibe un webhook de Stripe con un chargeback para un `orderId` conocido, eleva la disputa interna a `escalated_chargeback` y persiste `stripe_dispute_id`.
- ✅ `POST /v1/disputes/:id/submit-to-stripe` — envía las evidencias internas a Stripe vía evento `dispute.evidence.submit` (requiere `stripe_dispute_id`; protegido a staff); estampa `evidence_submitted_at` para no reenviar.
- ✅ Índice `idx_platform_disputes_stripe_id` sobre `stripe_dispute_id` para lookup rápido.
- 🔧 El vínculo chargeback → disputa interna depende de que exista un `orderId` coincidente en el payload; si el chargeback llega antes de que el buyer abra una disputa interna, no se crea ninguna automáticamente.
- ❌ Creación automática de disputa interna cuando llega un chargeback en Stripe sin disputa previa (flujo inverso: Stripe → apertura automática).
- ❌ Sincronización del estado del chargeback de Stripe de vuelta a la disputa interna (p. ej. cuando Stripe resuelve el chargeback a favor del merchant, cerrar la disputa interna).
- ❌ Webhooks `charge.dispute.updated` / `charge.dispute.closed` para mantener `stripe_dispute_id` en sync con el estado de Stripe.
- ❌ Visualización del estado del chargeback en Stripe desde el admin de disputas.

## 11. Protección al comprador

- ✅ El comprador puede abrir una disputa, publicar mensajes y subir evidencias sin restricción de rol.
- ✅ La resolución en favor del comprador desencadena automáticamente el reembolso vía splitpay.
- 🔧 Sin ventana temporal de apertura definida — el comprador puede abrir una disputa en cualquier momento posterior al pedido.
- ❌ Política de protección configurable por tenant: `buyer_protection_days` (plazo máximo para abrir disputa), `max_refund_pct` (tope del reembolso permitido sin mediación manual).
- ❌ Notificación proactiva al comprador explicando sus derechos al abrir la disputa.
- ❌ Escalado exprés a staff cuando la razón es `unauthorized_transaction` (mayor prioridad, SLA reducido).
- ❌ Historial de disputas del comprador visible desde su perfil de usuario.

## 12. Protección al vendedor

- ✅ El vendor puede responder en el hilo y aportar evidencias.
- ✅ `resolved_vendor` cierra la disputa a su favor sin acción financiera.
- ❌ Notificación al vendor cuando se abre una disputa sobre uno de sus pedidos (REUSE `platform/notifications`).
- ❌ Plazo explícito para que el vendor responda antes de que se presuma la culpabilidad.
- ❌ Panel del vendor con disputas activas sobre sus pedidos (hoy el listado solo está disponible para el tenant completo, sin filtrado por vendedor).
- ❌ Política de "friendly fraud" — posibilidad de vendor de marcar una disputa como fraudulenta y escalar directamente.
- ❌ Historial de disputas ganadas/perdidas como parte del perfil del vendedor.

## 13. Impacto en reputación del vendedor

- ❌ Métricas de disputa por vendedor: tasa de disputas (disputes / orders), tasa de disputas ganadas, tiempo medio de respuesta.
- ❌ Integración con `platform/reviews`: una disputa resuelta a favor del comprador podría marcar la reseña del pedido como "compra verificada con incidencia" o bloquear la reseña positiva automática.
- ❌ Umbral de disputa configurable por tenant a partir del cual el vendor recibe una alerta o se suspende temporalmente (REUSE `platform/notifications` + `platform/tenant-config`).
- ❌ Score de fiabilidad del vendor considerando historial de disputas (input para `platform/reviews`).
- ❌ Dashboard de salud del vendedor visible para staff con tasa de disputas en el tiempo.

## 14. Apelaciones

- ❌ El comprador o el vendedor pueden apelar una resolución ya cerrada (`resolved_buyer` / `resolved_vendor`).
- ❌ Estado `appeal_pending` con plazo máximo para que staff revise la apelación.
- ❌ Sólo staff puede revocar o modificar una resolución apelada.
- ❌ Límite de apelaciones por disputa (p. ej. una única apelación permitida).
- ❌ Motivo obligatorio para la apelación (`appeal_reason`).
- ❌ Notificación a la parte contraria cuando se presenta una apelación.

## 15. Automatización de resoluciones

- ✅ Auto-escalado `open → investigating` vía SLA job (sin intervención humana).
- ✅ Auto-refund al resolver `resolved_buyer` con importe > 0 (idempotente, sin acción manual adicional).
- ❌ Resolución automática a favor del comprador cuando el vendedor no responde dentro del plazo SLA (hoy sólo mueve a `investigating`; no resuelve automáticamente).
- ❌ Reglas de resolución automática configurables por tenant (p. ej. "si motivo es `not_received` y el tracking confirma no entrega → auto `resolved_buyer` con reembolso total").
- ❌ Machine learning / scoring de riesgo de disputa para clasificar la urgencia y probabilidad de fraude.
- ❌ Integración con tracking externo (correos, transportistas) para validar automáticamente `not_received`.

## 16. Eventos publicados (bus Redis `platform.events`)

- ✅ `dispute.opened` — al abrir la disputa.
- ✅ `dispute.message` — al publicar un mensaje en el hilo.
- ✅ `dispute.resolved` — al resolver (cualquier tipo de resolución).
- ✅ `dispute.refund.requested` — cuando la resolución es `resolved_buyer` con importe > 0 (primera vez).
- ✅ `dispute.evidence.submit` — cuando staff envía evidencias a Stripe.
- ✅ Consumidor: `splitpay.chargeback.created` → vincula `stripe_dispute_id` y eleva a `escalated_chargeback`.
- ✅ Consumidor: `dispute.sla_breached` (producido por scheduler) → mueve `open → investigating`.
- ❌ `dispute.sla_breached` no es consumido por `platform/notifications` para alertar a comprador, vendor y staff.
- ❌ `dispute.vendor_notified` — confirmación de que el vendor fue notificado de la apertura.
- ✅ `dispute.withdrawn` — el comprador retira la disputa.
- ❌ `dispute.appeal.opened` / `dispute.appeal.resolved` para el flujo de apelaciones.

## 17. Audit y trazabilidad

- ✅ `resolved_by_user_id` y `resolved_at` se persisten en cada resolución.
- ✅ `uploaded_by` en evidencias referencia al usuario que las subió.
- ✅ `sla_breached_at` estampado por el job (no borrable) registra el momento del incumplimiento.
- ✅ `refund_requested_at` y `evidence_submitted_at` como marcas temporales de acciones críticas.
- ✅ Tabla `dispute_status_history` (append-only): registra `from_status`/`to_status`/`actor_user_id`/`actor_role`/`note`/`created_at` en apertura, resolución y retirada. RLS por `(app_id, tenant_id)`.
- ❌ Audit log inmutable de todas las acciones (quién abrió, quién resolvió, quién subió evidencia, quién llamó a `submit-to-stripe`) con `actor_id`, `action`, `before`/`after`, timestamp.
- ❌ Soft-delete: las disputas no se borran (correcto), pero tampoco hay campo `deleted_at` para el caso de purga GDPR controlada.

## 18. GDPR / privacidad / multi-tenant

- ✅ RLS (`platform_disputes_isolation`, `platform_disputes_messages_isolation`, `platform_disputes_evidence_isolation`) en las tres tablas — `(app_id, tenant_id)` siempre requeridos.
- ✅ Aislamiento multi-app garantizado: un token de `aikikan` nunca lee disputas de `split-pay`.
- ✅ `sub_tenant_id` transportado en contexto y pasado a `withTenantTransaction` (nullable — compatible con tenencias de un nivel).
- ❌ Derecho al olvido (GDPR art. 17): no existe endpoint de borrado ni anonimización de PII (`buyer_user_id`, `description`, mensajes, datos de evidencias con fotos personales).
- ❌ Retención automática: purga de disputas cerradas con más de N años (REUSE `platform/scheduler` — nuevo job `dispute-retention-purge`).
- ❌ Exportación de datos de una disputa en formato legible por el usuario (portabilidad GDPR art. 20).
- ❌ Registro de tratamiento: base legal para conservar evidencias (¿cuánto tiempo? ¿por qué?).
- ❌ Enmascarado de datos sensibles en logs (el `description` y `body` de mensajes pueden contener PII).

## 19. Reporting y métricas

- ❌ Tasa de disputas por tenant / app / periodo (disputes / total_orders).
- ❌ Distribución de disputas por motivo (`reason`), por estado final y por tiempo de resolución.
- ❌ Tiempo medio de resolución (apertura → cierre) y tasa de resolución a favor del comprador vs. del vendedor.
- ❌ Importe total reembolsado por periodo.
- ❌ Número de disputas escaladas a chargeback bancario.
- ❌ Efectividad del SLA: % de disputas que breachers las 48 h; % que el vendor responde en plazo.
- ❌ Dashboard de staff en el admin portal con las métricas anteriores y alertas (REUSE `apps/portal`).
- ❌ Export CSV / webhook de datos de disputas para reporting externo.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ✅ ~~**Vocabulario controlado de `reason`** (enum estándar)~~ (migración `0004` con CHECK en `reason_code`, validación zod en rutas, filtro de listado e inclusión en `dispute.opened`).
2. **Notificaciones a comprador y vendor** al abrir, al recibir mensaje y al resolver — REUSE directo de `platform/notifications` consumiendo los eventos ya publicados; máximo valor percibido con código mínimo.
3. ✅ ~~**Historial de estados (`dispute_status_history`)** + notas internas de staff~~ (tabla con RLS + registro en apertura/resolución/retirada; `is_internal` en mensajes con guarda de rol y ocultación a buyer/vendor; además guardas FSM de transición terminal y estado `withdrawn`).
4. 🔧 ~~**Restricción de visibilidad**~~ — lado comprador hecho (listado y notas internas escopados a no-staff); pendiente el scoping del vendor por propiedad de la orden (requiere `platform/orders`).
5. **Resolución automática al vencer el SLA sin respuesta de vendor** (`open → resolved_buyer`) — completa el flujo automático que ya está casi terminado (el SLA job ya estampa el breach).
6. **Validación de `resolutionAmountCents` vs. importe del pedido** (HTTP call a `platform/orders`) — previene errores operativos costosos.
7. **GDPR**: anonimización / borrado de PII en disputas cerradas + job de retención (REUSE scheduler) — obligatorio para operación en España/UE.
8. **Dashboard de reporting** de tasa de disputas, tiempo de resolución, importe reembolsado — desbloquea la gestión basada en datos del tenant y del staff.
9. **Apelaciones** — valor significativo para confianza de la plataforma; requiere nuevo estado `appeal_pending` y lógica moderada.
10. **Integración bidireccional con Stripe Disputes** (webhooks `charge.dispute.updated/closed`) — cierra el ciclo de trazabilidad con el proceso bancario real.
