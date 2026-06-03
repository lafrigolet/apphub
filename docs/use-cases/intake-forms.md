# Casos de uso — `platform/intake-forms` (platform-appointments)

> Dominio: formularios de admisión pre-cita — cuestionarios que el cliente rellena antes de una cita + firmas electrónicas (consentimientos informados). Los formularios se construyen como plantillas versionadas y se asignan a servicios del módulo `platform/services`; la relación con reservas proviene de `platform/bookings`. Datos de salud de categoría especial (art. 9 RGPD).

## Estado actual (implementado)

Plantillas versionadas con esquema JSONB libre (`code, name, description, schema, version, is_published, requires_signature`); publicación de plantillas; envíos (`submissions`) vinculados a `booking_id` y `client_user_id` con ciclo `pending → submitted → reviewed`; firma electrónica con `signature_url`/`signature_object_id` (REUSE `platform/storage`); guardado parcial de respuestas + envío final; revisión por practitioner; autocreación de submission al detectar `booking.confirmed`/`booking.requested` en servicios con `requires_intake_form = TRUE` vía Redis (cross-schema read a `platform_services`); eventos `intake.requested` e `intake.submitted`; exportación a PDF (`GET /submissions/:id/pdf`) con `@apphub/platform-sdk/simple-pdf`; RLS por `(app_id, tenant_id)` en ambas tablas.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Builder de formularios — gestión de plantillas

- ✅ Crear plantilla con `code`, `name`, `description`, `schema` (JSONB libre) y flag `requires_signature`.
- ✅ Listar plantillas del tenant (todas o solo publicadas con `onlyPublished=true`).
- ✅ Obtener plantilla por `id`.
- ✅ Publicar plantilla (`POST /templates/:id/publish`).
- 🔧 Versionado existe (`version INT`), pero publicar sobreescribe la misma fila — no hay bifurcación real de versiones ni historial inmutable de versiones publicadas.
- ❌ Borrador editable sin afectar la versión publicada activa (draft vs published split).
- ❌ Archivar/despublicar plantilla (flag `is_archived`); hoy solo `is_published`.
- ❌ Clonar plantilla (duplicar como nueva con `version=1`).
- ❌ Actualizar campos de la plantilla (PATCH); hoy solo se puede crear una nueva.
- ❌ Eliminar plantilla (soft-delete); no existe endpoint DELETE.

## 2. Tipos de campo en el schema del formulario

- 🔧 El campo `schema` es JSONB libre — la estructura de campos (tipo, etiqueta, clave, validación) no está normalizada ni validada por el servidor.
- ❌ Tipos de campo con semántica conocida: `text`, `textarea`, `number`, `date`, `select` (opción única), `multiselect` (opción múltiple), `radio`, `checkbox`, `scale`/`rating`, `file`, `signature`, `section-header`, `paragraph` (texto informativo), `yes_no`, `phone`, `email`.
- ❌ Propiedades de campo: `required`, `placeholder`, `min`/`max`, `options` (lista), `accept` (tipos MIME para file), `order`.
- ❌ Validación server-side de que las respuestas enviadas cumplen los campos requeridos según el schema.
- ❌ Campo de firma embebido como tipo de campo (`type: 'signature'`) diferenciado de `requires_signature` global.

## 3. Lógica condicional (show/hide)

- ❌ Reglas condicionales: mostrar/ocultar campo B si campo A tiene valor X.
- ❌ Secciones opcionales: rama del formulario activada por una respuesta anterior (ej. "¿tienes alergias?" → sección de alergias).
- ❌ Evaluación de condiciones en servidor al validar respuestas (para ignorar campos ocultos como no requeridos).
- ❌ Lógica de skip: saltar directamente al final si el cliente firmó consentimiento en una visita anterior.

## 4. Plantillas por servicio y tenant

