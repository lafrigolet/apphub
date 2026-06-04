# Casos de uso — `platform/services` (platform-appointments)

> Dominio: catálogo de servicios reservables por cita — duración, buffers, modalidad (presencial / online / a domicilio / híbrido), precio, capacidad, galería y sesiones fechadas (tipo evento). **No confundir con `platform/catalog`**: catalog gestiona productos físicos o digitales del marketplace (SKU, stock, variantes de talla/color). Services gestiona aquello que se reserva como cita: corte de pelo, consulta médica, clase de yoga, examen de cinturón, seminario.

## Estado actual (implementado)

CRUD de servicios (`code`, `name`, `description`, `category`, `modality`, `duration_minutes`, `buffer_before/after`, `price_cents`, `currency`, `cancellation_policy`, `requires_intake_form`, `intake_form_id`, `capacity`, `min_age`, `metadata`, `is_active`, `kind`, `public_catalog`, `step_minutes`); categorías de agrupación; galería de imágenes (referencia a `platform_storage`); tarifas dinámicas por franja horaria + día de semana (`service_pricing_tiers`); motor de cotización (`/quote`) con regla de especificidad más-específico-gana; sesiones fechadas (`service_sessions`) para servicios tipo `event`; catálogo público sin JWT (`GET /v1/services/sessions/upcoming` con `public_catalog=TRUE`); cancelación de sesión con evento `service.session.cancelled`; RLS por `(app_id, tenant_id)`; multi-sub_tenant; eventos `service.published` y `service.deprecated` en `platform.events`; ventana de reserva (`min_advance_minutes` / `max_advance_days`) con endpoint `booking-window`; `cancellation_policy` con esquema canónico validado; i18n (`service_translations`) con catálogo público localizado (migración `0005`).

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## Frontera con `platform/catalog`

| Dimensión | `platform/services` | `platform/catalog` |
|---|---|---|
| Qué representa | Algo que se reserva (tiempo + recurso) | Algo que se compra (SKU físico/digital) |
| Unidad de medida | Minutos de duración + buffer | Precio por unidad + stock |
| Motor de disponibilidad | `platform/availability` (slots) | `platform/inventory` (stock) |
| Transacción | `platform/bookings` | `platform/orders` + `platform/basket` |
| Recursos asociados | `platform/resources` (practitioner, sala, equipo) | — |
| Precio dinámico | Tarifas por franja horaria / día | — |
| Capacidad grupo | `capacity` filas de asistentes | — |

Un mismo tenant puede tener entradas en ambos módulos si, por ejemplo, vende tanto clases (services) como merchandise (catalog).

---

## 1. Definición de servicio

- ✅ Crear servicio con `code` (único por tenant), `name`, `description`, `category`, `modality` (`in_person` / `telehealth` / `at_home` / `hybrid`), `duration_minutes`, `price_cents`, `currency`.
- ✅ Buffers antes (`buffer_before_minutes`) y después (`buffer_after_minutes`) de la cita — protegen al practitioner entre citas.
- ✅ `step_minutes` configurable por servicio (por defecto 15 min; se puede reducir a 5 para masajes o ampliar a 30 para consultas) — controla la granularidad de slots en `platform/availability`.
- ✅ `capacity` por defecto 1 (cita individual); valores > 1 habilitan grupos/clases.
- ✅ `min_age` como restricción de edad mínima (campo de validación en el portal).
- ✅ `metadata JSONB` libre para campos adicionales específicos de cada app.
- ✅ Activar / desactivar (`is_active` + endpoint `POST /deactivate`); evento `service.deprecated` al desactivar.
- ✅ `kind`: `appointment` (flujo clásico: availability + slots) o `event` (solo se reserva contra `service_sessions`, sin grid de slots).
- ✅ `public_catalog`: bandera booleana que controla si las sesiones del servicio aparecen en el endpoint público sin autenticación.
- 🔧 `cancellation_policy` almacenada como JSONB libre — esquema canónico (`hours_before_cancel`, `refund_pct`, `no_show_fee_cents`) ✅ validado en el service layer + CHECK defensivo en BD (migración `0005`); el motor que la aplica automáticamente al cancelar sigue pendiente en `platform/bookings` (cross-cutting).
- ❌ Versiones / historial de cambios del servicio (audit trail de quién cambió precio/duración/cuándo).
- ❌ Duplicar / clonar un servicio existente como punto de partida.
- ❌ Archivado (soft-delete completo con conservación de histórico de reservas).
- ❌ Orden de presentación configurable en el listado (hoy ordenado por `name`).

