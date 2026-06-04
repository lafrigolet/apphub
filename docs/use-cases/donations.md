# Casos de uso — `platform/donations` (platform-core)

> Dominio: donaciones one-shot y recurrentes mensuales (Stripe Checkout / Subscription) con fiscalidad española completa — Ley 49/2002 de régimen fiscal de entidades sin fines lucrativos, certificados anuales de donativos en PDF y exportación del Modelo 182 AEAT. Multi-tenant; cualquier app de la plataforma puede activar el módulo.

## Estado actual (implementado)

Formulario de checkout público (`POST /v1/donations/checkout`) para donaciones one-shot y recurrentes mensuales; causas/campañas con objetivo de recaudación y progreso; donante identificado o invitado (sólo email); donación anónima; datos fiscales opcionales (NIF, dirección); integración con `platform/splitpay` vía loopback HTTP; subscriber de eventos Stripe (checkout.completed, invoice.paid, invoice.payment_failed, subscription.updated/deleted); generación masiva de certificados anuales PDF (React-PDF) con upsert idempotente en `fiscal_certificates` y subida a `platform/storage`; exportación del Modelo 182 AEAT en formato de ancho fijo ISO-8859-1; reembolso de donación vía splitpay/payments; cancelación de suscripción recurrente por el propio donante o por admin; historial del donante autenticado; admin list con filtros (causa, estado, rango de fechas, paginación); importes sugeridos configurables por tenant (tabla `tenant_settings`) y override por causa (`suggested_amounts_cents`), expuestos en lectura pública y gestión admin; CRM básico de donantes (listado único agrupado por NIF/email con totales, ficha con historial, export CSV); reenvío individual de certificados (marca `sent_at` + re-emite `donation.certificate.ready`); RLS por `(app_id, tenant_id)` en todas las tablas.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Donación puntual (one-shot)

- ✅ Checkout vía Stripe Checkout Session (`mode: payment`) con `price_data` ad-hoc — sin Product en Stripe.
- ✅ Importe libre en céntimos con mínimo 1 € (100 céntimos); moneda configurable (defecto EUR).
- ✅ Donante invitado (sólo `donorEmail`) o donante autenticado (`donorUserId`).
- ✅ Campo `message` libre (hasta 500 caracteres) para dedicatoria o motivo.
- ✅ Row `donations` con `status='pending'` antes de Stripe; `status='paid'` en webhook.
- ✅ Idempotencia por `stripe_session_id`; reconciliación también por `donation_id` en metadata.
- ✅ Importes sugeridos predefinidos configurables por tenant (`platform_donations.tenant_settings.default_suggested_amounts_cents`) y override por causa (`causes.suggested_amounts_cents`); lectura pública en `GET /v1/donations/settings/suggested-amounts` (precedencia causa → tenant) y gestión admin en `/v1/donations/settings/admin`.
- ❌ Donación "en memoria / en honor de" (campo `dedication_type` + nombre del homenajeado).
- ❌ Método de pago alternativo: transferencia bancaria, Bizum, cheque — sólo Stripe.
- ❌ Donación con cobertura de gastos de gestión (opt-in "cubrir fees").

## 2. Donación recurrente mensual

- ✅ Checkout Stripe `mode: subscription` con `price_data.recurring.interval='month'`.
- ✅ `donation_subscriptions` persistido en primer cobro (evento `checkout.completed` con `subscriptionId`).
- ✅ Renovaciones mensuales: evento `invoice.paid` → INSERT nueva `donation` paid + `incrementRaised`.
- ✅ Cancelación por el donante autenticado (`POST /v1/donations/subscriptions/:id/cancel`).
- ✅ Cancelación por admin/staff (mismo endpoint, sin chequeo de `donor_user_id`).
- ✅ Estado `past_due` cuando falla el cobro (`invoice.payment_failed`).
- ✅ `cancel_at_period_end` y `current_period_end` sincronizados desde `subscription.updated`.
- ✅ `status='cancelled'` en `subscription.deleted` con evento `donation.recurring.cancelled`.
- ❌ Periodicidades adicionales: trimestral, semestral, anual — sólo mensual.
- ❌ Pausa de suscripción (sin cancelar).
- ❌ Cambio de importe en suscripción activa (upgrade/downgrade).
- ❌ Cambio de método de pago del donante recurrente (portal del cliente Stripe).
- ❌ Dunning activo: emails recordatorio antes de expirar tarjeta / tras cobro fallido (REUSE `platform/notifications`).
- ❌ Reintento manual de cobro fallido desde el panel admin.

