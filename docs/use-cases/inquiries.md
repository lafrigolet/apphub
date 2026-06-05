# Casos de uso — `platform/inquiries` (platform-core)

> Dominio: formulario de contacto **por-tenant** (a diferencia de `platform/leads`, que es global de la plataforma y existe *antes* de que el prospecto sea tenant). El visitante anónimo de un portal concreto (`aikikan.hulkstein.com`, `aulavera.hulkstein.com`…) envía una consulta dirigida a **ese tenant** (`app_id + tenant_id`). V1 email-only: la plataforma alerta al admin del tenant y envía acuse al visitante; el admin responde desde su buzón personal usando el `Reply-To` que apunta al visitante. El módulo no gestiona conversaciones en-plataforma en V1 — ese gap se cubre en V2.

## Estado actual (implementado)

Envío público anónimo vía `POST /v1/inquiries/` con `appId, tenantId, subTenantId?, contactName, email, phone?, subject?, message, source?, metadata{}`; referencia citable autogenerada (`INQ-YYYYMMDD-XXXXXX`, base32 sin ambigüedades, colisión capturada como 409 reintentable); aislamiento por `(app_id, tenant_id)` con RLS; FSM de estados `new → contacted → closed|spam` (terminales sin retorno); stamps `contacted_at` / `closed_at`; bloqueo de `create` si el tenant no tiene `contact_inbox_email` configurado (422); evento `platform.events :: inquiry.created` post-commit; settings por-tenant (`contact_inbox_email`, `reply_to_email`, `user_thanks_subject`, `user_thanks_body`) via `PUT /v1/inquiries/admin/settings`; admin list (filtro por estado + paginación), get y patch (estado + staff_notes); guard `owner|admin|staff|super_admin` en todos los endpoints admin; índice compuesto `(app_id, tenant_id, status, created_at DESC)` + índice en `lower(email)`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Captura / envío público

- ✅ Envío anónimo desde el form de contacto de cualquier portal de la plataforma (`POST /v1/inquiries/` sin JWT).
- ✅ Aislamiento por `(app_id, tenant_id)` desde el body — ningún visitante puede inyectar datos en otro tenant.
- ✅ Campos base: `contactName`, `email`, `phone?`, `subject?`, `message`, `source?`.
- ✅ Campo `metadata JSONB` libre para que cada app añada campos propios (dropdown de motivo, identificador de sesión, hash anti-CSRF…).
- ✅ Referencia legible generada en servidor (`INQ-YYYYMMDD-XXXXXX`) devuelta al visitante.
- 🔧 `source` libre (string sin catálogo) — falta vocabulario controlado por app/tenant.
- 🔧 `subject` libre (string) — sin opciones predefinidas por tenant (select/radiogroup configurable).
- ❌ Form builder per-tenant: esquemas de campos configurables (campos obligatorios, opcionales, dropdowns, tipos).
- ❌ Formularios múltiples por tenant (ej. "contacto ventas" vs "soporte técnico" vs "colaboraciones").
- ❌ Captura desde otros canales: chat/widget flotante, llamada entrante, email entrante (`contacto@…`), WhatsApp, QR físico.
- ❌ Importación masiva de consultas (CSV/XLSX) — para migración desde sistema anterior.
- ❌ Sub-tenant routing: cuando `sub_tenant_id` está poblado, enrutar a la bandeja del sub-tenant además del tenant raíz.

## 2. Validación y configuración previa

- ✅ Bloqueo `422` si el tenant no tiene `contact_inbox_email` configurado — el módulo no promete un contrato que no puede cumplir.
- ✅ Validación de formato (Zod): email RFC, longitudes máximas, tipos.
- ✅ Captura de `ip` y `user_agent` para triaje posterior.
- ✅ Rate limiting por IP en el endpoint público (override por ruta de `@fastify/rate-limit`: 5/min por IP; requiere `trustProxy`, ya activado en los monolitos).
- ❌ CAPTCHA / hCaptcha / Cloudflare Turnstile en el endpoint de envío.
- ✅ Honeypot field `website` (campo oculto; si llega relleno → 201 fake sin persistir ni publicar evento).
- ❌ Validación de email real (MX lookup, detección de dominios desechables/disposable, role-based `info@`/`noreply@`).
- ❌ Validación/normalización de teléfono (E.164, código de país).
- ❌ Detección de spam por contenido (heurísticas, listas negras de palabras, scoring).
- ❌ Bloqueo por IP / dominio de email / patrón conocido de spam.
- ❌ Cuarentena automática de envíos sospechosos (estado `quarantine` previo a `new`).

