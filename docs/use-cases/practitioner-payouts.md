# Casos de uso — `platform/practitioner-payouts` (platform-appointments)

> Dominio: liquidaciones a profesionales — reglas de comisión por servicio o practitioner, devengo (accrual) automático al completar/cancelar citas (REUSE `platform/bookings`), cierre periódico de liquidaciones, marcado de pago efectivo, generación de extracto PDF y relación con el scheduler (`payout.period_due`).

## Estado actual (implementado)

Tres tablas con RLS por `(app_id, tenant_id)`: `commission_rules` (regla % + fee fija, con vigencia temporal y resolución most-specific); `accruals` (devengo por cita completada: gross + commission, estados `accrued/paid/reversed`); `payouts` (liquidación de periodo: suma de commissions, estados `pending/paid/cancelled`). Tabla `payout_schedules` (frecuencia `weekly/biweekly/monthly`, `next_run_at`, `anchor_day`). Consumidor Redis de `booking.completed/cancelled/no_show` y `payout.period_due`. Rutas REST: CRUD de reglas, CRUD de accruals, `POST /payouts/close`, `POST /payouts/:id/pay`, `GET /payouts`, `GET /payouts/:id`, `GET /payouts/:id/pdf`. Eventos publicados: `payout.created`, `payout.paid`. Función pura `computeCommission({ grossCents, ratePct, flatFeeCents })` testeada exhaustivamente. División equitativa del bruto entre múltiples practitioners de una cita (remainder sobre el primero). Reversión de accrual cuando la cita se cancela o es no-show. Cierre idempotente (segundo cierre del mismo periodo → `409 no accruals`). Extracto PDF textual con cabecera de periodo + líneas de devengo.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Reglas de comisión — configuración

- ✅ Regla `(practitioner_id, service_id?)` con `rate_pct` (0–100 %) y `flat_fee_cents` (fee fija adicional).
- ✅ Vigencia temporal: `effective_from` / `effective_until` — permite programar cambios de tarifa sin borrar la histórica.
- ✅ Resolución most-specific: prefiere la regla `(practitioner, service)` sobre la wildcard `(practitioner, NULL)`.
- ✅ Metadata JSONB libre (`notes`, `etiqueta contrato`, etc.).
- 🔧 Sin validación de solapamiento de rangos de vigencia para la misma combinación `(practitioner, service)` — puede haber ambigüedad si existen dos reglas activas simultáneamente.
- ❌ Regla global por tenant (sin `practitioner_id`) — para fijar el % por defecto de todos los practitioners del tenant.
- ❌ Regla escalonada / por tramos de facturación (commission tiers): % diferente según el gross acumulado en el periodo supera un umbral (ej. 30 % hasta 5.000 €, 25 % a partir de 5.001 €).
- ❌ Modelo de chair-rental / alquiler de sillón (comisión inversa): el profesional paga una cuota fija o % al centro, en lugar de recibirla.
- ❌ Regla por categoría de servicio (no por `service_id` exacto): para aplicar el mismo % a toda la categoría de servicios sin crear una regla por cada uno.
- ❌ Comisiones sobre venta de productos POS (REUSE `platform/pos`) — hoy solo se consume `booking.completed`; no hay accrual desde tickets de POS.
- ❌ Comisiones sobre venta de paquetes / bundles (REUSE `platform/packages`) — al activar/canjear una sesión de paquete no se genera accrual.
- ❌ Activación / desactivación de regla sin borrarla (campo `is_active`).
- ❌ Copia (duplicate) de regla para modificar rápidamente.

## 2. Devengo (accrual) automático desde bookings