## 2. Categorías de servicios

- ✅ CRUD de categorías (`name`, `display_order`) por tenant.
- ✅ Filtrado de servicios por `category` en el listado.
- ✅ `display_order` para ordenar categorías en la UI del portal.
- 🔧 `category` en el servicio es un campo texto libre (FK lógica, no FK SQL a la tabla de categorías) — inconsistencia posible si se renombra una categoría.
- ❌ Jerarquía de categorías (padre / hijo: p. ej. "Medicina Estética > Botox").
- ❌ Icono o imagen de portada por categoría.
- ❌ Descripción de categoría (para SEO / páginas de categoría en el portal).
- ❌ Visibilidad de categoría (ocultar una categoría completa del catálogo público).
- ❌ Migración masiva al renombrar categoría (actualizar todos los servicios vinculados).

## 3. Modalidad y telehealth

- ✅ `modality` con cuatro valores: `in_person`, `telehealth`, `at_home`, `hybrid`.
- ✅ Modalidad `telehealth` reconocida como tipo diferenciado — integración con `platform/telehealth` para provisión de sala de vídeo al crear la reserva (responsabilidad de `platform/bookings`, no de `platform/services`).
- 🔧 La lógica de provisión de sala telehealth vive en `platform/bookings`; `platform/services` sólo expone la bandera de modalidad sin wiring explícito al módulo telehealth.
- ❌ Enlace directo desde el servicio al proveedor de vídeo preferido (Jitsi, Daily.co, Zoom) o configuración por tenant.
- ❌ Modalidad `at_home`: sin campos de zona de cobertura geográfica ni tarificación de desplazamiento.
- ❌ Servicios `hybrid` sin regla de precio diferencial automática entre modalidades (requiere tarifa manual por franja).
- ❌ Indicación al cliente de qué plataforma de vídeo se usará (notificación en confirmación de reserva).

## 4. Asignación de recursos (practitioners, salas, equipos)

- ✅ Tabla de relación `platform_resources.resource_services` (N:M) que vincula recursos al servicio: permite filtrar qué practitioners / salas / equipos pueden impartir este servicio (gestionado desde `platform/resources`, no desde `platform/services`).
- ✅ Las sesiones fechadas (`service_sessions`) pueden referenciar opcionalmente un `resource_id` (sin overlap-guard en modo evento, ya que varios asistentes comparten el recurso).
- 🔧 La relación resource ↔ service existe en `platform/resources` pero `platform/services` no expone un endpoint propio para consultarla — el portal debe cruzar datos desde ambos módulos.
- ❌ Requisito de múltiples recursos simultáneos por servicio (p. ej. "consulta médica: precisa practitioner + sala de exploración + tensiómetro") — hoy una reserva solo coge un recurso.
- ❌ Sustitución de recurso (ausencia no planificada → asignar automáticamente otro recurso disponible que imparta el mismo servicio).
- ❌ Vista desde el servicio de qué recursos lo pueden impartir (inverso de resource_services sin cruzar schemas).

## 5. Precio base y tarifas dinámicas

