# Casos de uso — `platform/resources` (platform-appointments)

> Dominio: recursos reservables — cualquier entidad que puede asignarse a una cita o sesión. Abarca cuatro tipos: `practitioner` (profesional/persona), `room` (sala), `equipment` (equipamiento) y `vehicle`. Incluye su horario semanal recurrente (`work_hours`), excepciones puntuales (`exceptions`) y la relación N:M con el catálogo de servicios que puede prestar cada recurso. Es la **fuente de verdad** que el motor de disponibilidad (`platform/availability`) consulta para calcular slots libres.

## Estado actual (implementado)

Alta/consulta de recursos con campos `kind`, `display_name`, `email`, `phone`, `bio`, `capacity`, `internal_rate_cents`, `is_active`, `metadata JSONB`, `user_id` y `sub_tenant_id`; RLS por `(app_id, tenant_id)`; relación N:M con servicios (`resource_services`); horario semanal recurrente por día de semana con `start_minute`/`end_minute` y ventana de validez (`effective_from`/`effective_until`); excepciones puntuales con tipos `vacation`, `sick`, `training`, `holiday`, `other`; evento Redis `resource.unavailable` al crear una excepción; filtrado por `kind` e `is_active`; `GET /v1/resources/by-service/:serviceId` para que `platform/availability` pida recursos habilitados para un servicio.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Alta y perfil básico del recurso

- ✅ Crear recurso con `kind` (`practitioner`, `room`, `equipment`, `vehicle`), `display_name`, `is_active`.
- ✅ Campos opcionales: `email`, `phone`, `bio` (hasta 2 048 chars), `capacity`, `internal_rate_cents`, `metadata JSONB`.
- ✅ Vincular recurso a un `user_id` de plataforma (para practitioners que tienen cuenta).
- ✅ Asignar recurso a un `sub_tenant_id` (sede/sucursal dentro del tenant).
- 🔧 PATCH/actualización de recurso no implementado — solo `POST` (crear) y `GET`.
- ❌ Activar/desactivar recurso vía endpoint dedicado (`PATCH /v1/resources/:id/active`).
- ❌ Soft-delete con `deleted_at` (hoy `is_active=false` es la única forma de ocultarlo).
- ❌ Foto/avatar del practitioner (REUSE `platform/storage` — presigned URL + `avatar_storage_key` en `metadata`).
- ❌ Galería de imágenes para salas/equipos (referencia a objetos en `platform/storage`).
- ❌ Validación de unicidad de `user_id` por tenant (un usuario no debería ser dos practitioners).

## 2. Tipos de recurso y modelado

- ✅ `practitioner` — persona con cuenta de usuario opcional.
- ✅ `room` — espacio físico con `capacity > 1` para clases grupales.
- ✅ `equipment` — equipo/material reservable (maquinaria, camilla, proyector…).
- ✅ `vehicle` — vehículo de reparto/transporte (disponible vía `kind='vehicle'`).
- ❌ `virtual` — sala de videoconferencia (REUSE `platform/telehealth` para crear el room; el recurso sería el "slot" de un host virtual).
- ❌ Sub-tipos configurables por tenant (e.g. "camilla de masaje" dentro de `equipment`) — hoy solo 4 valores fijos en el CHECK.
- ❌ Recursos compuestos/requisitos múltiples — un servicio requiere un practitioner **y** una sala simultáneamente (e.g. sesión de Pilates: instructor + sala con colchonetas). El motor de availability no lo gestiona todavía.
- ❌ Recursos heredados por sub-tenant desde el tenant raíz (pool compartido de salas entre sedes).

## 3. Horario semanal recurrente (work_hours)

