# Casos de uso — `platform/packages` (platform-appointments)

> Dominio: bonos prepago de sesiones — el cliente compra un bono de N sesiones para un servicio concreto y lo va consumiendo en sus citas. Incluye saldo, caducidad, compartición familiar, transferencia/regalo, renovación y ciclo de vida completo.

## Estado actual (implementado)

Plantillas de bono (`package_templates`) con código único por tenant, asociadas a un `service_id` de `platform/services`, precio en céntimos y validez en días; compra (`purchased_packages`) con saldo atómico (`remaining_sessions`), RLS por `(app_id, tenant_id)`, historial de movimientos en `redemptions` (`redeem/refund/adjust`); redención manual (`POST /v1/packages/redeem`) y automática vía eventos `booking.completed/cancelled/no_show` de `platform/bookings`; devolución de sesión (`POST /v1/packages/refund`); compartición familiar (`package_authorized_users`); transferencia y regalo a otro usuario (`package_transfers` + cambio de `client_user_id`); toggle de renovación automática y renovación manual (`renewPackage`); jobs del scheduler: `package-expiry-warning` (T-30d/T-7d, idempotente) y `package-expiry-transition` (active → expired); idempotencia de redención (índice único sobre `booking_id`); `redeemer_user_id` en `redemptions`; ajuste manual de saldo staff (`reason='adjust'`); congelación/extensión de validez (status `frozen`, `package_freezes`); cancelación con reembolso proporcional (`status='refunded'` + cálculo de importe); FIFO fallback en el consumo automático; eventos publicados en `platform.events`: `package.purchased`, `package.exhausted`, `package.transferred`, `package.renewed`, `package.expiring`, `package.expired`, `package.refunded`, `package.frozen`, `package.unfrozen`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Definición del catálogo de bonos (plantillas)

- ✅ Crear plantilla de bono: `code` (único por tenant), `name`, `description`, `service_id`, `total_sessions`, `validity_days`, `price_cents`, `currency`, `is_active`, `metadata JSONB`.
- ✅ Listar plantillas (filtro `onlyActive`).
- ✅ Consultar plantilla por `id`.
- 🔧 Actualizar plantilla (`PATCH`) — no existe ruta de edición; la plantilla no es modificable una vez creada.
- 🔧 Bono restringido a un único `service_id` — no admite multi-servicio por plantilla.
- ❌ Desactivar / archivar plantilla (soft-delete con `is_active=FALSE`; la ruta de patch no existe).
- ❌ Plantilla multi-servicio: bono válido para una categoría o lista de `service_id` (p. ej. "10 sesiones de cualquier masaje").
- ❌ Plantilla con restricción por `resource_id` / `practitioner_id` (bono solo con el terapeuta X).
- ❌ Plantilla con precio por niveles (tier pricing): descuento al comprar más sesiones.
- ❌ Período de validez personalizado por compra (override al comprar respecto a la plantilla).
- ❌ Metadatos controlados / schema de `metadata` documentado por tipo de bono.
- ❌ Ordenación y agrupación de plantillas (position, categoría).
- ❌ Plantilla con precio en otra moneda distinta a la predeterminada del tenant.

## 2. Compra del bono (venta)

- ✅ `POST /v1/packages/purchases`: valida plantilla activa, calcula `expires_at = now() + validity_days`, registra `purchased_packages` con `remaining_sessions = total_sessions`, publica `package.purchased`.
- ✅ Staff puede comprar en nombre de otro usuario (`clientUserId` opcional en body).
- ✅ Precio final `pricePaidCents` sobreescribible en body (descuento staff).
- 🔧 Sin integración con `platform/payments`: el cobro real (Stripe) no está conectado — solo se registra el precio, no se procesa el pago.
- 🔧 Sin integración con `platform/splitpay`: no hay distribución de ingresos entre tenant y plataforma.
- ❌ Flujo completo de cobro: Stripe PaymentIntent → confirmación → emisión del bono.
- ❌ Idempotencia de compra: si el cliente reintenta el pago no se debe crear un bono duplicado (REUSE `platform/payments` idempotency key).
- ❌ Compra con descuento / cupón (integración con sistema de promociones).
- ❌ Compra desde POS físico (REUSE `platform/pos`).
- ❌ Compra con saldo de crédito del cliente (wallet) en lugar de tarjeta.
- ❌ Factura / ticket para la compra del bono (REUSE `platform/verifactu` en el futuro).
- ❌ Notificación de confirmación de compra al cliente (REUSE `platform/notifications`).
- ❌ Límite de bonos activos por cliente (evitar acumulación excesiva).