- ✅ Consumidor de `booking.completed` → devengo automático buscando la regla aplicable y calculando `computeCommission`.
- ✅ División equitativa del bruto entre múltiples practitioners asignados a la cita (remainder en el primero).
- ✅ Skip si no hay regla aplicable para el practitioner — sin accrual, sin error.
- ✅ Skip si la cita no tiene `price_cents` (cita gratuita o precio no informado).
- ✅ Reversión de accrual (`status → reversed`) al recibir `booking.cancelled` o `booking.no_show` si el accrual estaba en estado `accrued`.
- 🔧 La reversión no se aplica si el accrual ya fue marcado `paid` (acertado funcionalmente, pero no hay alerta/log diferenciado para detectar el caso de "booking cancelada después de cierre").
- 🔧 División de gross entre practitioners solo por partes iguales — sin soporte de splits proporcionales configurados por el tenant (ej. 60/40 entre titular y asistente).
- ❌ Devengo desde `platform/pos` — ticket de POS no genera accrual de practitioner (caso peluquería, clínica con cajero aparte).
- ❌ Devengo desde `platform/packages` — canje de sesión de bono/paquete no genera accrual (aunque sí se realizó el cobro al comprar el paquete).
- ❌ Devengo desde ventas de producto asociadas a la cita (upsell de productos durante la visita).
- ❌ Accrual manual desde la interfaz de admin (hoy existe el endpoint `POST /accruals` pero sin guardia de rol).
- ❌ Accrual de tipo "bonus" o "deducción" (ajuste manual sin booking_id) — necesario para correcciones extraordinarias.
- ❌ Soporte de `sub_tenant_id` en la búsqueda de regla (multilocal: misma franquicia, diferentes centros con % distintos).

## 3. Cálculo de comisión

- ✅ Función pura `computeCommission({ grossCents, ratePct, flatFeeCents })` — `%` sobre bruto + fee fija acumulada, redondeo a céntimo entero (Math.round), resultado nunca negativo.
- ✅ Modelos soportados actualmente: puro variable (solo `rate_pct`), puro fijo (solo `flat_fee_cents`, `rate_pct=0`), mixto (% + flat fee).
- 🔧 No contempla retenciones IRPF dentro del cálculo — el módulo delega eso al cierre de periodo, pero `closePeriod` tampoco las aplica todavía.
- ❌ Tramos de comisión progresivos (tier-based): aplicar % creciente o decreciente según el gross acumulado supere umbrales configurables.
- ❌ Comisión mínima garantizada (floor) y máxima (cap) por cita o por periodo.
- ❌ Modelo de comisión negativa / chair-rental: el resultado puede ser negativo (el practitioner debe pagar al tenant), hoy bloqueado por `Math.max(0, …)`.
- ❌ Redondeo configurable por tenant (ej. siempre hacia arriba / hacia abajo / bancario).

## 4. Cierre de periodo (liquidación)

- ✅ `POST /v1/practitioner-payouts/payouts/close` — agrupa todos los accruals `accrued` del practitioner en `[periodStart, periodEnd)`, suma `commission_cents`, crea el payout y transiciona los accruals a `paid` (attached al payout).
- ✅ Idempotente: segundo cierre del mismo periodo → `409 no accruals in period` (los accruals ya están `paid`).
- ✅ Publicación de `payout.created` con `totalCommissionCents`.
- ✅ Cierre disparado por el scheduler vía evento `payout.period_due` (`handleScheduledPayout`).
- ✅ Resiliencia: error de un cierre no bloquea los siguientes (exception swallowed con log `warn`).
- ✅ `409 no accruals` del scheduler se loguea como `info`, no como `warn` (comportamiento esperado en practitioners inactivos).
- 🔧 No se aplica retención IRPF en el cierre — `total_commission_cents` es bruto; no se genera `net_commission_cents` ni `withholding_cents`.
- 🔧 El campo `notes` existe en el payout pero no se rellena automáticamente (podría incluir resumen de accruals, periodo, etc.).
- ❌ Cierre parcial o selectivo (elegir qué accruals incluir en la liquidación, excluyendo algunos).
- ❌ Ajustes manuales de cierre: añadir bonus, deducciones o anticipos a un payout antes de cerrar o reabrirlo.
- ❌ Anticipo (advance payout): pago parcial a cuenta antes de cerrar el periodo completo.
- ❌ Reabrir un payout `pending` para añadir/quitar accruals (corrección post-cierre).
- ❌ Vista previa del cierre (dry-run): calcular qué resultaría del cierre sin crearlo (útil para validación por admin antes de aprobar).
- ❌ Aprobación en dos pasos: cierre genera payout en `draft`; staff aprueba antes de pasar a `pending/paid`.