- ✅ Crear franja horaria semanal con `day_of_week` (0=domingo–6=sábado), `start_minute`, `end_minute`.
- ✅ Soporte de `effective_from` / `effective_until` para horarios de temporada o contratos temporales.
- ✅ Múltiples franjas en el mismo día (turno partido: mañana + tarde).
- ✅ Listar horario semanal de un recurso (`GET /v1/resources/:id/work-hours`).
- ✅ Eliminar una franja concreta (`DELETE /v1/resources/work-hours/:id`).
- 🔧 No hay PATCH — para corregir una franja hay que borrarla y recrearla.
- ❌ Copia/clonación de horario entre recursos (útil cuando varios practitioners tienen el mismo turno).
- ❌ Horario con zona horaria explícita por recurso — hoy los minutos son UTC y el motor asume UTC. Recursos en zonas horarias distintas al tenant provocarían desfases.
- ❌ Plantillas de horario reutilizables (template de turno mañana, tarde, fin de semana) aplicables a N recursos de un click.
- ❌ Vista de agenda semanal consolidada de todos los recursos del tenant (no existe endpoint que devuelva work_hours agregado).
- ❌ Validación de solapamiento entre franjas del mismo recurso y día al crear.
- ❌ Historial de cambios de horario (audit log con quién/cuándo modificó la disponibilidad habitual).

## 4. Excepciones puntuales (holidays, vacaciones, bajas, bloqueos)

- ✅ Crear excepción con rango `starts_at`/`ends_at` y tipo (`vacation`, `sick`, `training`, `holiday`, `other`).
- ✅ Campo `reason` libre para justificar la excepción.
- ✅ Listar excepciones de un recurso con filtro de rango temporal (`from`/`to`).
- ✅ Evento Redis `resource.unavailable` al crear excepción (el scheduler de appointments y el módulo de bookings pueden reaccionar).
- 🔧 No hay endpoint para eliminar una excepción — solo creación y listado.
- 🔧 No hay PATCH de excepción (corrección de fechas requiere eliminar + recrear, pero no existe DELETE).
- ❌ Festivos globales / festivos por tenant aplicados automáticamente a todos los recursos (en vez de crearlos uno a uno).
- ❌ Bloqueos parciales de día: reunión, descanso, formación de 2h a las 10:00 (el modelo permite sub-día, pero no hay UX para ello).
- ❌ Excepciones recurrentes (e.g. todos los lunes primer mes del año = festivo) — hoy solo one-shot.
- ❌ Propagación de aviso `resource.unavailable` a clientes con bookings en el rango bloqueado (REUSE `platform/notifications`).
- ❌ Sugerencia de reasignación cuando se crea una excepción que cubre bookings existentes.
- ❌ Integración con calendario externo (Google Calendar / Outlook) para sincronizar bajas o festivos automáticamente.

## 5. Habilidades y servicios que puede prestar un recurso

- ✅ Relación N:M `resource_services` entre recursos y servicios del catálogo (`platform/services`).
- ✅ Añadir habilidad (`POST /v1/resources/:id/services/:serviceId`).
- ✅ Quitar habilidad (`DELETE /v1/resources/:id/services/:serviceId`).
- ✅ Listar recursos capaces de dar un servicio concreto (`GET /v1/resources/by-service/:serviceId`).
- ✅ GET de recurso devuelve array `services` con sus service_ids.
- 🔧 `resource_services` solo guarda el `service_id` — no almacena nivel de competencia, tarifa personal ni preferencia de asignación por recurso+servicio.
- ❌ Tarifa diferencial por recurso+servicio (un practitioner senior cobra más por el mismo servicio — REUSE `internal_rate_cents` por servicio en vez de uno global).
- ❌ Nivel de competencia / certificación por servicio (básico, avanzado, especialista).
- ❌ Regla de asignación: "para este servicio, preferir el practitioner con mayor rating" (orden de prioridad de asignación).
- ❌ Verificación de que el `service_id` realmente existe en `platform_services.services` (FK cross-schema no implementada por separación de esquemas; solo validación en aplicación).
- ❌ Listar servicios completos (con nombre, duración) de un recurso — hoy solo se devuelven UUIDs.

## 6. Capacidad y recursos con aforo