- ✅ `price_cents` + `currency` como precio base del servicio.
- ✅ Tarifas dinámicas (`service_pricing_tiers`): override de precio por día de semana (`days_of_week: int[]`) y/o franja horaria (`start_minute` / `end_minute` en minutos del día).
- ✅ Motor de cotización: regla más-específico-gana (prioriza tier con día + franja, luego sólo día, luego sólo franja, finalmente precio base); dentro del mismo nivel de especificidad, la franja más estrecha gana.
- ✅ `GET /v1/services/:id/quote?at=<ISO>` — devuelve precio aplicable para un instante dado.
- ✅ Las sesiones (`service_sessions`) pueden sobrescribir el precio con `price_cents` propio.
- 🔧 Las tarifas sólo se pueden eliminar, no modificar (`PATCH` no expuesto en tiers) — hay que borrar y recrear.
- ❌ Precio diferencial por modalidad (`in_person` vs `telehealth`) sin tener que crear dos servicios separados.
- ❌ Precio por practitioner — si el practitioner senior cobra más que el junior, hoy requiere dos servicios distintos.
- ❌ Precio por duración variable (p. ej. consulta de 30, 45 o 60 min elegida por el cliente en el momento de reservar).
- ❌ Precio con descuento temporal (`promotion_price` + fecha de expiración).
- ❌ Precio por volumen / paquete (ya cubierto parcialmente por `platform/packages`; sin wiring explícito desde aquí).
- ❌ Monedas múltiples por tier (hoy `currency` está en el servicio raíz, los tiers sólo sobrescriben `price_cents`).
- ❌ Precio "desde" calculado (mínimo de todos los tiers activos) para mostrar en el catálogo público.

## 6. Duración variable y addons

- ✅ `duration_minutes` fijo por servicio (un solo valor).
- 🔧 `step_minutes` permite ofertar slots cada N minutos pero la duración del bloque sigue siendo fija.
- ❌ Duración variable elegida por el cliente (p. ej. masaje de 30, 60 o 90 min como variantes del mismo servicio sin crear tres registros).
- ❌ Addons / complementos: servicios secundarios que se pueden añadir a una reserva principal (p. ej. "manicura" + addon "tratamiento de uñas"), con duración y precio incremental.
- ❌ Variantes de nivel de servicio (p. ej. "Consulta básica / premium" — diferente duración, precio y practitioner dentro del mismo tipo de servicio).

## 7. Servicios de grupo y clases (capacidad)

- ✅ `capacity > 1` en el servicio habilita que múltiples clientes reserven la misma franja con el mismo recurso.
- ✅ Las sesiones (`service_sessions`) pueden sobreescribir la capacidad de la sesión concreta.
- ✅ El módulo `platform/bookings` cuenta inscripciones contra `service_sessions.capacity` y rechaza cuando se llena.
- 🔧 La validación de capacidad para servicios de tipo `appointment` (sin session explícita) está en `platform/availability`; `platform/services` sólo declara el límite, no lo hace cumplir directamente.
- ❌ Lista de espera automática cuando la sesión está llena (REUSE `platform/bookings` waitlist).
- ❌ Inscripción múltiple de un mismo cliente en una clase para acompañantes (p. ej. "reservar 2 plazas").
- ❌ Mínimo de inscritos para que la sesión se confirme (umbral mínimo de rentabilidad).
- ❌ Notificación automática cuando se alcanza el mínimo de inscritos (REUSE `platform/notifications`).

## 8. Sesiones fechadas (tipo evento / convocatoria)