- ✅ Plantillas aisladas por `(app_id, tenant_id)` con RLS — cada tenant gestiona sus propias.
- ✅ Asignación indirecta vía `platform_services.services.intake_form_id` (cross-schema read al confirmar reserva).
- 🔧 La asignación plantilla ↔ servicio vive en `platform/services`, no en `platform/intake-forms`; no hay endpoint propio para esta relación.
- ❌ Múltiples plantillas por servicio (ej. formulario inicial + consentimiento específico de sesión).
- ❌ Plantilla global de tenant (aplicable a todos los servicios salvo override).
- ❌ Plantillas de plataforma predefinidas (biblioteca de consentimientos legales reutilizables).
- ❌ Endpoint `GET /services/:id/intake-form` en el módulo de intake-forms para consultar directamente qué plantilla tiene asignada un servicio.

## 5. Asignación automática de formulario a una cita

- ✅ Suscripción a eventos `booking.confirmed` y `booking.requested` via Redis.
- ✅ Consulta cross-schema a `platform_services.services` para detectar `requires_intake_form` + `intake_form_id`.
- ✅ Creación automática de submission en estado `pending` vinculada al `booking_id` y `client_user_id`.
- ✅ Deduplicación: no se crea una segunda submission si ya existe una para ese `booking_id`.
- ✅ Publicación del evento `intake.requested` para que `platform/notifications` envíe el enlace al cliente.
- 🔧 Solo se escucha `booking.confirmed`/`booking.requested` — no se gestiona cancelación de reserva (¿debe cancelarse/anularse el formulario pendiente?).
- ❌ Asignación manual de formulario a una cita concreta sin evento (ej. staff añade ad-hoc).
- ❌ Formularios requeridos en rescheduling — la nueva cita no reutiliza ni solicita un nuevo formulario.
- ❌ Formulario requerido antes de confirmar la reserva (bloqueo pre-confirmación).

## 6. Envío al cliente — recordatorio y notificaciones

- ✅ Evento `intake.requested` publicado en `platform.events` para que `platform/notifications` construya el email con el enlace al formulario.
- ✅ Evento `intake.submitted` publicado al enviar respuestas.
- ❌ Implementación real del email de solicitud en `platform/notifications` (el evento existe; el handler de notificaciones debe crearse).
- ❌ Recordatorio automático si el formulario sigue en `pending` N horas antes de la cita (REUSE `platform/scheduler`; job `intake-reminder-pending`).
- ❌ Recordatorio de segundo aviso (T-1h) si aún no se ha completado.
- ❌ Notificación al practitioner cuando el cliente envía el formulario (`intake.submitted` → email/push al professional).
- ❌ Enlace con token firmado y de un solo uso para que el cliente acceda sin login (magic link).

## 7. Cumplimentación parcial y guardado en borrador

- 🔧 Existe un `POST /submissions` que crea la submission con `answers: {}` (vacío) y `POST /submissions/:id/submit` que hace el envío final; el cliente puede llamar a submit cuando quiera.
- ❌ Endpoint explícito `PATCH /submissions/:id/draft` para guardar respuestas parciales sin cambiar el estado a `submitted`.
- ❌ Guardado automático periódico (autosave) — el frontend tendría que implementarlo llamando a un endpoint de borrador.
- ❌ Indicador de progreso: porcentaje de campos completados respecto al schema.
- ❌ Retomar formulario donde se dejó: si el cliente cierra y vuelve, recuperar el estado parcial.

## 8. Firma electrónica y consentimiento informado