## 5. Programación automática de liquidaciones (schedules)

- ✅ Tabla `payout_schedules` con `period` (`weekly/biweekly/monthly`), `anchor_day` (día de semana o día del mes), `next_run_at`, `last_closed_at`, `is_active`.
- ✅ Índice parcial en `next_run_at WHERE is_active = TRUE` — el scheduler puede hacer un scan eficiente de schedules vencidos.
- ✅ El scheduler (`platform-scheduler`, job `practitioner-payout-close`, cron `0 2 * * *`) publica `payout.period_due` y el módulo lo consume.
- 🔧 No existe endpoint REST para CRUD de schedules — el admin no puede crear/editar/pausar un schedule desde la API; requiere acceso directo a la BD.
- ❌ Creación/edición de schedules desde la consola de administración del tenant.
- ❌ Pausa/reanudación de un schedule individual (`is_active` existe en BD pero sin endpoint).
- ❌ Notificación al practitioner cuando se genera la liquidación (REUSE `platform/notifications`).
- ❌ Previsualización de próxima fecha de cierre calculada desde `anchor_day` + `period`.
- ❌ Schedule ad-hoc (cierre extraordinario fuera del calendario).
- ❌ Cierre automático diferente por practitioner (ej. algunos mensuales, otros semanales) gestionado desde UI.

## 6. Pago efectivo de la liquidación

- ✅ `POST /v1/practitioner-payouts/payouts/:id/pay` — transiciona a `paid`, registra `paid_at` y `external_ref`, publica `payout.paid`.
- ✅ `external_ref` libre: puede almacenar una referencia Stripe, SEPA, transferencia bancaria, etc.
- 🔧 No hay verificación de que el payout esté en estado `pending` antes de marcarlo `paid` — puede aplicarse a un payout ya `cancelled`.
- ❌ Pago automático vía Stripe Connect Transfer a la cuenta del practitioner (REUSE `platform/splitpay`) — hoy el pago es externo y solo se registra la referencia.
- ❌ Pago vía SEPA Credit Transfer (Stripe o Adyen) con validación de IBAN del profesional.
- ❌ Generación de orden de transferencia bancaria (PAIN.001 XML) para pago masivo por lotes.
- ❌ Cancelación explícita de un payout (`status → cancelled`) con motivo.
- ❌ Historial de intentos de pago (reintentos tras fallo de transferencia Stripe).
- ❌ Reconciliación automática: detectar si el payout ya fue pagado fuera del sistema y marcar sin duplicar.

## 7. Retenciones fiscales (IRPF — España)

- ❌ Aplicación automática de retención IRPF (15 % general autónomos, 7 % primer año) sobre el `total_commission_cents` en el cierre de periodo.
- ❌ Tabla de tipos de retención configurables por tenant (o por practitioner: algunos pueden tener tipo reducido acreditado).
- ❌ Campos `gross_commission_cents`, `withholding_pct`, `withholding_cents`, `net_commission_cents` en el payout.
- ❌ Declaración modelo 190 (anual) / modelo 111 (trimestral) — exportación de devengos con retención por NIF de profesional para AEAT.
- ❌ Certificado de retenciones anual por profesional (documento PDF/CSV para el IRPF del practitioner).
- ❌ Validación de NIF/NIE del practitioner antes de calcular retenciones.
- ❌ Soporte de retenciones en otros países (p. ej. WHT en UK, Steuerabzug en DE).

## 8. Ajustes manuales (bonus, deducciones, anticipos)

- ❌ Accrual de tipo `adjustment` (sin `booking_id`): para registrar bonus extraordinarios, penalizaciones, correcciones de facturación.
- ❌ Campo `type` en `accruals` distinguiendo `booking_commission / adjustment / advance / reversal`.
- ❌ Anticipo (`advance`): accrual negativo que reduce la liquidación del próximo periodo.
- ❌ Deducción de gastos del practitioner (material, alquiler de cabina) registrada como accrual negativo antes del cierre.
- ❌ Nota obligatoria (`reason`) para ajustes manuales — auditoría.
- ❌ Aprobación doble (maker/checker) para ajustes superiores a un umbral configurable.