- ✅ `kind = 'event'`: el servicio actúa como plantilla; las instancias son `service_sessions` con `starts_at` / `ends_at` fijos.
- ✅ CRUD completo de sesiones: crear, listar (con filtros `fromDate`, `includeCancelled`), obtener, actualizar, cancelar.
- ✅ Estado de sesión: `scheduled → cancelled / completed`.
- ✅ Cancelar sesión emite `service.session.cancelled` para que `platform/bookings` cancele las inscripciones en cascada (wiring pendiente en bookings, Fase 2).
- ✅ `registration_closes_at`: cierre anticipado de inscripciones antes del inicio de la sesión.
- ✅ `location` libre por sesión (útil cuando la sesión se celebra en un lugar diferente al habitual).
- ✅ `description` por sesión (sobrescribe la del servicio: p. ej. "Edición Madrid 2026").
- ✅ `resource_id` opcional en la sesión (sala o instructor asignado) sin guard de overlap entre inscritos.
- 🔧 Evento `service.session.cancelled` emitido, pero el subscriber en `platform/bookings` que cancela las bookings ligadas está pendiente (Fase 2 del wiring).
- ❌ Recurrencia de sesiones (generar automáticamente sesiones semanales / mensuales a partir de una regla de repetición — análogo a `booking-recurrence-expander` del scheduler).
- ❌ Clonar / duplicar una sesión como punto de partida para la siguiente convocatoria.
- ❌ Estado `draft` antes de publicar (poder preparar una sesión sin que aparezca en el catálogo).
- ❌ Número máximo de sesiones futuras activas por servicio (límite operativo).
- ❌ Exportación de lista de inscritos por sesión (requiere cruzar con `platform/bookings`).

## 9. Catálogo público y visibilidad online

- ✅ `public_catalog` booleano por servicio — controla si las sesiones aparecen en el endpoint público.
- ✅ `GET /v1/services/sessions/upcoming` sin autenticación — listado de sesiones próximas para landings; recibe `appId + tenantId` por query string; RLS garantiza el aislamiento.
- ✅ Filtro por `kind` en el endpoint público (ver solo `event` o solo `appointment`).
- ✅ Límite configurable de resultados (1–500).
- ✅ Locale opcional (`?locale=<bcp47>`) que devuelve `name`/`description` traducidos vía `service_translations`, con fallback al texto base (ver §17).
- 🔧 El listado público sólo devuelve sesiones (`service_sessions`), no servicios de tipo `appointment` sin sesiones (las citas individuales no tienen representación pública propia).
- ❌ Página de detalle de servicio en el catálogo público (endpoint `GET /v1/services/sessions/:sessionId` requiere JWT actualmente — `config.public` no está aplicado).
- ❌ Ordenación configurable del catálogo público (por precio, popularidad, nombre, proximidad).
- ❌ Búsqueda full-text en el catálogo público (nombre, descripción, categoría).
- ❌ Filtro por categoría / modalidad / precio en el endpoint público.
- ❌ Feed RSS / iCal público de sesiones próximas.
- ❌ `slug` SEO-friendly como alternativa al UUID en las URLs públicas.
- ❌ Meta-etiquetas SEO (`og:title`, `og:description`, `og:image`) derivadas del servicio.
- ❌ Marcado `schema.org/Service` / `schema.org/Event` para rich snippets de Google.

## 10. Galería de imágenes

- ✅ Tabla `service_images` — referencia a `object_id` de `platform_storage.objects` (no duplica el binario).
- ✅ `alt_text` y `display_order` por imagen.
- ✅ CRUD: listar, adjuntar, desadjuntar imágenes.
- 🔧 Sin endpoint de reordenación masiva — cambiar el orden requiere eliminar y volver a insertar.
- ❌ Imagen de portada designada explícitamente (hoy se infiere del `display_order = 0`).
- ❌ Imagen de portada por categoría (separado del servicio).
- ❌ Vídeo de presentación del servicio (referencia a objeto de vídeo en storage).
- ❌ Número máximo de imágenes por servicio (sin límite en BD).
- ❌ Optimización automática (WebP, tamaños responsivos) — depende de cómo `platform/storage` sirva los objetos.

## 11. Formulario previo a la cita (intake forms)