## 3. Consulta de saldo y listado de bonos

- ✅ `GET /v1/packages/purchases/:id`: detalle del bono con historial de movimientos (`redemptions`).
- ✅ `GET /v1/packages/purchases`: lista bonos de un cliente (propio o por `clientUserId` para staff), filtro `onlyActive` (status=active + expires_at > now() + remaining_sessions > 0).
- 🔧 Sin paginación en el listado de bonos del cliente — puede crecer sin límite.
- ❌ Filtro por `service_id` en el listado de bonos del cliente.
- ❌ Filtro por estado (`active/exhausted/expired/refunded/cancelled`).
- ❌ Vista consolidada multi-tenant: el super_admin no puede ver bonos de todos los tenants.
- ❌ Endpoint público (sin autenticación) para que el cliente consulte su saldo con un token de acceso rápido (p. ej. enlace de email).
- ❌ Saldo agregado: total de sesiones disponibles del cliente sumando todos sus bonos activos para un servicio.
- ❌ Estimación de duración: "con tu ritmo de uso te quedan N meses".

## 4. Consumo de sesiones al reservar y completar cita

- ✅ Redención manual: `POST /v1/packages/redeem` con `packageId` + `bookingId` opcional — decrementa `remaining_sessions` atómicamente; si llega a 0 → status `exhausted` + evento `package.exhausted`.
- ✅ Redención automática vía evento `booking.completed`: el servicio escucha `booking.completed` en `platform.events`, busca `package_id` en `platform_bookings.bookings` y decrementa (REUSE `platform/bookings`).
- ✅ Devolución de sesión por cancelación: `booking.cancelled` y `booking.no_show` devuelven automáticamente una sesión.
- ✅ Devolución manual: `POST /v1/packages/refund` — incrementa `remaining_sessions` y re-activa el bono si estaba `exhausted`.
- 🔧 `booking.no_show` devuelve la sesión (mismo tratamiento que cancelación) — en algunos modelos de negocio el no-show no debería reembolsarse.
- ❌ Política de cancelación configurable por plantilla: no reembolsar sesión si cancelación es tardía o no-show.
- 🔧 Selección automática de bono FIFO al consumir: `handleEvent(booking.completed)` ahora hace fallback a `findActivePackageFor` (bono que caduca antes) cuando el booking no trae `package_id` explícito. Pendiente: que `platform/bookings` lo seleccione/marque ya en la creación de la cita (cross-cutting).
- ❌ Múltiples sesiones por redención (p. ej. clase en pareja: restar 2 sesiones por reserva).
- ❌ Redención parcial: bonos de tiempo (horas) en lugar de sesiones enteras.
- ✅ Verificación de que el `booking_id` no fue ya redimido (idempotencia de redención): índice único parcial `(app_id,tenant_id,booking_id) WHERE reason='redeem'` + chequeo `redeemExistsForBooking` en `redeem` y en `handleEvent(booking.completed)`.
- ✅ Ajuste manual de saldo (`reason='adjust'`): `POST /v1/packages/purchases/:id/adjust` (staff only), delta entero ≠ 0, re-activa bono `exhausted` si se suman sesiones.
- ❌ Notificación al cliente cuando consume una sesión (REUSE `platform/notifications`).
- ❌ Notificación cuando el bono llega a N sesiones restantes (umbral configurable, p. ej. "te quedan 2 sesiones").

## 5. Caducidad y avisos de caducidad