## 3. Donante y su identidad

- ✅ Donante registrado (usuario de la plataforma, `donor_user_id`).
- ✅ Donante invitado (sólo email + nombre opcionales).
- ✅ Donación anónima (`anonymous=true`): el nombre del donante no se expone públicamente.
- ✅ Datos fiscales opcionales: NIF, dirección, código postal, país (ISO 3166-1 alpha-2).
- ✅ El donante autenticado consulta su historial (`GET /v1/donations/me`).
- ✅ El donante autenticado consulta sus suscripciones activas (`GET /v1/donations/subscriptions/me`).
- ❌ Portal "mi área de donante": historial, descargas de certificados, gestión de método de pago.
- ❌ Actualización de datos fiscales por el propio donante (NIF, dirección) sin nueva donación.
- ❌ Vinculación de donaciones de invitado a usuario registrado (claim por email).
- ❌ Perfil de donante con historial acumulado entre tenants (donaciones cross-tenant del mismo usuario).
- ❌ Donante corporativo (persona jurídica con razón social, CIF, NIF representante).

## 4. Causas / campañas

- ✅ Tabla `causes` multi-tenant con `code`, `name`, `description`, `target_cents`, `raised_cents`, `currency`, `active`, `position`, `starts_at`, `ends_at`, `image_object_id`.
- ✅ Lectura pública de causas activas (`GET /v1/donations/causes?appId&tenantId`) — sin JWT.
- ✅ CRUD admin: crear, actualizar, listar todas (incl. inactivas), get por id, soft-delete (`active=false`).
- ✅ `raised_cents` se incrementa / decrementa atómicamente en cada pago y reembolso.
- ✅ `starts_at` / `ends_at`: validación automática de apertura/cierre de la causa en el checkout (rechaza con `409` si la causa aún no abrió o ya cerró).
- 🔧 Soft-delete pone `active=false` pero no comprueba si hay suscripciones activas vinculadas.
- ❌ Imagen de la causa gestionada desde el admin (sólo se persiste `image_object_id` — no hay flujo de upload directo).
- ❌ Causa con donaciones anónimas forzadas (configuración por causa).
- ✅ Importes sugeridos específicos por causa (`causes.suggested_amounts_cents`, override del default del tenant).
- ❌ Causa con importes mínimos/máximos específicos.
- ❌ Notificación automática al alcanzar el objetivo (`raised_cents >= target_cents`).
- ❌ Widget embebible de progreso de causa (barra de recaudación) para portales externos.
- ❌ Causa periódica / estacional (re-apertura automática cada año).
- ❌ Subidas de causa a redes sociales / social sharing con OG tags.

## 5. Datos fiscales del donante (NIF / dirección)

- ✅ `donor_nif`, `donor_address`, `donor_postal_code`, `donor_country` en `donations`.
- ✅ `donor_nif` en `donation_subscriptions` (persistido desde el primer cobro).
- ✅ Índice parcial `(app_id, tenant_id, donor_nif, paid_at) WHERE donor_nif IS NOT NULL AND status='paid'` para consultas fiscales eficientes.
- ✅ Validación de formato de NIF español (DNI/NIE/CIF): algoritmo de letra de control (`src/lib/nif.js`), aplicada en el checkout (rechaza `422` si inválido).
- ❌ Validación de NIF extranjero (VAT UE, passportNumber).
- ✅ Normalización/limpieza del NIF (quitar guiones, espacios, puntos, uppercase) en ingesta del checkout.
- ❌ Actualización retroactiva del NIF en donaciones ya pagadas (corrección de datos fiscales).
- ❌ Gestión de consentimiento explícito para tratamiento fiscal (LOPDGDD).
- ❌ Encriptado de NIF en reposo (campo `donor_nif` es texto plano; contiene PII sensible).

## 6. Certificados fiscales anuales (Ley 49/2002)