## 3. Notificación al admin del tenant

- ✅ Publicación de `platform.events :: inquiry.created` post-commit con `contactInboxEmail`, `replyToEmail`, todos los campos del visitante y campos de configuración del "gracias".
- ✅ Best-effort: el evento se publica después del COMMIT — si falla, la consulta queda persistida y visible en admin aunque el email no se envíe.
- ❌ Suscriptor en `platform/notifications` que materialize el envío del email-alerta al admin (hoy el evento se publica pero no hay listener documentado en el módulo).
- ❌ Notificación push/in-app al admin del tenant en la consola (sin depender del email).
- ❌ Notificación a múltiples destinatarios (cc a otros miembros del staff del tenant).
- ❌ Alerta de SLA: notificar al admin si una consulta lleva N horas en `new` sin ser contactada.
- ❌ Resumen diario/semanal de consultas pendientes enviado al admin.
- ❌ Preferencias de notificación por rol/usuario del tenant (no recibir alertas fuera de horario, etc.).

## 4. Auto-respuesta / acuse al visitante

- ✅ Evento `inquiry.created` incluye `userThanksSubject` y `userThanksBody` de los settings del tenant para que el listener los use al enviar el acuse.
- ✅ `replyToEmail` configurable: si el admin del tenant responde al acuse, el Reply-To apunta al buzón correcto.
- ❌ Suscriptor en `platform/notifications` que materialice el envío del "gracias" al visitante (gap análogo al anterior).
- ❌ Plantillas de acuse multi-idioma (hoy un solo texto plano por tenant).
- ❌ Acuse HTML (hoy solo texto plano) — branded con logo/colores del tenant.
- ❌ Confirmación de email con enlace (double opt-in) antes de persistir la consulta como válida.
- ❌ Acuse con enlace de seguimiento (el visitante puede consultar el estado de su INQ-* en un portal público).
- ❌ Acuse de cambio de estado: notificar al visitante cuando pasa a `contacted` o `closed`.

## 5. Configuración por-tenant (settings)

- ✅ `contact_inbox_email` (obligatorio): destino del email-alerta al admin.
- ✅ `reply_to_email` (opcional, default = `contact_inbox_email`): Reply-To del acuse al visitante.
- ✅ `user_thanks_subject` y `user_thanks_body`: override del asunto y cuerpo del acuse por app/tenant.
- ✅ Admin PUT idempotente (`ON CONFLICT DO UPDATE`) — el tenant puede actualizar settings sin duplicados.
- ✅ RLS en `settings`: cada admin solo puede leer/escribir la configuración de su propio tenant.
- ❌ Configuración de SLA (tiempo máximo en `new` antes de alerta, en horas).
- ❌ Horario de recepción (fuera de horario → acuse diferente o enrutado distinto).
- ❌ Categorías / departamentos configurables por tenant (p. ej. "ventas", "soporte", "facturación") para routing.
- ❌ Múltiples bandejas por tenant (una por departamento, cada una con su `contact_inbox_email` distinto).
- ❌ Firma de email del acuse personalizada por tenant.
- ❌ CC automático a emails adicionales del tenant en cada nueva consulta.

## 6. Ciclo de vida / FSM de estados

- ✅ Estados: `new → contacted → closed` y `new|contacted → spam`.
- ✅ Terminales: `closed` y `spam` no aceptan más transiciones de estado.
- ✅ Stamps: `contacted_at` (primera vez que se transiciona a `contacted`) y `closed_at` (primera vez que se alcanza `closed` o `spam`), protegidos con `COALESCE(…, now())`.
- 🔧 `closed` no distingue "resuelto" (satisfactoriamente atendida) de "archivada sin responder" ni de "cerrada sin solución".
- ❌ Estado `resolved` separado de `closed` (el visitante confirmó que quedó satisfecho).
- ❌ Estado `pending_user` (esperando respuesta del visitante) / `pending_staff` — hilos en V2.
- ❌ Historial de transiciones de estado (audit log: quién, cuándo, de qué a qué).
- ❌ Reapertura de consultas cerradas (p. ej. el visitante vuelve a escribir sobre el mismo asunto).
- ❌ Motivo de cierre (`close_reason`: resuelto, sin respuesta, spam confirmado, duplicado, derivado…).
- ❌ Snooze / "recordar el…": aplazar una consulta a una fecha futura.