- ✅ `expires_at` calculado en la compra (`now() + validity_days * 86400s`).
- ✅ Job `package-expiry-warning` (cron `0 8 * * *`): emite `package.expiring` con `window: 't_minus_30d'` y `window: 't_minus_7d'`; idempotente vía `warning_30d_sent_at` / `warning_7d_sent_at`.
- ✅ Job `package-expiry-transition` (cron `30 0 * * *`): status `active → expired` cuando `expires_at <= now()`, publica `package.expired`.
- ✅ Índice `idx_platform_packages_due_warning` para el job de avisos (sólo activos con sesiones).
- 🔧 Consumidor de `package.expiring` / `package.expired` no implementado en `platform/notifications` — los eventos se emiten pero nadie los convierte en email/push al cliente.
- ❌ Ventanas de aviso configurables por plantilla (p. ej. T-60d para bonos anuales).
- ❌ Tercer aviso a T-1d (día anterior a la caducidad).
- ❌ Aviso de "bono caducado" con sesiones no usadas (breakage) al cliente.
- ❌ Purga automática de registros de bonos muy antiguos ya expirados (REUSE `platform/scheduler`).
- ❌ Gracia tras caducidad: período de X días adicionales si queda saldo (configurable por plantilla).

## 6. Renovación del bono

- ✅ Toggle de `auto_renew` por compra: `PUT /v1/packages/purchases/:id/auto-renew`.
- ✅ `auto_renew_default` en la plantilla (valor inicial para nuevas compras).
- ✅ Renovación manual: `POST /v1/packages/purchases/:id/renew` — clona la plantilla en un nuevo `purchased_packages` con `renewed_from` apuntando al original; publica `package.renewed`.
- ✅ Cadena de renovaciones trazable vía `renewed_from` + `renewed_at`.
- 🔧 Renovación automática por cron: el scheduler aún no implementa un job `package-auto-renew` — `auto_renew` existe en la tabla pero nadie lo lee periódicamente para ejecutar la renovación sin intervención del usuario.
- ❌ Job `package-auto-renew` (cron diario): busca bonos con `auto_renew=TRUE` próximos a expirar y ejecuta `renewPackage` + cobro via `platform/payments`.
- ❌ Cobro automático en la renovación (Stripe subscription / PaymentIntent nuevo — REUSE `platform/payments`).
- ❌ Notificación al cliente antes de la renovación automática ("en 7 días se renovará tu bono").
- ❌ Cancelación de la renovación automática con motivo.
- ❌ Renovación con cambio de plantilla (upgrade/downgrade).
- ❌ Límite de renovaciones consecutivas.

## 7. Transferencia y regalo de bonos

- ✅ `POST /v1/packages/purchases/:id/transfer`: cambia `client_user_id` del bono al `toUserId` y registra en `package_transfers` con `kind` (`transfer` o `gift`) y `message` opcional; publica `package.transferred`.
- ✅ `GET /v1/packages/purchases/:id/transfers`: historial de transferencias del bono.
- ✅ Sólo el propietario actual (o staff/super_admin) puede transferir.
- 🔧 Sin validación de que `toUserId` sea un usuario existente en el tenant — se acepta cualquier UUID.
- ❌ Flujo de aceptación: el destinatario debe aceptar el regalo antes de que le sea asignado (previene regalo no solicitado).
- ❌ Notificación al destinatario del regalo/transferencia (REUSE `platform/notifications`).
- ❌ Regalo con message de felicitación (email personalizado).
- ❌ Límite de transferencias por bono (evitar reventa).
- ❌ Restricción: no transferir si el bono está `exhausted` o `expired`.
- ❌ Transferencia parcial: ceder N sesiones del bono a otro usuario (crear un nuevo bono derivado).
- ❌ Gift cards prepagadas: generar un código canjeable sin `toUserId` conocido de antemano.
- ❌ Flujo de canje de gift card: `POST /v1/packages/redeem-gift-card` con código → asigna el bono al usuario que canjea.

## 8. Compartición familiar / grupo