## 9. Generación de extracto / documento de liquidación

- ✅ `GET /v1/practitioner-payouts/payouts/:id/pdf` — extracto PDF textual con cabecera de periodo, `external_ref`, `gross_amount_cents`, `net_amount_cents` y líneas de devengo (fecha, booking_id abreviado, importe, estado).
- 🔧 `gross_amount_cents` y `net_amount_cents` se referencian en el PDF pero no existen como columnas reales en la tabla `payouts` (solo `total_commission_cents`) — en los tests pasan como campos del mock pero en producción serían `null`.
- 🔧 El extracto muestra el UUID del practitioner en lugar del nombre — sin join a `platform_resources`.
- 🔧 El booking_id se muestra abreviado (8 primeros caracteres) — útil para depuración pero no para el profesional.
- ❌ Extracto en formato HTML / Excel (XLSX) además de PDF.
- ❌ Nombre y datos del profesional (nombre, NIF, IBAN) en la cabecera del PDF.
- ❌ Desglose de retenciones IRPF en el extracto (bruto, retención, neto).
- ❌ Firma digital del documento (PDF firmado, PKCS#7) — requerido para algunos workflows de compliance.
- ❌ Envío automático del extracto por email al practitioner al cerrar el periodo (REUSE `platform/notifications`).
- ❌ Almacenamiento del PDF generado en S3/MinIO (REUSE `platform/storage`) con URL de descarga persistente.
- ❌ Extracto consolidado multi-periodo (resumen anual o de varios meses).

## 10. Reversión / clawback

- ✅ Reversión de accrual por `booking.cancelled` / `booking.no_show` si el accrual estaba `accrued` — transiciona a `reversed`.
- 🔧 Sin reversión si el accrual ya fue `paid` (incluido en un payout cerrado) — no hay clawback automático ni alerta.
- ❌ Clawback: cuando se cancela una cita cuyo accrual ya fue liquidado (`paid`), crear un accrual negativo (`adjustment`) que se descuenta de la siguiente liquidación.
- ❌ Notificación al admin cuando ocurre una reversión post-liquidación (accrual ya `paid` no puede revertirse).
- ❌ Configuración por tenant de si las cancelaciones tardías (fuera del plazo de cancelación) aplican clawback o no.
- ❌ Reversión parcial: si la cita fue parcialmente reembolsada, el clawback es proporcional al reembolso.
- ❌ Registro de motivo de reversión (campo `reversal_reason`).

## 11. Múltiples esquemas de comisión por profesional

- ✅ Un practitioner puede tener múltiples reglas con diferentes `service_id` y rangos de vigencia.
- ✅ La regla más específica `(practitioner, service)` tiene precedencia sobre la wildcard `(practitioner, NULL)`.
- 🔧 No hay combinación de reglas concurrentes (ej. una regla base global + otra específica por servicio que se suma) — el sistema selecciona exactamente una regla.
- ❌ Regla diferente por `sub_tenant_id` (el profesional trabaja en varios centros del mismo tenant con % distintos).
- ❌ Regla efectiva por tipo de modalidad (presencial vs telehealth vs domicilio).
- ❌ Comisión diferente para citas de primera vez vs citas de revisión (campo `appointment_type`).
- ❌ Regla con `max_accruals_per_period` — cap de devengos por periodo para modelos con sueldo fijo + variable limitado.
- ❌ Herencia de regla desde el grupo al que pertenece el practitioner (ej. todos los fisioterapeutas tienen el mismo %).

## 12. Objetivos e incentivos

- ❌ Definición de objetivos (targets) por practitioner/periodo: número de citas, gross generado, nuevos clientes.
- ❌ Bonus automático al superar el objetivo (accrual adicional generado por el scheduler).
- ❌ Progreso en tiempo real hacia el objetivo (dashboard del practitioner).
- ❌ Comisión escalonada ligada al cumplimiento del objetivo (tier que sube al alcanzar target).
- ❌ Notificación cuando el practitioner alcanza el 80 % / 100 % del objetivo del periodo.

## 13. Historial y trazabilidad

- ✅ `accruals` mantiene `booking_id`, `service_id`, `occurred_at` — rastreable a nivel de cita.
- ✅ `payouts` mantiene `period_start`, `period_end`, `paid_at`, `external_ref`.
- 🔧 Sin tabla de historial de cambios de estado de los payouts (`payout_status_history`) — no es auditable quién/cuándo cambió el estado.
- ❌ Audit log de quién creó/modificó reglas de comisión (campo `created_by` / tabla `commission_rule_history`).
- ❌ Log de quién inició el cierre de periodo (manual vs scheduler).
- ❌ Soft-delete de accruals y reglas (hoy solo `reversed`; no hay borrado lógico genérico).
- ❌ Snapshot del importe bruto de la cita en el momento del devengo — si el precio de la cita cambiara retroactivamente, el accrual quedaría inconsistente.

## 14. Multi-tenant y aislamiento

- ✅ RLS por `(app_id, tenant_id)` en las cuatro tablas — aislamiento fuerte entre tenants.
- ✅ El scheduler usa el role `svc_platform_scheduler` con `BYPASSRLS` y GRANTs mínimos sobre `payout_schedules`.
- ✅ El módulo accede a `platform_bookings` y `platform_resources` con GRANTs de solo lectura (SELECT) sobre esos schemas.
- 🔧 El acceso cross-schema a `platform_bookings.booking_resources` y `platform_resources.resources` se hace mediante SQL directo dentro de `handleEvent` — técnicamente violación del contrato de módulos (se cruzan schemas sin pasar por HTTP); aceptado explícitamente en el comentario de migración.
- ❌ `sub_tenant_id` ignorado en la resolución de reglas y en el contexto de accruals — el modelo de dos niveles de tenancy (multi-local) no está cubierto.
- ❌ Eventos Redis filtrados por `app_id` + `tenant_id` antes de procesar — hoy se procesan todos los eventos del canal `platform.events` y se filtran en código.

## 15. Eventos publicados y consumidos

- ✅ Consumidor: `booking.completed` → accrual automático.
- ✅ Consumidor: `booking.cancelled` / `booking.no_show` → reversión de accrual.
- ✅ Consumidor: `payout.period_due` (desde scheduler) → cierre automático.
- ✅ Publicador: `payout.created` (payload: `appId, tenantId, payoutId, practitionerId, totalCommissionCents`).
- ✅ Publicador: `payout.paid` (payload: `appId, tenantId, payoutId, externalRef`).
- ❌ Evento `payout.cancelled` — no se emite cuando un payout pasa a `cancelled`.
- ❌ Evento `accrual.reversed` — no se emite al revertir un accrual (útil para notificaciones al profesional).
- ❌ Evento `payout.statement_ready` — para triggear el envío del extracto PDF al profesional.
- ❌ Consumidor de `pos.ticket.closed` — para accrual desde ventas de caja (POS).
- ❌ Consumidor de `package.session.redeemed` — para accrual desde canje de sesiones de bono.

## 16. Exportación contable

- ❌ Exportación CSV/XLSX de accruals por periodo y practitioner (para contabilidad externa).
- ❌ Exportación de payouts en formato contable (diario de pagos) compatible con software de contabilidad (Sage, Holded, Contaplus).
- ❌ Integración con modelo 190 / 111 AEAT para declaración de retenciones practicadas (complementa a `platform/verifactu`).
- ❌ Exportación de asientos contables (cuenta de gasto, cuenta de proveedor, cuenta de retención) por payout.
- ❌ Conciliación bancaria: marcar payouts como conciliados con un movimiento bancario importado.

## 17. Interfaz de administración

- ✅ API REST completa para listas, detalle, cierre y marcado de pago (usable desde cualquier frontend).
- 🔧 Sin guardia de rol explícita en las rutas — `ctxFromRequest` extrae el role del JWT pero las rutas no verifican `requireRole('super_admin', 'staff')`. Cualquier usuario autenticado con token válido puede llamar a los endpoints.
- ❌ Vista de consola de administración (`apps/*/portal`) con tabla de liquidaciones por practitioner, filtros por periodo/estado, botón de cierre y descarga de PDF.
- ❌ Vista del practitioner (portal propio): historial de devengos y liquidaciones propias, descarga de extracto.
- ❌ Búsqueda y filtrado por rango de fechas en la lista de payouts (hoy solo filtra por `practitionerId` y `status`).
- ❌ Dashboard de resumen: total devengado en el periodo, practitioners pendientes de liquidar, próximas fechas de cierre.
- ❌ Acciones masivas: cerrar el periodo para todos los practitioners activos del tenant en un solo click.

## 18. Datos y modelo

- ✅ `commission_rules`: `(app_id, tenant_id, practitioner_id, service_id?, rate_pct, flat_fee_cents, effective_from, effective_until, metadata)`.
- ✅ `accruals`: `(app_id, tenant_id, practitioner_id, service_id?, booking_id?, gross_cents, commission_cents, status, payout_id?, occurred_at, metadata)`.
- ✅ `payouts`: `(app_id, tenant_id, practitioner_id, period_start, period_end, total_commission_cents, currency, status, paid_at, external_ref, notes)`.
- ✅ `payout_schedules`: `(app_id, tenant_id, practitioner_id, period, anchor_day, next_run_at, last_closed_at, is_active, metadata)`.
- 🔧 `payouts` no tiene `gross_amount_cents` ni `net_amount_cents` como columnas reales — el PDF los referencia pero serán `null` en producción.
- 🔧 `accruals.status` incluye `paid` (que realmente significa "incluido en payout") pero el accrual no sabe si el payout fue finalmente pagado — estado `detached` sería útil si se reabre un payout.
- ❌ `accruals.type` (`booking_commission / adjustment / bonus / deduction / advance / reversal`) — hoy todos los accruals son del mismo tipo implícito.
- ❌ `commission_rules.is_active` — no existe; la desactivación requiere `effective_until = now()`.
- ❌ `payouts.approved_at` / `payouts.approved_by` — sin flujo de aprobación.
- ❌ `payouts.withholding_pct` / `payouts.withholding_cents` / `payouts.net_commission_cents` — sin soporte de retenciones en el modelo.
- ❌ `practitioners` tabla propia en este schema — el módulo depende de `platform_resources.resources` para la identidad del profesional, sin cache local ni datos de contacto (nombre, NIF, IBAN).
- ❌ Índice en `accruals(payout_id)` — actualmente sin índice, el join `payout → accruals` podría ser lento con volumen.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Guardia de rol en rutas** — añadir `requireRole('super_admin', 'staff')` a todos los endpoints de gestión; riesgo de seguridad inmediato.
2. **`net_amount_cents` + `withholding_cents` en el payout** — columnas que faltan y que el PDF ya referencia; desbloquea el extracto con retención IRPF (alta demanda en mercado español).
3. **Retención IRPF en `closePeriod`** — leer `withholding_pct` configurable por practitioner/tenant y aplicarla al cerrar; REUSE `platform/tenant-config` para el tipo por defecto.
4. **Endpoints CRUD de `payout_schedules`** — la tabla ya existe pero sin API; sin ella el tenant no puede autogestionar la frecuencia de liquidación.
5. **Clawback automático** — cuando se revierte un accrual ya `paid`, generar accrual negativo para descontarlo de la siguiente liquidación; cierra el ciclo de cancelaciones tardías.
6. **Accrual desde POS (`pos.ticket.closed`)** — REUSE `platform/pos` para dar soporte al modelo de peluquería/clínica con caja propia.
7. **Envío automático del extracto PDF al professional** — REUSE `platform/notifications` (`payout.statement_ready`); coste bajo, alto impacto en UX del profesional.
8. **Ajustes manuales (bonus/deducciones)** — campo `type` en `accruals` + endpoint admin con `requireRole`; permite correcciones sin tocar la BD directamente.
9. **Aprobación en dos pasos (draft → pending → paid)** — introduce estado `draft` + campos `approved_at/approved_by`; necesario para entornos regulados o pagos de alto importe.
10. **Exportación contable CSV + modelo 190** — complementa `platform/verifactu` para liquidaciones trimestrales de retenciones IRPF; reducción de carga manual del departamento de administración.