## 7. Bandeja de entrada y gestión por el admin

- ✅ List con filtro por `status` y paginación (`limit`, `offset`).
- ✅ Get por `id` — detalle completo de la consulta.
- ✅ Patch: cambio de estado (FSM validada) y actualización de `staff_notes`.
- 🔧 `staff_notes` es un campo de texto plano único y se sobrescribe en cada PATCH — no hay histórico de notas ni autoría.
- ❌ Búsqueda full-text (nombre, email, mensaje, referencia).
- ❌ Filtros combinados: por `source`, rango de fechas, email del visitante, sub_tenant_id, categoría/departamento.
- ❌ Ordenación configurable (por fecha, por estado, por SLA).
- ❌ Tabla de notas internas (`inquiry_notes`) con autor, fecha y texto — sustituir `staff_notes` plano.
- ❌ Acciones masivas: bulk update de estado, bulk assign, bulk export, bulk delete/spam.
- ❌ Etiquetas/tags libres por consulta.
- ❌ Vista de detalle con timeline de actividad (cambios de estado, notas, emails enviados).
- ❌ Marcar como leída / sin leer (badge de consultas no vistas por el admin).
- ❌ Respuesta en-plataforma desde la bandeja (V2 — hoy el admin responde desde su buzón personal).

## 8. Hilos / conversación in-plataforma (V2)

- 🔧 Réplicas del visitante **por email** ya se capturan en-plataforma: el acuse lleva Reply-To `reply+<token>@…` (inbound de notifications) y la respuesta entra al timeline como activity `email_reply` con adjuntos referenciados en S3 (migración 0003 + `event-consumer.js`); el admin recibe alerta con Reply-To al visitante. Sin tabla `inquiry_messages` dedicada ni respuestas del admin en-plataforma (V2).
- ❌ Portal público del visitante: acceso por referencia + email para ver el hilo y responder.
- ❌ Notificación al visitante cada vez que el admin añade un mensaje al hilo.
- ❌ Cierre del hilo por el admin o por el visitante (con CSAT opcional).
- ❌ Adjuntos en el hilo (REUSE `platform/storage` para URLs pre-firmadas).
- ❌ Mención a otros miembros del staff del tenant dentro del hilo (`@usuario`).
- ❌ Escalado a `platform/chat` support cuando la consulta requiere atención en tiempo real.

## 9. Asignación y enrutamiento

- ❌ `assigned_to` — asignar la consulta a un miembro del staff del tenant.
- ❌ Auto-asignación por round-robin / carga / disponibilidad del staff.
- ❌ Enrutado por categoría/departamento (ej. `subject='facturación'` → equipo de administración).
- ❌ Reglas de enrutado configurables por tenant (palabras clave → bandeja destino).
- ❌ Bandeja "mis consultas" vs "todas" (filtrado por `assigned_to = yo`).
- ❌ Reasignación con notificación al staff nuevo.
- ❌ Escalado a admin superior cuando el staff no responde en el SLA.

## 10. Adjuntos

- ❌ Adjuntos del visitante al enviar la consulta (p. ej. capturas de pantalla, documentos) — REUSE `platform/storage` URLs pre-firmadas.
- ❌ Adjuntos del admin al responder (en V2 con hilos in-plataforma).
- ❌ Límite de tamaño y tipos permitidos configurable por tenant.
- ❌ Escáner antivirus básico antes de persistir adjuntos.

## 11. Conversión a lead / ticket

- ❌ Conversión de consulta a lead en `platform/leads` (cuando la consulta tiene intención comercial) con trazabilidad `inquiry_id → lead_id`.
- ❌ Conversión a ticket de soporte si el tenant usa un helpdesk externo (Zendesk, Freshdesk, webhook).
- ❌ Vinculación con usuario registrado del tenant (si el visitante ya tiene cuenta, asociar `user_id`).
- ❌ Detección de consultas duplicadas del mismo email (alertar al admin, no crear una segunda).

## 12. Plantillas y macros

