# Casos de uso — `platform/leads` (platform-core)

> Dominio: captación de prospectos desde el formulario de contacto público de la landing + CRM de leads para staff. Sin aislamiento por tenant (los leads existen *antes* de que el prospecto sea tenant).

## Estado actual (implementado)

Captura pública vía formulario (`POST /`) con `contact_name, email, business_name, phone, industry, message, source, ip, user_agent`; ciclo de estado `new → contacted → qualified → closed`; `staff_notes`; admin list (filtro por estado + paginación), get y patch; guard `super_admin|staff`; evento `lead.created` en `platform.events`; índices por `(status, created_at)` y `lower(email)`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Captura / ingestión

- ✅ Alta desde formulario de landing público (`source: 'landing-modal'`, `'demo-cta'`…)
- 🔧 `source` libre — falta vocabulario controlado / catálogo de fuentes.
- ❌ Múltiples formularios/campañas con esquemas de campos distintos (form builder).
- ❌ Captura desde otros canales: chat/widget, llamada entrante, email entrante (`leads@…`), WhatsApp, evento/feria, webinar.
- ❌ Importación masiva (CSV/XLSX) con mapeo de columnas y dry-run.
- ❌ API/SDK pública para que apps externas o partners empujen leads.
- ❌ Captura vía landing por-tenant/por-app (hoy es global) — leads atribuibles a un `app_id` concreto.
- ❌ Campos personalizados (custom fields / metadata JSONB) por campaña.
- ❌ Doble opt-in / confirmación de email antes de considerarlo lead válido.

## 2. Validación, calidad y anti-abuso

- ✅ Captura de `ip` y `user_agent` para triaje de abuso.
- ✅ Validación de formato (Zod: email, longitudes, enum industry).
- ✅ Rate limiting por IP en el endpoint público (override por ruta de `@fastify/rate-limit`: 5/min por IP; `trustProxy` activado para que `req.ip` sea la IP real tras NGINX/Cloudflare).
- 🔧 Honeypot `website` implementado (201 fake sin persistir); CAPTCHA/hCaptcha/Turnstile pendientes.
- ❌ Validación de email real (MX check, desechables/disposable, role-based `info@`).
- ❌ Validación/normalización de teléfono (E.164, país).
- ❌ Detección de spam por contenido (heurísticas, listas negras, scoring).
- ❌ Bloqueo por IP / dominio / patrón.
- ❌ Cuarentena / cola de revisión para leads sospechosos.

## 3. Enriquecimiento (enrichment)

- ❌ Enriquecimiento de empresa desde dominio del email (tamaño, sector, web).
- ❌ Geolocalización por IP (país/región/ciudad).
- ❌ Detección de país/idioma para enrutado y localización de respuestas.
- ❌ Enlace a redes sociales / LinkedIn.
- ❌ Normalización de `business_name` y `industry` (taxonomía).

## 4. Deduplicación e identidad

- ❌ Detección de duplicados (mismo email/teléfono/empresa) al crear.
- ❌ Merge de leads duplicados con historial consolidado.
- ❌ Reconocimiento de lead recurrente (mismo prospecto reenvía formulario).
- ❌ Vinculación lead ↔ usuario existente / lead ↔ tenant ya creado.
- ❌ Concepto de "cuenta/empresa" agrupando varios contactos (B2B).

## 5. Cualificación y scoring

- 🔧 Estado `qualified` existe pero sin criterios ni datos de apoyo.
- ❌ Lead scoring (puntuación por fit + engagement).
- ❌ Marcado MQL/SQL (marketing-qualified / sales-qualified).
- ❌ Captura de presupuesto, tamaño, urgencia, caso de uso (campos de cualificación).
- ❌ Marcado de descalificación con motivo (`lost_reason`).

## 6. Ciclo de vida / pipeline

- ✅ Estados `new → contacted → qualified → closed`.
- 🔧 `closed` no distingue ganado vs perdido.
- ❌ Etapas de embudo configurables (pipeline kanban) más allá de 4 estados fijos.
- ❌ Motivo de pérdida (`lost_reason`) y de ganancia.
- ❌ Historial de transiciones de estado (audit log con quién/cuándo).
- ❌ SLA por etapa (tiempo máximo en `new` sin contactar → alerta).
- ❌ Reapertura de leads cerrados.
- ❌ Snooze / "volver a contactar el …" (fecha de follow-up).

## 7. Asignación y enrutamiento

- ❌ Asignación a un comercial/staff (owner) con `assigned_to`.
- ❌ Round-robin / reparto por carga / por territorio / por industria / por idioma.
- ❌ Reasignación y reglas de escalado.
- ❌ Bandeja "mis leads" vs "todos".
- ❌ Enrutado por `app_id`/`industry` al equipo correspondiente.

## 8. Comunicación / outreach

- ✅ Notificación interna a staff vía evento `lead.created` (→ módulo notifications).
- ❌ Auto-respuesta / acuse al prospecto ("hemos recibido tu mensaje").
- ❌ Envío de emails al lead desde el propio módulo (REUSE `platform/notifications`).
- ❌ Plantillas de respuesta (macros) y secuencias.
- ❌ Registro de actividad: llamadas, emails, reuniones (timeline).
- ❌ Programar reunión/demo (REUSE `platform/bookings`/`availability`).
- ❌ Integración de chat con el lead (REUSE `platform/chat` modalidad support).