- ✅ Generación masiva de PDFs por ejercicio fiscal: agrupa donaciones pagadas de donantes con NIF por `donor_nif`.
- ✅ Plantilla PDF en React-PDF (`Certificate.js`) con entidad declarante (nombre, NIF, domicilio), donante, tabla de donaciones por fecha/causa e importe, total del año y texto legal de la Ley 49/2002.
- ✅ Upsert idempotente en `fiscal_certificates` `UNIQUE (app_id, tenant_id, fiscal_year, donor_nif)` — regenerable sin duplicados.
- ✅ PDF subido a `platform/storage` (loopback HTTP); referencia por `pdf_object_id`.
- ✅ Evento `donation.certificate.ready` publicado en `platform.events` por cada certificado generado.
- ✅ Listado de certificados admin con filtro por año (`GET /v1/donations/fiscal/certificates`).
- ✅ Generación de certificado individual (filtro `donorNif` en `POST .../certificates/generate`).
- 🔧 Envío del certificado al donante por email aún no implementado: el evento `donation.certificate.ready` ahora se publica realmente (el `redis` se inyecta vía `app.decorate('_redis')` en `index.js`; antes `fastify._redis` era siempre null y no se emitía). Falta el suscriptor en `platform/notifications` (cross-cutting pendiente).
- ✅ `sent_at` en `fiscal_certificates` se actualiza al reenviar el certificado (`certsRepo.markSent` desde `resendCertificate`).
- ❌ Descarga del PDF por el donante desde su área privada (URL firmada de `platform/storage`).
- ✅ Reenvío individual de certificado desde el panel admin: `POST /v1/donations/fiscal/certificates/:id/resend` marca `sent_at` y re-publica `donation.certificate.ready` (el envío del email lo hará el suscriptor de notifications pendiente).
- ❌ Certificado de donación inmediata (recibo de agradecimiento en el acto, no sólo el anual).
- ❌ Certificados por suscripción recurrente (agrupando todos los cobros del año de la misma suscripción).
- ❌ Multi-idioma del certificado (castellano / català / euskera / galego).
- ❌ Firma digital del PDF (garantía de autenticidad electrónica).

## 7. Modelo 182 AEAT (declaración informativa)

- ✅ Exportación en formato de ancho fijo 600 caracteres (tipo 1 cabecera + tipo 2 declarados).
- ✅ Codificación ISO-8859-1 / latin1 obligatoria por spec AEAT.
- ✅ Separador CRLF entre registros.
- ✅ Registro tipo 1: NIF declarante, ejercicio, razón social, teléfono contacto, nombre contacto, número de declarados, total importe.
- ✅ Registro tipo 2: NIF donante, nombre, país, importe acumulado del año, tipo 'A' (dinerario), indicadores revocación/especie/autonómica.
- ✅ Nombre de fichero `MODELO_182_{year}_{CIF}.txt`.
- ✅ Headers HTTP `Content-Disposition`, `X-Donors-Count`, `X-Donors-Total-Cents`, `X-Fiscal-Year`.
- ✅ Guardia: requiere que el tenant tenga `cif` configurado en `platform_tenants.tenants`.
- 🔧 Posicionamiento de campos en tipo 1 (cabecera) sigue spec parcialmente: el campo de "número justificante de presentación anterior" se rellena con ceros y los offsets de "totales" están aproximados al layout genérico — requiere revisión formal contra la resolución AEAT vigente.
- ✅ Código de provincia (2 chars del tipo 2) calculado desde `donor_postal_code` (`provinceCodeFromPostalCode`); `'00'` sólo si CP ausente o fuera de rango 01..52.
- ✅ Validación de NIF del donante antes de incluirlo en el modelo: los donativos con NIF inválido se excluyen del fichero y se reportan en `skipped` + header HTTP `X-Donors-Skipped`.
- ❌ Indicador de deducción autonómica configurable por comunidad autónoma (actualmente fijo `'N'`).
- ❌ Soporte de revocación de donativos (registros tipo 2 con revocación).
- ❌ Donaciones en especie (actualmente fijo `'N'`).
- ❌ Presentación directa a la AEAT vía API sede electrónica / certificado digital (en la actualidad el fichero se genera para subida manual).
- ❌ Almacenamiento del número de justificante de presentación devuelto por AEAT.
- ❌ Validación previa del fichero con el validador oficial AEAT antes de la descarga.