- ✅ `user_thanks_subject` / `user_thanks_body` en settings — override básico del acuse por tenant.
- ❌ Biblioteca de macros/respuestas enlatadas por tenant para responder rápido desde la bandeja.
- ❌ Variables de sustitución en plantillas (`{{contactName}}`, `{{reference}}`, `{{tenantName}}`…).
- ❌ Plantillas multi-idioma (selección automática por idioma detectado del visitante).
- ❌ Historial de macros usadas (analítica de consultas recurrentes → FAQ).

## 13. SLA y alertas operativas

- ❌ SLA configurable por tenant: tiempo máximo permitido en `new` sin transicionar a `contacted` (en horas).
- ❌ Job en `platform/scheduler`: `inquiry-sla` — publicar `inquiry.sla_breached` cuando una consulta supera el SLA (análogo al `dispute-sla` existente).
- ❌ Alerta al admin cuando se incumple el SLA (REUSE `platform/notifications`).
- ❌ Visualización del SLA en la bandeja (badge rojo/amarillo/verde por tiempo transcurrido).
- ❌ Métricas de cumplimiento de SLA por tenant y por periodo.

## 14. Anti-abuso (detallado)

- ✅ Captura de `ip` + `user_agent` para triaje manual.
- ✅ Estado `spam` con transición desde `new` o `contacted` — el admin puede marcar manualmente.
- ✅ Rate limiting por IP a nivel de Fastify (override por ruta: 5/min sobre el plugin global).
- ❌ Rate limiting por `(app_id, tenant_id)` para proteger la bandeja de un tenant frente a flood.
- ❌ CAPTCHA / Turnstile en el payload (token verificado en el servidor antes de persistir).
- ✅ Honeypot field `website`: campo oculto en el form; si llega con valor → descarte silencioso con 201 indistinguible del real.
- ❌ Lista negra de IPs / dominios de email bloqueados por tenant o globalmente.
- ❌ Lista negra de palabras/patrones en el mensaje.
- ❌ Auto-spam: clasificación automática y transición directa a `spam` si supera umbral de score.
- ❌ Cuarentena: estado `quarantine` invisible al visitante, revisable por el admin antes de `new`.

## 15. Analítica y reporting

- ❌ Volumen de consultas por tenant / por app_id / por periodo.
- ❌ Distribución por estado, fuente y categoría.
- ❌ Tiempo medio de primera respuesta (MTR) y tiempo medio de resolución (MTTR).
- ❌ Tasa de consultas marcadas como spam.
- ❌ Evolución temporal (series) de consultas recibidas — detección de picos.
- ❌ Export CSV/XLSX de consultas filtradas para análisis externo.
- ✅ CSAT (Customer Satisfaction Score) al cerrar — el visitante puntúa la atención recibida vía `POST /v1/inquiries/csat` (público, capability check `reference` + `email`); solo sobre `resolved|closed`, una sola vez; publica `inquiry.csat_submitted`. La media (`avg_csat`) ya entra en analítica.
- ❌ Dashboard por tenant en la consola admin.

## 16. Integración con otros módulos de la plataforma

- ✅ `platform/notifications` — evento `inquiry.created` publicado en `platform.events` (listener pendiente de implementar en notificaciones).
- ❌ `platform/chat` — escalado de una consulta a un chat de soporte en tiempo real (REUSE canal support).
- ❌ `platform/leads` — conversión de consulta a lead cuando hay intención comercial.
- ❌ `platform/scheduler` — job `inquiry-sla` para alertas de SLA (REUSE patrón `dispute-sla`).
- 🔧 `platform/scheduler` — job `inquiry-retention-purge` para GDPR: la lógica (`purgeRetention`) ya existe en el módulo; falta el job que la invoque por tenant.
- ❌ `platform/storage` — adjuntos del visitante y del admin via URLs pre-firmadas.
- ❌ `platform/auth` — vincular consulta a usuario existente del tenant si el email coincide.

## 17. Compliance / privacidad (GDPR, LOPDGDD)