- ✅ Flag `requires_signature` en la plantilla.
- ✅ Campos `signature_url` (legacy) y `signature_object_id` (REUSE `platform/storage`) en la submission.
- ✅ `signed_at` se registra automáticamente al enviar `signatureUrl` o `signatureObjectId`.
- ✅ La firma queda vinculada a la submission enviada.
- 🔧 `signature_url` es texto libre — no hay validación de que sea un objeto real de `platform/storage`.
- ❌ Tipos de firma diferenciados: firma manuscrita digitalizada (canvas/SVG), firma typed (nombre escrito), firma con certificado digital (eIDAS).
- ❌ Múltiples firmas por formulario (ej. consentimiento + autorización de imágenes + política de cancelación).
- ❌ Firma del tutor/representante legal (menores, incapacitados).
- ❌ Timestamping externo o sello de tiempo cualificado (TSA) para validez legal reforzada.
- ❌ Audit trail de la firma: IP, user-agent, geolocalización en el momento de firma.

## 9. Validación y campos obligatorios

- 🔧 Validación de formato del body (Zod) para campos del sistema; no hay validación de las respuestas contra el schema del formulario.
- ❌ Validación server-side: comprobar que todos los campos `required: true` del schema tienen valor en `answers`.
- ❌ Bloquear el `submit` si faltan campos obligatorios, con lista de errores por campo.
- ❌ Validación de tipos: número en rango, fecha válida, longitud máxima de texto, formato de email/teléfono.
- ❌ Validación condicional: campo obligatorio solo si otro campo tiene cierto valor.

## 10. Respuestas almacenadas y vinculadas a la cita/cliente

- ✅ `answers` almacenado como JSONB en `submissions`.
- ✅ `booking_id` vinculado en la submission (nullable para formularios fuera de reserva).
- ✅ `client_user_id` en la submission.
- ✅ Obtener submission por `id` con toda la información.
- ❌ Listar submissions del tenant (staff): `GET /submissions?status=&clientUserId=&bookingId=&templateId=&from=&to=` con paginación.
- ❌ Listar submissions de un cliente concreto (historial del paciente/cliente).
- ❌ Listar submissions vinculadas a una reserva (`GET /bookings/:id/intake-submission` o similar).
- ❌ Búsqueda full-text en respuestas.
- ❌ Exportación masiva de submissions (CSV/XLSX) para informes clínicos o auditoría.

## 11. Historial de versiones del formulario

- 🔧 La tabla `templates` tiene columna `version` INT, pero publicar actualiza la misma fila — no hay snapshots históricos.
- ❌ Tabla `template_versions` o similar con snapshot inmutable de cada versión publicada.
- ❌ Cada submission referencia la versión exacta del template vigente en el momento del envío (no solo `template_id`).
- ❌ Comparar respuestas entre versiones distintas del mismo formulario.
- ❌ Migración de submissions abiertas (en `pending`) al publicar una nueva versión del template.
- ❌ Changelog por versión: qué campos se añadieron, modificaron o eliminaron.

## 12. Revisión por el practitioner

- ✅ `POST /submissions/:id/review` — transición a estado `reviewed` con `reviewed_by_user_id` y `reviewed_at`.
- 🔧 La revisión es una transición de estado simple; no hay comentarios, anotaciones ni campos de revisión.
- ❌ Notas de revisión: campo `review_notes TEXT` o tabla de anotaciones por campo.
- ❌ Solicitar corrección al cliente: devolver el formulario a `pending` con comentarios sobre qué corregir.
- ❌ Revisión parcial: marcar campos individuales como revisados o con observación.
- ❌ Notificación al cliente del resultado de la revisión.
- ❌ Vista de bandeja de formularios pendientes de revisar para el practitioner (filtro `status=submitted`).
- ❌ Asignación de revisión a un practitioner concreto (el que atiende la cita).

## 13. Datos clínicos sensibles — cifrado y RGPD/categoría especial

