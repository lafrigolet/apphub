# Casos de uso — `platform/leads` (platform-core)

> Dominio: captación de prospectos desde el formulario de contacto público de la landing + CRM de leads para staff. Sin aislamiento por tenant (los leads existen *antes* de que el prospecto sea tenant).

## Estado actual (implementado)

Captura pública vía formulario (`POST /`) con datos de contacto + UTM/referrer/landing + consentimiento LOPDGDD + `app_id` de origen; anti-abuso (rate-limit 5/min + honeypot); ciclo de estado `new → contacted → qualified → won|lost` (`lost` exige `lost_reason`; `closed` legacy); asignación a staff (`assigned_to`), score, tags, custom_fields y snooze (`next_follow_up_at`); timeline `lead_activities` con autor (notas, llamadas, emails, reuniones + transiciones y asignaciones automáticas); admin list con filtros combinados + búsqueda + ordenación, get, patch, `GET/POST /:id/activities`, `POST /:id/convert` (trazabilidad `lead_id → tenant_id`) y `DELETE /:id` (GDPR); auto-respuesta al prospecto vía notifications (`lead.acknowledged`); purga de retención (`lead-retention-purge`, 3 años por defecto); eventos `lead.created/status_changed/assigned/converted/deleted`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Captura / ingestión

- ✅ Alta desde formulario de landing público (`source: 'landing-modal'`, `'demo-cta'`…)
- 🔧 `source` libre — falta vocabulario controlado / catálogo de fuentes.
- ❌ Múltiples formularios/campañas con esquemas de campos distintos (form builder).
- 🔧 Captura desde otros canales: **email entrante ✅** (`lead.email.received` desde `platform/notifications` inbound — regla `leads@…` → lead con `source: 'email-inbound'`, asunto+texto como mensaje, rate-limit por remitente aguas arriba); chat/widget, llamada entrante, WhatsApp, evento/feria, webinar siguen ❌.
- ❌ Importación masiva (CSV/XLSX) con mapeo de columnas y dry-run.
- ❌ API/SDK pública para que apps externas o partners empujen leads.
- 🔧 Atribución de origen por `app_id` en el alta (la captura sigue siendo global, sin aislamiento por tenant).
- 🔧 `custom_fields JSONB` en el alta (sin form builder por campaña).
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

- 🔧 Estado `qualified` existe; `score` 0-100 disponible, sin criterios automáticos.
- ❌ Lead scoring (puntuación por fit + engagement).
- ❌ Marcado MQL/SQL (marketing-qualified / sales-qualified).
- ❌ Captura de presupuesto, tamaño, urgencia, caso de uso (campos de cualificación).
- ✅ Marcado de descalificación con motivo (`lost_reason`, obligatorio al pasar a `lost`).

## 6. Ciclo de vida / pipeline

- ✅ Estados `new → contacted → qualified → won | lost` (+ `closed` legacy).
- ✅ `won`/`lost` distinguen el cierre; `lost` exige motivo.
- ❌ Etapas de embudo configurables (pipeline kanban) más allá de 4 estados fijos.
- ✅ Motivo de pérdida (`lost_reason`).
- ✅ Historial de transiciones de estado (`lead_activities` type `status_change` con autor y from/to).
- ✅ SLA de primer contacto (lead `new` sin tocar > `LEADS_NEW_SLA_HOURS` →
  evento `lead.sla.uncontacted`, job `lead-sla`). SLA por cada etapa restante
  pendiente.
- ✅ Reapertura de leads cerrados (PATCH a cualquier estado, queda auditado en el timeline).
- ✅ Snooze / "volver a contactar el …" (`next_follow_up_at` + filtro `followUpDue`).

## 7. Asignación y enrutamiento

- ✅ Asignación a un comercial/staff (owner) con `assigned_to` (+ activity `assignment` + evento `lead.assigned`).
- ❌ Round-robin / reparto por carga / por territorio / por industria / por idioma.
- 🔧 Reasignación manual (PATCH); sin reglas de escalado.
- ✅ Bandeja "mis leads" vs "todos" (`?assignedTo=me|none|<uuid>`).
- ❌ Enrutado por `app_id`/`industry` al equipo correspondiente.

## 8. Comunicación / outreach

- ✅ Notificación interna a staff vía evento `lead.created` (→ módulo notifications).
- ✅ Auto-respuesta / acuse al prospecto (consumer `lead.created` → plantilla `lead.acknowledged` es/en).
- ❌ Envío de emails al lead desde el propio módulo (REUSE `platform/notifications`).
- ❌ Plantillas de respuesta (macros) y secuencias.
- ✅ Registro de actividad: notas, llamadas, emails, reuniones (`lead_activities` + endpoints del timeline).
- ❌ Programar reunión/demo (REUSE `platform/bookings`/`availability`).
- ❌ Integración de chat con el lead (REUSE `platform/chat` modalidad support).

## 9. Nurturing / automatización

- ❌ Secuencias de drip-email automáticas.
- ❌ Workflows por evento (si `industry=restaurant` → plantilla X).
- ✅ Recordatorios automáticos de follow-up (`platform/scheduler` job
  `lead-followup-due` → `lead.followup.due` al vencer `next_follow_up_at`).
- ✅ Alerta de leads "estancados" sin actividad N días (job `lead-sla` →
  `lead.stale`, ventana `LEADS_STALE_DAYS`).
- ❌ Re-engagement de leads fríos.