- ✅ `requires_intake_form` booleano + `intake_form_id` UUID — referencia lógica (sin FK SQL) a `platform/intake-forms`.
- 🔧 El wiring entre servicios e intake-forms es declarativo: `platform/services` registra la referencia pero es `platform/bookings` quien, al crear la reserva, debe consultar el form y exigir su cumplimentación antes de confirmar la cita. Este flujo no está aún wirizado.
- ❌ Múltiples formularios por servicio (p. ej. uno de anamnesis + uno de consentimiento).
- ❌ Formulario diferente según modalidad del servicio (presencial vs telehealth).
- ❌ Vista previa del formulario desde la ficha de administración del servicio.

## 12. Política de cancelación por servicio

- ✅ `cancellation_policy JSONB` almacenada por servicio (sin esquema fijo — formato libre).
- ✅ Esquema validado de política: `hours_before_cancel`, `refund_pct` (0–100), `no_show_fee_cents` — validado en `validateCancellationPolicy` (create/update) + CHECK `chk_cancellation_policy_shape` en BD (migración `0005`). Claves extra permitidas (passthrough) para flags específicos de cada app; políticas legacy sin las claves canónicas siguen siendo válidas.
- ❌ Motor que aplique la política automáticamente al cancelar una reserva (REUSE `platform/bookings`): calcular reembolso proporcional, aplicar penalización de no-show.
- ❌ Política de cancelación heredada de la categoría o del tenant (sin tener que configurarla en cada servicio).
- ❌ Aviso al cliente de la política en el momento de reservar (REUSE `platform/notifications`).

## 13. Restricciones temporales y ventana de reserva

- ✅ `min_advance_minutes` — tiempo mínimo de antelación requerido para reservar (columna `services.min_advance_minutes`, migración `0005`). `platform/services` almacena/valida y expone `GET /v1/services/:id/booking-window?at=<ISO>` (+ helper puro `checkBookingWindow`); el rechazo en el momento de reservar lo aplica `platform/bookings` leyendo la columna (cross-cutting pendiente).
- ✅ `max_advance_days` — ventana máxima de reserva hacia adelante (columna `services.max_advance_days`, migración `0005`); misma frontera de enforcement que `min_advance_minutes`.
- ❌ Restricción de días / horas en que el servicio se puede reservar (independiente del horario del practitioner — p. ej. "clases solo lunes, miércoles y viernes").
- ❌ Bloqueo temporal de un servicio (sin desactivarlo permanentemente) — p. ej. durante vacaciones del centro.

## 14. Comisiones y payouts de practitioners

- 🔧 `platform/practitioner-payouts` gestiona las comisiones por servicio. `platform/services` no expone datos de comisiones — la configuración de rates se hace directamente en el módulo de payouts, que referencia el `service_id` por UUID.
- ❌ Campo `commission_rate` en el propio servicio como valor por defecto que hereda el módulo de payouts (hoy la configuración vive completamente en practitioner-payouts).
- ❌ Vista desde la ficha del servicio de qué practitioners lo imparten y cuál es su tarifa de comisión.
- ❌ Comisión diferencial por modalidad dentro del mismo servicio.

## 15. Paquetes y sesiones prepago

- 🔧 `platform/packages` gestiona paquetes de sesiones prepago (N sesiones de un servicio). `platform/services` expone el `service_id` como referencia; el wiring para descontar saldo del paquete al crear una reserva vive en `platform/bookings`.
- ❌ Indicación en la ficha del servicio de qué paquetes incluyen ese servicio (requeriría cruzar con `platform/packages`).
- ❌ Precio especial "como parte de paquete" vs precio suelto visible en el catálogo.

## 16. Multi-tenant y multi-app

- ✅ Aislamiento RLS por `(app_id, tenant_id)` en todas las tablas del módulo.
- ✅ `sub_tenant_id` nullable — soporta despliegues de un nivel (tenant) y dos niveles (tenant + sub_tenant como rama / sede).
- ✅ `code` único por `(app_id, tenant_id)` — permite que dos tenants del mismo app tengan servicios con el mismo código sin conflicto.
- ❌ Herencia de catálogo desde el tenant padre al sub-tenant (p. ej. una franquicia publica servicios base que cada sede hereda y opcionalmente amplía).
- ❌ Copia/importación de servicios de otro tenant de la misma app (onboarding rápido de nuevos centros con una plantilla de servicios predefinida).