- ✅ `ip` e `user_agent` almacenados — deben tratarse como PII bajo el RGPD.
- ❌ Consentimiento explícito (checkbox, texto de política, versión, timestamp) en el form público — obligatorio bajo LOPDGDD para tratar datos del visitante.
- ❌ Base legal y registro de la finalidad del tratamiento.
- ❌ Derecho de acceso: el visitante puede pedir ver sus consultas (con verificación por email + referencia).
- ❌ Derecho de supresión (right to be forgotten): borrar / anonimizar datos del visitante bajo petición.
- ❌ Portabilidad: exportar datos de un visitante en formato legible.
- 🔧 Retención y purga automática: `inquiries.service.purgeRetention(identity)` anonimiza las consultas más viejas que `retention_days` (config del tenant) y publica `inquiry.retention_purged`. Cross-cutting pendiente: job `inquiry-retention-purge` en `platform/scheduler` que lo invoque por tenant.
- ✅ Anonimización de `ip`, `email`, `contactName`, `phone`, `message`, `metadata` al purgar — conserva solo datos analíticos agregados (`anonymize()`).
- ❌ Audit log de quién accede y exporta PII de consultas (qué admin, cuándo, qué ids).
- ❌ Gestión de supresión / do-not-contact: si el visitante ha pedido no ser contactado, rechazar futuros envíos.

## 18. Datos y modelo (extensiones pendientes)

- 🔧 `staff_notes` campo de texto plano único y sin autoría — sustituir por tabla `inquiry_notes (id, inquiry_id, author_user_id, body, created_at)`.
- 🔧 `closed` no distingue "resuelto" de "archivado" — añadir `close_reason TEXT CHECK(…)`.
- ❌ `assigned_to UUID REFERENCES platform_auth.users(id)` — asignación a staff.
- ❌ `category TEXT` / `department TEXT` — para routing configurable.
- ❌ `tags TEXT[]` — etiquetas libres.
- ❌ `sla_deadline TIMESTAMPTZ` — calculado al crear según settings del tenant.
- ❌ `sla_breached_at TIMESTAMPTZ` — stamp cuando se supera el SLA.
- ✅ `csat_score SMALLINT CHECK (1..5)`, `csat_comment`, `csat_submitted_at` — valoración del visitante (sellada una sola vez vía `submitCsat`).
- ❌ `user_id UUID` — vinculación con usuario registrado del tenant.
- ❌ `lead_id UUID` — FK a `platform_leads.leads` si la consulta se convierte a lead.
- ❌ `consent_text TEXT`, `consent_version TEXT`, `consent_at TIMESTAMPTZ` — campos GDPR.
- ❌ Tabla `inquiry_status_history (id, inquiry_id, from_status, to_status, changed_by, changed_at)`.
- ❌ Tabla `inquiry_messages (id, inquiry_id, author_type, author_user_id, body, sent_at)` — V2 hilos.
- ❌ Tabla `inquiry_attachments (id, inquiry_id, message_id, storage_key, filename, mime_type, size_bytes)`.
- ❌ Soft-delete (`deleted_at`) en lugar de borrado físico — necesario para GDPR/auditoría.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Anti-abuso del endpoint público** (rate-limit por IP + honeypot) — riesgo inmediato y coste mínimo; Fastify ya tiene el plugin instalado en otros módulos.
2. **Suscriptor `inquiry.created` en `platform/notifications`** — materializar el email-alerta al admin y el acuse al visitante; el evento ya se publica, solo falta el listener.
3. **Tabla `inquiry_notes`** + `close_reason` — operativa de soporte básica; sustituye `staff_notes` plano sin breaking.
4. **Consentimiento GDPR** en el body del `POST` público — obligatorio en España/UE; campo `consent_*` + validación.
5. **Búsqueda + filtros combinados** en la bandeja admin (full-text + fuente + fecha) — mejora inmediata de la UX de gestión.
6. **SLA configurable + job `inquiry-sla` en `platform/scheduler`** — REUSE directo del patrón `dispute-sla`; desbloquea métricas de respuesta.
7. **Hilos in-plataforma (V2)**: tabla `inquiry_messages` + portal de seguimiento para el visitante — cierra la brecha principal frente a un helpdesk real.
8. **Asignación (`assigned_to`) + routing por categoría** — necesario cuando el tenant tiene varios miembros de staff.
9. ~~**Retención/purga automática** vía `platform/scheduler` + anonimización — RGPD/LOPDGDD; patrón ya existente en el scheduler.~~ 🔧 Lógica de purga (`purgeRetention` + `anonymize`) implementada backend; falta el job en `platform/scheduler` (cross-cutting).
10. ~~**CSAT y analítica** — valor de negocio diferenciador.~~ ✅ CSAT público (`POST /v1/inquiries/csat`) + `avg_csat` en analítica implementados.