## 10. Conversión a tenant/cliente

- ✅ Eventos `lead.created/status_changed/assigned/converted/deleted` publicados.
- ❌ Convertir lead → tenant/app (provisión vía `platform/tenant-config`).
- ❌ Generar invitación/onboarding al cerrar como ganado (REUSE `platform/auth`).
- ✅ Vincular `lead_id` al `tenant_id` resultante (`POST /:id/convert` → `converted_tenant_id` + status `won`, one-shot con 409).
- ❌ Métricas de conversión lead→tenant.

## 11. Analítica y reporting

- ✅ Embudo de conversión por etapa (`GET /admin/analytics/funnel`: recuento por
  estado + hitos alcanzados desde el timeline).
- ✅ Tasas new→contacted→qualified→won y tiempo medio hasta cada hito (desde el
  alta, vía `lead_activities`).
- ✅ Leads por fuente / campaña / industria / app
  (`GET /admin/analytics/by-dimension`) + periodo (`createdFrom`/`createdTo`).
- ✅ Productividad por comercial (`GET /admin/analytics/by-owner`).
- 🔧 Export CSV de leads filtrados (`GET /admin/analytics/export.csv`);
  dashboards UI pendientes (los datos ya se sirven por API).
- ✅ Tendencia temporal (`GET /admin/analytics/timeseries?granularity=day|week|month`);
  cohortes avanzadas pendientes.

## 12. Atribución y marketing

- ✅ `source` + `app_id` de origen (single-touch).
- ✅ UTM completos (`utm_source/medium/campaign/term/content`) capturados en el alta.
- 🔧 Referrer + landing URL (first-touch); sin last/multi-touch.
- ❌ Click ID (gclid/fbclid) y `cookie/session id` para attribution.
- ❌ Integración con Google Ads / Meta (conversiones offline).

## 13. Compliance / privacidad (GDPR, España/UE)

- ✅ Consentimiento explícito (`consent_text/version/at` sellado en el alta) — LOPDGDD.
- ❌ Base legal y registro de finalidad del tratamiento.
- 🔧 Borrado (right to be forgotten): `DELETE /:id` físico con cascade; acceso/portabilidad pendientes.
- ✅ Retención y purga automática (`lead-retention-purge` diario: borra won/lost/closed > `LEADS_RETENTION_DAYS`, default 3 años).
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
- ✅ Atribución opcional de lead a `app_id` (¿de qué portal vino?).
- ❌ Leads de un tenant existente (cross-sell/up-sell) vs leads de adquisición de plataforma — distinguir ámbitos.
- ❌ Visibilidad/permiso de leads por equipo/app.

## 16. Notificaciones internas

- ✅ Evento `lead.created` (best-effort, no bloquea el alta).
- ❌ Notificación de cambio de estado, asignación, SLA incumplido, lead sin tocar 24h.
- ❌ Resumen diario/semanal de leads al equipo.
- ❌ Preferencias de notificación por comercial.

## 17. Admin UX / operación

- ✅ List (filtro estado + paginación), get, patch (estado + notas).
- ✅ Búsqueda (`?q=` ILIKE sobre nombre/email/empresa/mensaje).
- ✅ Filtros combinados (estado, fuente, industria, fechas, owner, tag, app, follow-up due).
- 🔧 Ordenación configurable (`sort`/`dir`); vista kanban pendiente (UI).
- ❌ Acciones masivas (bulk update/assign/delete/export).
- ✅ Etiquetas/tags libres (`tags TEXT[]` + filtro).
- 🔧 Timeline de actividad por API (`GET /:id/activities`); vista UI pendiente.
- ✅ Notas con autor y fecha (`lead_activities` type `note`; `staff_notes` queda como legacy).

## 18. Datos y modelo

- ✅ Tabla de notas/actividad (`lead_activities`); `staff_notes` se conserva como legacy.
- ✅ `assigned_to`, `score`, `lost_reason`, `tags`, `custom_fields JSONB`, `utm_*`, `consent_*`, `converted_tenant_id`, `app_id`, `next_follow_up_at`, `updated_at`.
- ✅ Tabla `lead_activities` (timeline; las transiciones de estado viven ahí como type `status_change`).
- ❌ Soft-delete + auditoría.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ✅ ~~**Anti-abuso del endpoint público**~~ (rate-limit + honeypot; CAPTCHA pendiente).
2. ✅ ~~**Auto-respuesta al lead**~~ (`lead.acknowledged` es/en vía notifications).
3. ✅ ~~**Modelo de actividad**~~ (`lead_activities` con autor; transiciones auditadas).
4. ✅ ~~**Asignación + búsqueda + filtros**~~ (`assigned_to`, `?q=`, filtros combinados, `me|none`).
5. ✅ ~~**Atribución UTM + won/lost + `lost_reason`**~~.
6. ✅ ~~**GDPR**~~ (consentimiento sellado + `lead-retention-purge` + `DELETE /:id`; acceso/portabilidad pendientes).
7. ✅ ~~**Conversión lead → tenant**~~ (`POST /:id/convert`, falta automatizar la provisión vía `tenant-config`).
8. **Lead scoring automático** y enrichment — refinamiento posterior.
9. **Vistas UI en consola** (kanban, timeline, bandejas) — el API ya lo soporta.
10. ✅ ~~**Analítica de embudo**~~ (funnel, by-dimension, by-owner, timeseries,
    export CSV); dashboards UI pendientes.