## 8. Deducción por tramos y fidelización (Ley 49/2002)

- ✅ Cálculo del tramo de deducción IRPF aplicable: 80 % para los primeros 250 €, 35 % o 40 % (fidelización ≥ 3 años) para el exceso (`src/lib/deduction.js`); expuesto en `GET /v1/donations/fiscal/deduction?year&donorNif`.
- ✅ Registro de "años consecutivos de donación" por NIF para aplicar el tramo de fidelización (computado desde las donaciones pagadas: `consecutiveYearsForLoyalty` ≥ 3 años consecutivos al mismo tenant → 40 %).
- ✅ Información al donante en el certificado del importe deducible estimado por tramos (bloque "Deducción estimada en IRPF" en el PDF).
- ❌ Alerta al donante recurrente cuando alcance el tercer año consecutivo ("ya puedes deducir el 40 %").
- ❌ Cálculo IS (Impuesto sobre Sociedades) para donantes corporativos (personas jurídicas).

## 9. Dunning y recuperación de pagos fallidos

- ✅ Estado `past_due` en `donation_subscriptions` cuando `invoice.payment_failed`.
- ✅ Evento `donation.recurring.failed` publicado en `platform.events`.
- ❌ Email automático al donante cuando su pago falla (REUSE `platform/notifications` → suscriptor de `donation.recurring.failed`).
- ❌ Email de recordatorio antes de que expire la tarjeta del donante recurrente.
- ❌ Portal del cliente Stripe (Billing Portal) para que el donante actualice su método de pago.
- ❌ Reintento manual desde admin (llamar a `invoice.pay` en Stripe).
- ❌ Escalado: si sigue `past_due` N días → cancelar automáticamente (REUSE `platform/scheduler`).
- ❌ SMS o push notification de pago fallido.

## 10. Reembolsos

- ✅ Reembolso total desde admin (`POST /v1/donations/admin/:id/refund`) con `reason` y `idempotencyKey`.
- ✅ Llamada a `platform/payments` vía loopback; `status='refunded'` + `refunded_at` + `refund_reason`.
- ✅ `raised_cents` de la causa se decrementa en el importe reembolsado.
- 🔧 Reembolso parcial no soportado — sólo reembolso total de la donación.
- ❌ Reembolso de donación recurrente (reembolso de un cobro concreto de la suscripción).
- ❌ Política de reembolso configurable por tenant (plazo máximo, causas elegibles).
- ❌ Flujo de solicitud de reembolso iniciado por el propio donante.
- ❌ Notificación al donante cuando se procesa el reembolso (REUSE `platform/notifications`).

## 11. Notificaciones y comunicación con el donante

- ✅ Evento `donation.completed` publicado en `platform.events` tras cada pago (one-shot y primer cobro recurrente).
- ✅ Evento `donation.recurring.charged` por cada renovación mensual exitosa.
- ✅ Evento `donation.recurring.failed` por cada cobro fallido.
- ✅ Evento `donation.recurring.cancelled` cuando la suscripción se cancela.
- ✅ Evento `donation.certificate.ready` al generar el certificado anual.
- ❌ Email de agradecimiento / recibo inmediato al donante tras `donation.completed` (REUSE `platform/notifications`).
- ❌ Email de bienvenida al suscriptor recurrente tras el primer cobro.
- ❌ Email de confirmación de cancelación al donante tras `donation.recurring.cancelled`.
- ❌ Email anual con el certificado fiscal adjunto (PDF) (el evento existe; falta el suscriptor en notifications).
- ❌ Resumen anual de donaciones por email ("gracias por tu apoyo en 2025").
- ❌ Plantillas de email personalizables por tenant (logo, colores, texto).

## 12. Gestión de donantes y CRM