- ✅ Campo `capacity` en el recurso (INT, mínimo 1).
- ✅ El motor de availability combina `min(service.capacity, resource.capacity)` para calcular `remaining` por slot.
- 🔧 La capacidad es estática — no varía por día/hora/temporada sin crear excepciones o editarlo manualmente.
- ❌ Capacidad variable por franja horaria (una sala tiene 20 plazas en horario normal pero solo 10 los domingos).
- ❌ Overbooking controlado con factor configurable por tenant (e.g. 110% de aforo con lista de espera).
- ❌ Capacidad de recursos combinados (si un servicio necesita practitioner + sala, la capacidad efectiva es la del cuello de botella).

## 7. Perfil público del practitioner

- 🔧 `bio` y `display_name` cubren lo mínimo; `email`/`phone` son campos internos, no hay distinción público/privado.
- ❌ Foto de perfil pública (REUSE `platform/storage` — `avatar_storage_key` → presigned URL).
- ❌ Especialidades/tags visibles al cliente (e.g. "osteopatía", "pediatría", "yoga ashtanga").
- ❌ Idiomas que habla el practitioner.
- ❌ Endpoint público (sin autenticación o con token de cliente) para listar practitioners del tenant con sus especialidades y disponibilidad resumida.
- ❌ Mini-CV: formación, certificaciones, años de experiencia.
- ❌ Video de presentación (referencia a `platform/storage`).
- ❌ Enlace a redes sociales / LinkedIn del practitioner.
- ❌ Visibilidad configurable (practitioner oculto al público pero operable internamente).

## 8. Reseñas del practitioner

- ❌ Reseñas verificadas por practitioner (REUSE `platform/reviews` con `entity_type='resource'` y `entity_id=resource_id`).
- ❌ Rating medio del practitioner calculado y cacheado (útil para la ordenación de la lista pública).
- ❌ Respuesta del practitioner a reseñas (REUSE replies en `platform/reviews`).
- ❌ Filtrado de lista pública de practitioners por rating mínimo.
- ❌ Moderación de reseñas de practitioners (REUSE flujo de moderación de `platform/reviews`).
- ❌ Reseña solo disponible tras booking completado (verificación de compra en `platform/bookings`).

## 9. Comisiones y retribución (practitioner-payouts)

- ✅ Campo `internal_rate_cents` para tarifa interna de coste del recurso.
- ❌ Integración con `platform/practitioner-payouts` — declarar el `resource_id` del practitioner en el módulo de comisiones para que los devengos se calculen correctamente.
- ❌ Tarifa de comisión configurable por practitioner (% de los ingresos del servicio que se le acredita).
- ❌ Coste por hora calculado automáticamente a partir de `internal_rate_cents` y duración del booking.
- ❌ Vista de resumen financiero del practitioner: ingresos brutos, comisión devengada, pendiente de pago (REUSE `platform/practitioner-payouts`).
- ❌ Diferenciación entre practitioner empleado (nómina) vs autónomo/freelance (factura) en el cálculo de retención.

## 10. Asignación a sub-tenant / sede

- ✅ Campo `sub_tenant_id` en el recurso (nullable) para asignarlo a una sede específica.
- 🔧 No hay endpoint para reasignar un recurso de sede sin recrearlo.
- ❌ Pool compartido de recursos entre sedes del mismo tenant (e.g. un practitioner itinerante que trabaja en dos sucursales).
- ❌ Vista de recursos por sede con gestión de asignaciones.
- ❌ Regla de disponibilidad por sede: el practitioner tiene horarios distintos en cada sucursal (work_hours por sub_tenant_id).
- ❌ Transferencia temporal de recurso entre sedes con período de validez.

## 11. Agenda personal del practitioner / vista de ocupación