- 🔧 `answers` JSONB sin cifrado en reposo — los datos de salud (categoría especial, art. 9 RGPD) se guardan en texto plano en la BD.
- ❌ Cifrado en reposo de `answers` con `encryptSecret`/`decryptSecret` de `@apphub/platform-sdk/crypto` o cifrado a nivel de columna (pg_crypto).
- ❌ Base legal registrada para el tratamiento (`legal_basis`: consentimiento, ejecución de contrato médico, interés vital).
- ❌ Consentimiento explícito con texto + versión + timestamp antes de acceder al formulario (art. 7 RGPD).
- ❌ Derecho de acceso: endpoint para que el cliente descargue sus propias respuestas.
- ❌ Derecho de supresión: borrado/anonimización de respuestas a petición del cliente (mantener esqueleto de submission para auditoría).
- ❌ Portabilidad: exportación de datos del cliente en formato estructurado (JSON/PDF).
- ❌ Retención configurable por tenant (`retention_days`) + purga automática vía `platform/scheduler`.
- ❌ Audit log de acceso a submissions (quién y cuándo consultó datos de un cliente).
- ❌ Anonimización/pseudonimización de respuestas tras expirar la retención.
- ❌ DPA (Data Processing Agreement) registrado por tenant.

## 14. Adjuntos (REUSE `platform/storage`)

- ✅ Firma electrónica como objeto de storage (`signature_object_id` → `platform_storage.objects`).
- ❌ Adjuntos generales en respuestas: campo de tipo `file` que genera una URL prefirmada de upload vía `platform/storage` y almacena el `object_id` en `answers`.
- ❌ Múltiples adjuntos por submission (ej. foto de DNI, informe médico previo).
- ❌ Validación de tipo MIME y tamaño máximo al adjuntar.
- ❌ Vista previa de adjuntos en la interfaz de revisión del practitioner.
- ❌ Retención independiente de adjuntos (alineada con política de datos clínicos del tenant).

## 15. Reutilización de respuestas previas

- ❌ Detección de submissions anteriores del mismo cliente para el mismo template.
- ❌ Pre-relleno de respuestas invariantes (nombre, fecha de nacimiento, alergias conocidas) desde la última submission enviada.
- ❌ Flag `prefill_from_previous: true` en la plantilla para activar el pre-relleno.
- ❌ Interfaz al cliente para confirmar qué datos previos mantiene y cuáles actualiza.
- ❌ Campo `source_submission_id` en la submission nueva para trazar de dónde vienen las respuestas heredadas.

## 16. Exportación y PDF

- ✅ `GET /submissions/:id/pdf` — genera PDF con `@apphub/platform-sdk/simple-pdf` (texto plano, Helvetica, multipágina).
- ✅ Incluye nombre del template, versión, `booking_id`, estado, fecha de envío y pares clave-valor de respuestas.
- ✅ Referencia a `signature_object_id` en el PDF si existe firma.
- 🔧 PDF de texto plano — sin estilos, logo del tenant ni imagen de firma incrustada.
- ❌ PDF con logo/cabecera del tenant (REUSE tenant-config para datos visuales).
- ❌ Imagen de firma incrustada en el PDF (descargar el objeto de storage y embeber).
- ❌ PDF con layout de formulario (preguntas y respuestas con formato, secciones, colores).
- ❌ Exportación masiva: ZIP de PDFs para un rango de fechas/servicio/practitioner.
- ❌ Generación asíncrona de PDF para submissions grandes (cola + notificación de descarga lista).

## 17. Plantillas legales y de consentimiento

- ❌ Biblioteca de plantillas legales predefinidas por tipo de servicio (fisioterapia, psicología, medicina estética…) reutilizables entre tenants.
- ❌ Plantillas de consentimiento con texto legal fijo (no editable) + campos de firma y fecha.
- ❌ Versionado con referencia normativa (LOPDGDD, Ley 41/2002 de autonomía del paciente, etc.).
- ❌ Validación de que la plantilla contiene al menos un campo de firma cuando `requires_signature = true`.
- ❌ Exportación de la plantilla en sí (sin respuestas) como PDF para entregar al cliente antes de firmar.

## 18. Multi-idioma