## 17. Internacionalización (i18n)

- ✅ `name` y `description` con soporte multiidioma vía `service_translations`. El catálogo público (`GET /v1/services/sessions/upcoming?locale=<bcp47>`) superpone la traducción al `service_name` / `service_description` y cae al texto base cuando falta la traducción del locale.
- ✅ Tabla `service_translations` con `(service_id, locale, name, description)` (migración `0005`), unique por `(app_id, tenant_id, service_id, locale)`, RLS por `(app_id, tenant_id)`. CRUD: `GET/PUT /v1/services/:id/translations`, `DELETE /v1/services/:id/translations/:locale` (PUT es upsert por locale).
- ❌ `category` sin traducción — la tabla de categorías tampoco tiene i18n.
- ❌ `alt_text` de imágenes sin variantes por idioma.
- ❌ Servicio de detección de idioma del cliente para devolver la traducción correcta en el catálogo público.

## 18. Analítica y reporting

- ❌ Contador de reservas por servicio (requiere cruzar con `platform/bookings`).
- ❌ Tasa de ocupación por servicio / sesión (reservas vs capacidad total).
- ❌ Ingresos acumulados por servicio (precio × reservas completadas).
- ❌ Servicios más populares por periodo / por categoría.
- ❌ Tiempo medio de anticipación al reservar (cuántos días antes reservan los clientes).
- ❌ Tasa de cancelación / no-show por servicio.
- ❌ Dashboard de métricas en el admin del servicio.
- ❌ Export CSV de catálogo de servicios (listado completo con precios, capacidad, estadísticas).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **Política de cancelación con esquema validado + motor en bookings** — JSONB ya está; sólo falta validar el esquema y wirizar la lógica de reembolso proporcional en `platform/bookings`. Impacto inmediato en todos los apps de citas.
2. ✅ ~~**`min_advance_minutes` + `max_advance_days`**~~ (columnas `services.min_advance_minutes` / `max_advance_days` en migración `0005`, validación de schema en el body, helper puro `checkBookingWindow` + endpoint `GET /v1/services/:id/booking-window`; el rechazo en el momento de reservar queda en `platform/bookings` — cross-cutting).
3. **Wiring `service.session.cancelled` → cancelación en cascada de bookings** (Fase 2 identificada en el código) — el evento ya se emite, falta el subscriber en `platform/bookings`.
4. **Recurrencia de sesiones** (job en `platform/scheduler`) — generar sesiones semanales/mensuales automáticamente es el flujo principal para clases regulares y exámenes periódicos.
5. 🔧 **Esquema validado de `cancellation_policy`** ✅ ~~(esquema canónico validado en service layer + CHECK en BD, migración `0005`)~~ + ❌ herencia desde tenant / categoría (pendiente) — ahorra configuración repetitiva cuando todos los servicios tienen la misma política.
6. ✅ ~~**i18n básico** (`service_translations`)~~ (tabla + CRUD `GET/PUT/DELETE /v1/services/:id/translations` + overlay localizado en el catálogo público vía `?locale=`, migración `0005`).
7. **Duración variable / variantes** — clave para masajistas y consultas de diferente extensión; evita proliferación de servicios casi-duplicados.
8. **`min_advance_minutes` + catálogo público mejorado** (filtros por categoría, búsqueda full-text, slug SEO) — desbloquea el uso de `GET /sessions/upcoming` como página de reservas autónoma sin frontend adicional.
9. **Contador de reservas + tasa de ocupación** (analytics básico cruzando con `platform/bookings`) — valor inmediato para el admin del tenant, sin schema nuevo.
10. **Addons / complementos** — incrementa ticket medio; complejidad moderada (tabla `service_addons` + lógica en bookings para acumular duración y precio).