- 🔧 La ocupación del practitioner se puede inferir leyendo `platform/bookings` con `resource_id`, pero no existe un endpoint de "mi agenda" en el módulo de resources.
- ❌ `GET /v1/resources/:id/agenda?from=&to=` — vista unificada: work_hours + exceptions + bookings confirmados + holds activos.
- ❌ Agenda del practitioner accesible por él mismo con su JWT (autenticado como `user_id`).
- ❌ Notificación al practitioner cuando se crea/cancela/modifica un booking que le concierne (REUSE `platform/notifications`).
- ❌ Bloqueo personal: el propio practitioner puede añadir bloqueos desde su vista de agenda (REUSE excepciones con kind `other`).
- ❌ Vista de agenda de sala/equipo para operativa de reservas internas (reuniones, mantenimiento).

## 12. Preferencia de cliente por practitioner

- ❌ Guardar preferencia de practitioner por cliente (`user_id` → `resource_id` favorito).
- ❌ Lógica de asignación que prioriza el practitioner preferido si está disponible.
- ❌ Historial de practitioners con los que el cliente ha tenido citas (para mostrar "continuar con…").
- ❌ Advertencia al cliente si su practitioner habitual no está disponible en el rango solicitado.
- ❌ Asignación automática al practitioner con menor carga si el cliente no tiene preferencia.

## 13. Sustituciones y cobertura

- ❌ Sustitución de practitioner en un booking existente (reasignar `resource_id` en el booking).
- ❌ Lista de sustitutos disponibles para un slot concreto (practitioners con la habilidad y sin conflicto).
- ❌ Notificación al cliente cuando se produce una sustitución (REUSE `platform/notifications`).
- ❌ Registro de sustituciones para auditoría y KPIs.
- ❌ Sustitución masiva cuando se crea una excepción larga (vacaciones): proponer reasignar todos los bookings afectados.

## 14. Zonas horarias

- 🔧 El módulo almacena minutos de día sin zona horaria explícita. El motor de availability opera en UTC y confía en que el frontend envíe rangos correctos.
- ❌ Campo `timezone` en el recurso (practitioner en zona horaria diferente al tenant central).
- ❌ Campo `timezone` en el tenant, heredado por sus recursos salvo override.
- ❌ Conversión automática `local → UTC` al generar slots para clientes que están en otra zona horaria.
- ❌ Display de horarios en la zona del recurso para el administrador y en la zona del cliente para el usuario final.

## 15. Integración con `platform/availability` (base del cálculo de slots)

- ✅ `platform/availability` lee `work_hours` del recurso para generar la rejilla de slots candidatos.
- ✅ `platform/availability` lee `exceptions` para bloquear slots duros (el recurso no está disponible).
- ✅ `GET /v1/resources/by-service/:serviceId` es el endpoint que `platform/availability` usa para obtener los recursos que pueden dar un servicio.
- ✅ Capacidad del recurso (`capacity`) propagada al slot (`remaining = min(svc.capacity, r.capacity) - bookings_activos`).
- 🔧 `effective_from`/`effective_until` en work_hours están modelados en BD y los lee `availability.service.js`, pero no hay endpoint para gestionar horarios estacionales en la UI.
- ❌ Invalidación del caché de slots en `platform/availability` cuando cambia el horario de un recurso (hoy solo se invalida cuando hay un hold/release). Un cambio de work_hours o excepción debería publicar `resource.schedule_changed` para que el módulo de availability bumpe la versión del recurso en Redis.
- ❌ Soporte de recursos compuestos en `platform/availability`: si un servicio requiere practitioner + sala, el motor debe garantizar ambos libres simultáneamente.

## 16. Calendarios externos (sincronización)

- ❌ Suscripción a Google Calendar: importar eventos del calendario personal del practitioner como bloqueos/excepciones automáticas.
- ❌ Export iCal (`/v1/resources/:id/calendar.ics`) para que el practitioner suscriba su agenda en cualquier cliente de calendario.
- ❌ Push de eventos de booking a Google Calendar / Outlook del practitioner al confirmar.
- ❌ Sincronización bidireccional: cambios en el calendario externo → excepciones en la plataforma.
- ❌ OAuth del practitioner con Google/Microsoft (REUSE `platform/auth` OAuth) para autorizar el acceso a su calendario.
- ❌ Resolución de conflictos entre eventos externos y bookings confirmados.