- ❌ Campo `locale` / `translations` en la plantilla para nombre, descripción y etiquetas de campos en varios idiomas.
- ❌ Selección de idioma al renderizar el formulario según el locale del cliente (`Accept-Language` o perfil).
- ❌ Respuestas en el idioma del cliente pero revisadas en el idioma del practitioner.
- ❌ PDF generado en el idioma del cliente o del tenant (configurable).

## 19. Multi-tenant y configuración por tenant

- ✅ Aislamiento completo por `(app_id, tenant_id)` + RLS en templates y submissions.
- ❌ Configuración de retención de datos clínicos por tenant (`retention_days`).
- ❌ Flag por tenant para exigir firma en todos los formularios independientemente de la plantilla.
- ❌ Branding del tenant en el formulario (logo, colores, pie con datos del centro).
- ❌ Dominio propio del portal de formularios por tenant (ej. `formularios.clinica-X.com`).

## 20. Integración con telehealth

- ❌ Envío del formulario como requisito pre-sesión de telehealth: el link de videollamada solo se activa cuando `status = 'submitted'`.
- ❌ Evento `intake.submitted` consumido por `platform/telehealth` para desbloquear la sala.
- ❌ Embedding del formulario dentro de la sala de espera virtual del portal de telehealth.
- ❌ Compartir en tiempo real las respuestas del formulario con el practitioner durante la videollamada.

## 21. Admin UX / operación del staff

- ✅ `GET /submissions/:id` — detalle de una submission individual.
- ✅ `POST /submissions/:id/review` — marcar como revisado.
- ❌ `GET /submissions` — listado con filtros (`status`, `templateId`, `clientUserId`, `bookingId`, fechas) y paginación.
- ❌ `GET /submissions` para cliente autenticado — solo sus propias submissions.
- ❌ Dashboard de staff: submissions pendientes de revisión, tasa de completado, tiempo medio de respuesta.
- ❌ Acciones masivas: marcar como revisadas varias submissions a la vez.
- ❌ Búsqueda de submissions por respuesta (full-text en JSONB).
- ❌ Vista integrada reserva-formulario: desde el detalle de una cita ver el formulario asociado.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Cifrado de `answers` en reposo** — los datos de salud son categoría especial (art. 9 RGPD); cifrar con `encryptSecret` de `@apphub/platform-sdk/crypto` es obligatorio antes de producción clínica.
2. **Listado de submissions para staff** (`GET /submissions` con filtros + paginación) — sin esto el módulo no es operable desde el panel de administración.
3. **Recordatorio automático vía `platform/scheduler`** — job `intake-reminder-pending` que publique `intake.reminder.due` para formularios en `pending` a T-24h y T-2h de la cita; REUSE directo del patrón `booking-reminders`.
4. **Validación server-side de respuestas obligatorias** — bloquear `submit` si el schema del template tiene campos `required` vacíos; evita formularios incompletos que llegan a revisión.
5. **Consentimiento explícito RGPD + derecho de supresión** — texto/versión/timestamp antes de rellenar + endpoint de borrado/anonimización; obligatorio para datos de salud.
6. **Versionado real de plantillas** — snapshot inmutable al publicar + referencia de versión en cada submission; imprescindible para auditoría clínica y trazabilidad legal.
7. **Pre-relleno de respuestas previas** — alto valor para clientes recurrentes (no repetir datos demográficos/alergias); moderado coste con `findSubmissionByClientUserId` + merge de answers.
8. **PDF mejorado con imagen de firma** — descargar el objeto de `platform/storage` y embeber en el PDF; el esqueleto ya existe, solo falta la integración de imagen.
9. **Adjuntos en respuestas** (tipo campo `file` + presigned URL de `platform/storage`) — necesario para informes médicos previos, DNI/NIE, etc.
10. **Integración con telehealth** (`intake.submitted` desbloquea la sala) — bajo coste (subscribirse al evento en `platform/telehealth`), alto impacto en flujo de consulta online.