- ✅ Listado admin de donaciones con filtros: `causeId`, `status`, `fromDate`, `toDate`, paginación.
- ✅ Listado admin de suscripciones activas/pasadas (`GET /v1/donations/admin/subscriptions`).
- ✅ Get individual de una donación (admin o el propio donante).
- ✅ Listado de donantes únicos (agrupado por `COALESCE(donor_nif, donor_email)`) con total donado, nº de donaciones, primera/última: `GET /v1/donations/donors/admin`.
- ✅ Ficha de donante: resumen + historial completo de donaciones pagadas (`GET /v1/donations/donors/admin/:donorKey`). (Suscripciones/certificados quedan fuera del V1 de la ficha.)
- 🔧 Búsqueda por nombre, email, NIF (`?search=`) + rango de fechas (`?fromDate&toDate`). Falta rango de importe.
- ❌ Etiquetas / segmentos de donantes (recurrente, gran donante, primer donativo, etc.).
- 🔧 Exportación CSV del listado de donantes (`GET /v1/donations/donors/admin/export.csv`). Falta XLSX y export del listado de donaciones.
- ❌ Marcado de donante VIP / bloqueado.
- ❌ Notas internas del admin sobre un donante.

## 13. Recurrencia y fidelización

- ✅ Donación recurrente mensual vía Stripe Subscription.
- ✅ Historial de todos los cobros de una suscripción (filas `donations` con `subscription_id`).
- ❌ Recurrencia trimestral, semestral, anual.
- ❌ Conteo de años consecutivos de donación por NIF (para deducción fiscalidad fidelización).
- ❌ Insignia o reconocimiento al donante que cumple N años de recurrencia.
- ❌ Upgrade automático de importes (propuesta al donante "aumenta tu cuota mensual").
- ❌ Pausa temporal de la suscripción (vacaciones, etc.) sin cancelar.
- ❌ Programa de matching: empresa doble la donación del empleado (configuración empleador + vínculo).

## 14. Campañas, objetivos y transparencia

- ✅ `target_cents` y `raised_cents` por causa.
- 🔧 No hay notificación automática cuando se alcanza el objetivo.
- ❌ Objetivo de donantes únicos (no sólo importe total).
- ❌ Reporting público de la causa: % alcanzado, número de donantes, top recientes (respetando anonimato).
- ❌ Transparencia / reporting público por tenant: memoria anual de donaciones recibidas.
- ❌ Exportación contable: asiento por donación / CSV para software contable (A3, ContaPlus, Holded).
- ❌ Conciliación automática: comparar total `raised_cents` con liquidaciones recibidas en Stripe.

## 15. Página de donación por tenant (widget / portal)

- 🔧 El checkout acepta `appId + tenantId` en el body sin JWT — el formulario puede ser embebido, pero no hay componente frontend dedicado en el módulo.
- ❌ Página pública de donación por tenant (`/donate`) generada automáticamente con logo, texto, causas activas e importes sugeridos.
- ❌ Widget JS embebible (iframe / script) para páginas externas.
- ❌ Soporte de idioma por tenant (i18n del formulario).
- ❌ Personalización visual por tenant (colores, tipografía, logo, imagen de portada).
- ❌ URL canónica con slug de causa (`/donate/ayuda-emergencia`).
- ❌ Compartir causa en redes sociales (Open Graph).

## 16. Conciliación y contabilidad

- ✅ `stripe_payment_intent_id` en `donations` permite trazar cada cobro en Stripe.
- ✅ `stripe_subscription_id` y `stripe_customer_id` en `donation_subscriptions`.
- ❌ Conciliación automática con Stripe Balance Transactions (verificar que cada donación tiene su payout correspondiente).
- ❌ Exportación de libro diario de ingresos por donación (fecha, importe, NIF, cuenta contable).
- ❌ Liquidación por causa: cuánto corresponde a cada causa del total recaudado.
- ❌ Gestión de comisiones Stripe (fees netos vs brutos por donación).
- ❌ Informe de IVA / exención (donaciones a ESFL están exentas — documentación de la exención).

## 17. GDPR y protección de datos (LOPDGDD)

- ❌ Consentimiento explícito del donante (texto legal, versión, timestamp) en el formulario.
- ❌ Base legal del tratamiento y registro de finalidades.
- ❌ Derecho al olvido: borrado o anonimización de datos personales del donante (NIF, email, nombre, dirección) — conflicto con obligación fiscal de conservación 4 años.
- ❌ Derecho de acceso / portabilidad: export de todos los datos de un donante concreto.
- ❌ Retención automática: purga de donaciones con `status='pending'`/`'failed'` más antiguas de N días (REUSE `platform/scheduler`).
- ❌ Encriptado de NIF y dirección del donante en reposo (actualmente texto plano en DB).
- ❌ Audit log: quién consulta / exporta datos personales de donantes (PII).
- ❌ Registro de actividad: accesos a la ficha de donante por staff.
- ❌ Listado de supresión (donantes que solicitaron no ser contactados).