## 9. Nurturing / automatización

- ❌ Secuencias de drip-email automáticas.
- ❌ Workflows por evento (si `industry=restaurant` → plantilla X).
- ❌ Recordatorios automáticos de follow-up (REUSE `platform/scheduler` → `lead.followup.due`).
- ❌ Alerta de leads "estancados" sin actividad N días.
- ❌ Re-engagement de leads fríos.

## 10. Conversión a tenant/cliente

- 🔧 Evento `lead.created` publicado, pero sin flujo de conversión.
- ❌ Convertir lead → tenant/app (provisión vía `platform/tenant-config`).
- ❌ Generar invitación/onboarding al cerrar como ganado (REUSE `platform/auth`).
- ❌ Vincular `lead_id` al `tenant_id` resultante (trazabilidad de origen).
- ❌ Métricas de conversión lead→tenant.

## 11. Analítica y reporting

- ❌ Embudo de conversión por etapa.
- ❌ Tasas: new→contacted→qualified→won, tiempos medios por etapa.
- ❌ Leads por fuente / campaña / industria / app / periodo.
- ❌ Productividad por comercial.
- ❌ Dashboards y export (CSV) de leads filtrados.
- ❌ Cohortes y tendencia temporal.

## 12. Atribución y marketing

- 🔧 `source` libre (single-touch básico).
- ❌ UTM completos (`utm_source/medium/campaign/term/content`).
- ❌ Referrer, landing URL, first/last touch, multi-touch.
- ❌ Click ID (gclid/fbclid) y `cookie/session id` para attribution.
- ❌ Integración con Google Ads / Meta (conversiones offline).

## 13. Compliance / privacidad (GDPR, España/UE)

- ❌ Consentimiento explícito (texto, versión, timestamp) — LOPDGDD.
- ❌ Base legal y registro de finalidad del tratamiento.
- ❌ Derecho de acceso / borrado (right to be forgotten) / portabilidad.
- ❌ Retención y purga automática de leads antiguos (REUSE `platform/scheduler`).
- ❌ Anonimización/pseudonimización.
- ❌ Audit log de quién accede/exporta datos de leads (PII).
- ❌ Gestión de bajas / supresión (do-not-contact list).

## 14. Integraciones

- ❌ Webhooks salientes a CRM externo (HubSpot, Salesforce, Pipedrive).
- ❌ Sincronización bidireccional con CRM.
- ❌ Slack/Teams: notificación de nuevo lead a canal de ventas.
- ❌ Zapier / make.com.
- ❌ Email-to-lead (parseo de buzón).

## 15. Multi-app / multi-tenant

- 🔧 Hoy global (sin `app_id`/`tenant_id`) — correcto para captación pre-tenant.
- ❌ Atribución opcional de lead a `app_id` (¿de qué portal vino?).
- ❌ Leads de un tenant existente (cross-sell/up-sell) vs leads de adquisición de plataforma — distinguir ámbitos.
- ❌ Visibilidad/permiso de leads por equipo/app.

## 16. Notificaciones internas

- ✅ Evento `lead.created` (best-effort, no bloquea el alta).
- ❌ Notificación de cambio de estado, asignación, SLA incumplido, lead sin tocar 24h.
- ❌ Resumen diario/semanal de leads al equipo.
- ❌ Preferencias de notificación por comercial.

## 17. Admin UX / operación

- ✅ List (filtro estado + paginación), get, patch (estado + notas).
- ❌ Búsqueda full-text (nombre/email/empresa/mensaje).
- ❌ Filtros combinados (fuente, industria, fecha, owner, score).
- ❌ Ordenación configurable; vista kanban.
- ❌ Acciones masivas (bulk update/assign/delete/export).
- ❌ Etiquetas/tags libres.
- ❌ Vista de detalle con timeline de actividad.
- ❌ Notas con autor y fecha (hoy `staff_notes` es texto plano único, se sobrescribe).

## 18. Datos y modelo

- 🔧 `staff_notes` único campo de texto (se pisa) → debería ser tabla de notas/actividad.
- ❌ `assigned_to`, `score`, `lost_reason`, `tags`, `custom_fields JSONB`, `utm_*`, `consent_*`, `tenant_id_converted`, `app_id`.
- ❌ Tabla `lead_activities` (timeline) y `lead_status_history`.
- ❌ Soft-delete + auditoría.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Anti-abuso del endpoint público** (rate-limit + honeypot/CAPTCHA) — riesgo inmediato hoy.
2. **Auto-respuesta al lead** + notificación de cambio de estado — REUSE directo de `platform/notifications`.
3. **Modelo de actividad**: `lead_activities` + `lead_status_history` + notas con autor (sustituir `staff_notes` plano).
4. **Asignación (`assigned_to`) + búsqueda + filtros** — operativa de ventas básica.
5. **Atribución UTM + distinción won/lost + `lost_reason`** — desbloquea analítica de embudo.
6. **GDPR**: consentimiento + retención/purga vía `platform/scheduler` + borrado — obligatorio en España/UE.
7. **Conversión lead → tenant** con trazabilidad `lead_id → tenant_id` — cierra el ciclo con `tenant-config`/`auth`.
8. **Lead scoring** y enrichment — refinamiento posterior.