- ✅ `GET /v1/packages/purchases/:id/authorized-users`: lista usuarios autorizados.
- ✅ `POST /v1/packages/purchases/:id/authorized-users`: añade usuario autorizado (`userId`, `displayName`, `addedBy`); ON CONFLICT actualiza `display_name`.
- ✅ `DELETE /v1/packages/purchases/:id/authorized-users/:userId`: revoca acceso.
- ✅ Verificación en redención: el sistema comprueba `isAuthorized` antes de decrementar.
- ✅ Solo el propietario (o staff/super_admin) puede añadir/revocar usuarios.
- 🔧 Sin límite de usuarios autorizados por bono.
- ❌ Límite configurable de usuarios del grupo (p. ej. máx. 4 para bono familiar).
- ❌ Notificación al usuario añadido al grupo (REUSE `platform/notifications`).
- ❌ Vista del miembro del grupo: el usuario autorizado puede ver qué bonos compartidos tiene disponibles sin conocer el `packageId`.
- ❌ Historial de quién consumió cada sesión en un bono compartido (hoy `redemptions` no registra el `user_id` redimidor, solo el `booking_id`).
- ❌ Cuota por miembro: limitar cuántas sesiones puede consumir cada usuario autorizado del total del bono.
- ❌ Bono de empresa/equipo: un administrador de cuenta gestiona el pool de sesiones para sus empleados.

## 9. Prioridad de consumo entre bonos (FIFO por caducidad)

- 🔧 `findActivePackageFor` existe en el repositorio (ordena por `expires_at ASC`, devuelve el que caduca antes) pero no es llamado automáticamente desde el flujo de reserva — el consumo FIFO solo ocurre si el llamante lo usa explícitamente.
- ❌ Integración con `platform/bookings`: al crear/completar una reserva, seleccionar automáticamente el bono con menos tiempo de vida restante.
- ❌ Prioridad configurable: FIFO (más antiguo primero), LIFO (más reciente), mayor saldo primero.
- ❌ Exclusión manual: el cliente elige qué bono usar al reservar (en lugar del FIFO automático).
- ❌ Reserva de sesión al crear la cita (hold) + confirmación al completarla (evitar sobreventa en casos de alta concurrencia).

## 10. Congelación / pausa de la validez

- ✅ Congelar bono: `POST /v1/packages/purchases/:id/freeze` (staff) pasa status `active→frozen` y sella `frozen_at`. `POST .../unfreeze` vuelve a `active` y extiende `expires_at` por la duración congelada (acumula `frozen_days_total`).
- ✅ Historial de congelaciones con fechas de inicio/fin y motivo: tabla `package_freezes` + `GET /v1/packages/purchases/:id/freezes`.
- ❌ Límite de días congelados por año / por bono.
- 🔧 Aprobación de staff para congelar: hoy freeze/unfreeze son staff-only; falta autoservicio del cliente hasta un máximo de días.
- ✅ Extensión manual de `expires_at` por staff sin pasar por el flujo de congelación: `POST /v1/packages/purchases/:id/extend` con `{ days }` (staff only).
- ❌ Extensión automática: si el tenant cierra por festivo/vacaciones, extender la caducidad de todos los bonos activos.

## 11. Bonos de tiempo (horas) vs. bonos de sesiones

- 🔧 El modelo actual es exclusivamente por sesiones enteras (`total_sessions INT`).
- ❌ Bono de tiempo: `total_minutes` con `remaining_minutes` — adecuado para servicios de duración variable.
- ❌ Conversión sesión ↔ tiempo: facturar decimales de sesión según duración real de la cita.
- ❌ Créditos monetarios: saldo en céntimos en lugar de sesiones, descontando el precio de cada cita.
- ❌ Plantilla con modo configurable (`sessions` | `minutes` | `credits`).

## 12. Membresías y abonos recurrentes vs. bono cerrado