## 18. Multi-tenant, multi-app y modelo de datos

- ✅ RLS forzada en las 5 tablas (`donations`, `donation_subscriptions`, `causes`, `fiscal_certificates`, `tenant_settings`) con política `(app_id, tenant_id)`.
- ✅ `sub_tenant_id` nullable para soporte de jerarquía de dos niveles.
- ✅ `withStaffBypass` para el subscriber de eventos (sin contexto JWT).
- ✅ Datos del tenant declarante (NIF / razón social / domicilio) leídos desde `platform_tenants.tenants.cif`/`legal_name`/`address` — sin duplicación.
- 🔧 `donation_subscriptions` no expone admin endpoint de get-by-id ni filtros (sólo list all y cancel).
- ❌ Admin endpoint de detalle de suscripción individual con historial de cobros.
- ❌ Soporte de `donorAddress` en `donation_subscriptions` (no persiste; sólo en `donations`).
- ❌ Audit log de cambios de estado en `donations` y `donation_subscriptions` (tabla `donation_events`).
- ❌ Soft-delete de donaciones (hoy no existe; una donación refundada permanece visible).
- ❌ Importes máximos por donación configurables por tenant (anti-fraude, límites legales).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Email de agradecimiento / recibo inmediato** — REUSE directo de `platform/notifications` suscribiendo `donation.completed`; coste mínimo, impacto alto en experiencia del donante.
2. 🔧 **Envío del certificado anual por email** — el evento `donation.certificate.ready` ahora se publica realmente (redis inyectado en `index.js`); `sent_at` se actualiza vía el endpoint de reenvío `POST .../certificates/:id/resend`. **Falta sólo el suscriptor en `platform/notifications`** (cross-cutting pendiente).
3. **Dunning básico: email tras pago fallido** — suscriptor de `donation.recurring.failed` → REUSE notifications; recupera recurrentes `past_due` sin desarrollo costoso.
4. ~~**Validación y normalización del NIF** — riesgo fiscal directo: un NIF inválido en el Modelo 182 genera error AEAT. Coste bajo (función pura), valor alto.~~ ✅ **Hecho** — `src/lib/nif.js` (DNI/NIE/CIF + normalización), aplicado en checkout y en el Modelo 182 (donantes con NIF inválido excluidos del fichero).
5. **Encriptado de NIF en reposo** — PII sensible actualmente en texto plano; REUSE `@apphub/platform-sdk/crypto`.
6. ~~**Importes sugeridos configurables por tenant**~~ ✅ **Hecho** — `tenant_settings.default_suggested_amounts_cents` (tabla nueva) + override por causa (`causes.suggested_amounts_cents`); lectura pública `GET /v1/donations/settings/suggested-amounts` (precedencia causa → tenant) + admin `/v1/donations/settings/admin`.
7. ~~**Ficha de donante + exportación CSV**~~ ✅ **Hecho** — agrupado por `COALESCE(nif, email)` con total/nº/primera/última: listado + ficha + export CSV bajo `/v1/donations/donors/admin` (búsqueda + rango de fechas).
8. ~~**Validación de apertura/cierre de causa** (`starts_at` / `ends_at`) en el checkout — los campos existen; sólo falta la guarda en `createCheckout`.~~ ✅ **Hecho** — guarda en `createCheckout` (rechaza `409` fuera de ventana).
9. ~~**Deducción por tramos y fidelización** — registrar años consecutivos de donación por NIF; informar al donante del porcentaje de deducción estimado en el certificado. Alto valor fiscal/diferencial.~~ ✅ **Hecho** — `src/lib/deduction.js` + `GET /v1/donations/fiscal/deduction` + bloque de deducción estimada en el PDF del certificado.
10. **GDPR: consentimiento + retención/purga** via `platform/scheduler` — obligatorio en España/UE; el scheduler ya existe para jobs similares.