## 17. Multi-tenant y multi-app

- ✅ RLS por `(app_id, tenant_id)` en `resources`, `resource_services`, `work_hours` y `exceptions`.
- ✅ Aislamiento garantizado: un practitioner de un tenant nunca aparece en la lista de otro.
- 🔧 `sub_tenant_id` en el recurso, pero la RLS de las tablas solo filtra por `(app_id, tenant_id)` — no hay aislamiento RLS por `sub_tenant_id` (la lógica de sede es aplicativa).
- ❌ Tenant-level defaults: configurar work_hours estándar para todos los recursos nuevos del tenant.
- ❌ Festivos globales por tenant que se propaguen automáticamente como excepciones a todos sus recursos (`holiday` masivo).
- ❌ Límite configurable de número de recursos activos por tenant (control de plan/tier).
- ❌ Dashboard de ocupación global del tenant: todos los recursos, todos los días, en una vista de calor.

## 18. Analítica, reporting y KPIs operativos

- ❌ Tasa de ocupación por recurso: `bookings_confirmados / slots_disponibles` en un período.
- ❌ Comparativa de ocupación entre practitioners del mismo servicio.
- ❌ Horas trabajadas vs horas disponibles vs horas no utilizadas.
- ❌ Tiempo medio entre bookings (idle time).
- ❌ Ingresos generados por recurso en el período (joining con `platform/bookings` + `platform/payments`).
- ❌ Ranking de practitioners por rating, por número de bookings, por ingresos.
- ❌ Mapa de calor de franja horaria más demandada por recurso.
- ❌ Alertas de recurso sin disponibilidad configurada (work_hours vacío → no genera slots).
- ❌ Export CSV/XLSX de recursos con sus KPIs para reporting de RR.HH.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **PATCH de recurso + DELETE de excepción** — funcionalidad CRUD básica ausente; bloquea operativas cotidianas sin gran coste de implementación.
2. **Invalidación de caché de availability al cambiar horario** — publicar `resource.schedule_changed` en Redis cuando cambia `work_hours` o `exceptions`, para que `platform/availability` bumpe la versión del recurso y no sirva slots caducados; riesgo operativo real hoy.
3. **Foto de practitioner** (REUSE `platform/storage`) + **endpoint público de lista** — desbloquea el portal de cliente de cualquier app de citas (aikikan, health, …) con coste bajo porque el storage ya está implementado.
4. **Agenda del practitioner** (`GET /v1/resources/:id/agenda`) — cruce de work_hours + exceptions + bookings; muy valorado por practitioners y no requiere nuevas tablas.
5. **Festivos masivos por tenant** — crear excepciones en todos los recursos de un tenant en un solo POST; evita trabajo manual repetitivo en lanzamientos y temporadas.
6. **Zona horaria por recurso** — necesario en cuanto haya apps con practitioners en múltiples países; el campo es trivial de añadir, pero la lógica de conversión requiere coordinación con `platform/availability`.
7. **Recursos compuestos** (practitioner + sala simultáneos) — requiere cambio en `platform/availability`; alto valor para gimnasios, clínicas y estudios donde la sala es cuello de botella.
8. **Reseñas de practitioner** (REUSE `platform/reviews` con `entity_type='resource'`) — impacto directo en conversión; el módulo ya existe, solo falta la integración.
9. **Sincronización Google Calendar** (export iCal primero, import después) — el export es bajo coste y muy demandado por practitioners que ya usan Google Calendar.
10. **Comisiones integradas con `platform/practitioner-payouts`** — vincular `resource_id` al módulo de payouts para automatizar el cálculo de comisiones desde el perfil del practitioner.