- ❌ Distinción conceptual membresía vs. bono: la membresía (suscripción) da acceso ilimitado o cuota mensual mientras está activa; el bono es un bloque cerrado de sesiones.
- ❌ Abono mensual con cuota de N sesiones por período (REUSE `platform/subscriptions` cuando esté implementado): al inicio de cada mes se recarga el saldo en lugar de acumular.
- ❌ Roll-over configurable: las sesiones no usadas del mes anterior se trasladan al siguiente (o no).
- ❌ Integración con el módulo `platform/subscriptions` (plannned) para gestionar el ciclo de facturación recurrente y la recarga de sesiones.
- ❌ Bono de introducción (onboarding pack): precio especial para primeras compras, no renovable.

## 13. Upgrade y downgrade de bono

- ❌ Upgrade: cambiar de un bono de 5 sesiones a uno de 10, abonando la diferencia.
- ❌ Downgrade: reducir el bono con reembolso proporcional de las sesiones no usadas.
- ❌ Migración de saldo: transferir las sesiones restantes del bono antiguo al nuevo.
- ❌ Historial de upgrades/downgrades enlazado al bono original.

## 14. Devolución / reembolso monetario de sesiones no usadas

- ✅ Devolución de sesión (incremento de saldo): `POST /v1/packages/refund` — se devuelve 1 sesión al saldo, razón `refund`.
- 🔧 Reembolso monetario proporcional: `POST /v1/packages/purchases/:id/cancel` calcula `(remaining_sessions/total_sessions)*price_paid_cents` (con `penaltyPct` opcional) y publica `package.refunded` con el importe. Pendiente: que `platform/payments` consuma el evento y ejecute la devolución Stripe real (cross-cutting).
- ✅ Cancelación completa del bono (`status='refunded'`): la ruta `cancel` (staff only) marca el bono como `refunded` y emite el evento; idempotente (rechaza si ya `refunded`/`cancelled`).
- ❌ Política de reembolso configurable por plantilla: plazo máximo, porcentaje de penalización.
- ❌ Reembolso a crédito interno (wallet) en lugar de devolución a la tarjeta.
- ❌ Notificación de reembolso al cliente (REUSE `platform/notifications`).

## 15. Historial de consumo y trazabilidad

- ✅ Tabla `redemptions`: registra cada movimiento (`redeem`/`refund`/`adjust`) con `delta`, `booking_id` y `created_at`.
- ✅ `getPurchase` devuelve el bono junto con su array de `redemptions`.
- ✅ `redemptions.redeemer_user_id`: cada redención registra quién consumió (owner / miembro autorizado / staff en ajustes); en redención automática se usa el `client_user_id` del booking.
- ✅ `user_id` del redimidor en `redemptions` (quién de la familia consumió).
- ❌ Endpoint de historial de redenciones a nivel de tenant (para staff): ver todos los movimientos de todos los bonos.
- ❌ Línea de tiempo de actividad del cliente: compras, consumos, transferencias, avisos en una sola vista.
- ❌ Export CSV/XLSX de historial de movimientos.
- ❌ Búsqueda de redención por `booking_id` (p. ej. saber qué bono se usó en una reserva concreta).

## 16. Informes y analítica (breakage, vendidos, caducados)

- ❌ Bonos vendidos por período (count, ingresos, sesiones vendidas).
- ❌ Bonos activos en un instante: por plantilla, por servicio, por practitioner.
- ❌ Tasa de consumo: sesiones usadas / sesiones vendidas por cohorte de compra.
- ❌ Breakage: sesiones caducadas sin usar — ingresos puros para el negocio; informes por plantilla y período.
- ❌ Bonos en riesgo de caducar: activos con sesiones restantes en los próximos 30/7 días.
- ❌ Tiempo medio de uso: días entre compra y primera redención; tiempo medio entre redenciones.
- ❌ Tasa de renovación: % de clientes que renuevan vs. dejan caducar.
- ❌ Lifetime value de cliente en base a bonos acumulados.
- ❌ Dashboard de admin con métricas clave (REUSE portal apps/<app>).
- ❌ Export CSV de bonos vendidos/caducados para contabilidad.

## 17. Multi-tenant y aislamiento

- ✅ RLS en `package_templates`, `purchased_packages`, `redemptions`, `package_authorized_users`, `package_transfers` con `(app_id, tenant_id)`.
- ✅ Índice único `(app_id, tenant_id, code)` en plantillas.
- ✅ `sub_tenant_id` propagado en el contexto pero no almacenado ni filtrado en el módulo.
- 🔧 Sin soporte de `sub_tenant_id` en el modelo de datos — bonos son tenant-level, no sub-tenant-level.
- ❌ Soporte de `sub_tenant_id` en `purchased_packages` para tenants con sub-unidades (p. ej. distintas sedes del mismo centro).
- ❌ Bono válido en múltiples tenants del mismo `app_id` (bono de red: "cualquier centro de la franquicia").
- ❌ Vista super_admin cross-tenant: listado de bonos para supervisión.

## 18. Eventos, integraciones y extensibilidad

- ✅ `package.purchased` — publicado en `platform.events` tras compra exitosa.
- ✅ `package.exhausted` — publicado cuando `remaining_sessions` llega a 0.
- ✅ `package.transferred` — publicado tras transferencia/regalo.
- ✅ `package.renewed` — publicado tras renovación manual.
- ✅ `package.expiring` — publicado por el scheduler (T-30d / T-7d).
- ✅ `package.expired` — publicado por el scheduler al caducar.
- ✅ Suscripción a `booking.completed`, `booking.cancelled`, `booking.no_show` para redención/devolución automática.
- ✅ `package.refunded` — publicado por `cancel` con el importe proporcional a devolver (lo consume `platform/payments`, pendiente).
- ✅ `package.frozen` / `package.unfrozen` — publicados al congelar / descongelar (este último incluye `daysAdded`).
- ❌ `package.shared` / `package.unshared` — evento al añadir/quitar usuario autorizado.
- ❌ Consumidor en `platform/notifications` de todos los eventos `package.*` para enviar emails/push al cliente.
- ❌ Integración con `platform/pos`: registrar venta de bono desde TPV físico.
- ❌ Webhook saliente hacia sistemas externos (CRM, ERP) cuando se compra o caduca un bono.
- ❌ API pública en `@apphub/sdk-js` para que portales de terceros consulten el saldo del cliente.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. 🔧 **Consumo FIFO automático desde `platform/bookings`** — núcleo implementado: `handleEvent(booking.completed)` hace fallback a `findActivePackageFor` cuando el booking no trae `package_id`. Pendiente la parte en `platform/bookings` (cross-cutting): seleccionar/persistir el bono al crear la cita.
2. **Job `package-auto-renew`** en el scheduler + cobro via `platform/payments` — completa el ciclo de renovación automática; la infraestructura de `auto_renew` ya está en la BD. (Fuera: requiere scheduler + payments.)
3. **Consumidores en `platform/notifications`** de `package.expiring` / `package.expired` / `package.purchased` — añadir emails/push al cliente. (Fuera: requiere `platform/notifications`.)
4. 🔧 ~~**Reembolso monetario proporcional** (`platform/payments` + `status='refunded'`)~~ — cancelación + cálculo proporcional + evento `package.refunded` implementados en packages; falta que `platform/payments` ejecute la devolución Stripe (cross-cutting).
5. ✅ ~~**Idempotencia de redención**~~ — índice único parcial sobre `booking_id` (`reason='redeem'`) + chequeo en `redeem` y `handleEvent`.
6. ✅ ~~**`user_id` redimidor en `redemptions`**~~ — columna `redeemer_user_id` poblada en redenciones manuales, automáticas y ajustes.
7. **Integración con `platform/payments`** en la compra — (Fuera: requiere `platform/payments`.)
8. ✅ ~~**Ajuste manual de saldo** (`reason='adjust'` por staff)~~ — `POST /v1/packages/purchases/:id/adjust`.
9. ✅ ~~**Congelación / extensión de `expires_at`** por staff~~ — `freeze` / `unfreeze` / `extend` + tabla `package_freezes` + eventos `package.frozen` / `package.unfrozen`.
10. **Informes básicos de breakage y bonos activos** — export CSV y métricas en el portal de admin; valor comercial inmediato para el negocio.
