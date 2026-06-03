# Casos de uso — `platform/floor-plan` (platform-restaurant)

> Dominio: plano de sala de restaurante — definición de secciones/salas, mesas con posición y forma, estados de mesa en tiempo real, combinación de mesas para grupos, auditoría de transiciones y coordinación con reservas y POS.

## Estado actual (implementado)

Secciones con flag `is_outdoor`; mesas con `code`, `capacity`, `shape` (`square|round|rectangle|oval`), posición (`pos_x`, `pos_y`) y `combined_with UUID[]`; FSM de estado (`free → reserved → occupied → dirty → out_of_service → free`) con validación de transiciones; `table_events` como audit log de cada transición (actor, `reservation_id`, `party_size`); eventos Redis (`table.reserved`, `table.seated`, `table.cleared`, `table.combined`, …); RLS por `(app_id, tenant_id)`; índice único por `(app_id, tenant_id, code)`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Definición de secciones / salas

- ✅ Crear sección con `name`, `description`, `is_outdoor`, `display_order`.
- ✅ Listar secciones de un tenant ordenadas por `display_order, name`.
- 🔧 Sin edición (PATCH) ni borrado de sección con validación de mesas huérfanas.
- ❌ Tipos adicionales de sala: interior, terraza, barra, reservado privado, jardín, azotea, sala de eventos.
- ❌ Capacidad máxima aforo declarada en la propia sección (distinta de la suma de mesas).
- ❌ Horario de disponibilidad de la sección (terraza solo en verano / viernes-domingo).
- ❌ Flag `smoking_allowed` / `pets_allowed` por sección.
- ❌ Color y etiqueta visual para el editor del plano.
- ❌ Imagen de referencia o croquis de la sección.

## 2. Definición y gestión de mesas

- ✅ Crear mesa con `section_id`, `code`, `capacity`, `shape`, `pos_x`, `pos_y`.
- ✅ Código único por tenant (`app_id, tenant_id, code`).
- ✅ Shapes: `square`, `round`, `rectangle`, `oval`.
- ✅ Listar mesas con filtro por `section_id` y/o `status`.
- ✅ Obtener mesa individual por `id`.
- 🔧 Sin edición (PATCH) ni borrado de mesa; sin validación de estado activo al borrar.
- ❌ Capacidad mínima además de máxima (e.g. mesa redonda de 4 mínimo 2).
- ❌ Ancho y alto en píxeles / unidades de diseño (además de `pos_x`, `pos_y`) para render preciso.
- ❌ Ángulo de rotación de la mesa en el editor visual.
- ❌ Flag `accessible` (mesa adaptada para sillas de ruedas / movilidad reducida).
- ❌ Flag `high_chair_available` (trona disponible).
- ❌ Nombre descriptivo adicional (p. ej. "Mesa de la ventana", "Booth 3").
- ❌ Campo `notes` libre por mesa (corriente de aire, vista, etc.).
- ❌ Mesa `virtual` (barra de bar, mostrador take-away) sin asientos físicos.

## 3. Editor visual drag-and-drop del plano

- 🔧 Coordenadas `pos_x`, `pos_y` almacenadas — backend preparado pero sin UI.
- ❌ Editor canvas en el portal de administración con drag-and-drop de mesas.
- ❌ Redimensionado y rotación de mesas arrastrando handles.
- ❌ Snap a cuadrícula configurable (p. ej. 10 px).
- ❌ Capas: mesas, paredes, puertas, zona de bar, cocina, aseos (decorativas, sin lógica).
- ❌ Import/export del layout como JSON o imagen SVG/PNG.
- ❌ Zoom y scroll del canvas.
- ❌ Historial undo/redo de cambios en el editor.
- ❌ Vista previa del plano tal como lo verá el camarero en la app.
- ❌ Múltiples planos por sección (planta alta, planta baja).

## 4. Estados de mesa en tiempo real

- ✅ FSM: `free → reserved`, `free → occupied`, `free → out_of_service`.
- ✅ FSM: `reserved → occupied`, `reserved → free`, `reserved → out_of_service`.
- ✅ FSM: `occupied → dirty`, `occupied → free`, `occupied → out_of_service`.
- ✅ FSM: `dirty → free`, `dirty → out_of_service`.
- ✅ FSM: `out_of_service → free`.
- ✅ Rechazo de transición inválida con `ConflictError`.
- ✅ Eventos Redis `table.seated`, `table.cleared`, `table.reserved`, `table.out_of_service`, `table.dirty`.
- 🔧 Estado `dirty` existe en FSM pero sin flujo explícito de solicitud de limpieza.
- ❌ Estado `blocked` (bloqueado por el manager, sin causa FSM): actualmente cubierto por `out_of_service`, pero semánticamente diferente.
- ❌ Razón/comentario al poner `out_of_service` (mantenimiento, avería, obra).
- ❌ Push / WebSocket al panel del camarero cuando cambia el estado de una mesa.
- ❌ Tiempo real vía SSE o WebSocket en la vista del plano (color de mesa se actualiza sin recargar).
- ❌ Historial de estados de un día — "¿cuántas veces se ocupó la mesa T5 hoy?".

## 5. Auditoría de transiciones de estado

- ✅ Tabla `table_events` con `from_status`, `to_status`, `reservation_id`, `party_size`, `actor_user_id`, `ts`.
- ✅ RLS en `table_events` por `(app_id, tenant_id)`.
- ✅ Índice por `(table_id, ts DESC)`.
- ❌ Endpoint GET para leer `table_events` de una mesa concreta (solo existe en DB, no expuesto en rutas).
- ❌ Endpoint admin para consultar audit log filtrado por fecha, actor, tipo de transición.
- ❌ Exportación del audit log (CSV) para inspección de turnos anteriores.
- ❌ Vinculación del evento con `order_id` del POS (no solo `reservation_id`).

## 6. Combinación y separación de mesas

- ✅ `POST /v1/floor-plan/tables/:id/combine` — asigna `combined_with: [otherIds]` en la tabla primaria.
- ✅ Evento Redis `table.combined`.
- 🔧 `combined_with` es un array plano en la mesa primaria; las mesas secundarias no actualizan su propio estado.
- ❌ Separar una mesa combinada (reset `combined_with = []` + evento `table.split`).
- ❌ Validar que las mesas a combinar estén libres antes de combinar.
- ❌ Bloquear cambio de estado en las mesas secundarias mientras estén combinadas.
- ❌ Cálculo automático de la capacidad total del grupo (`sum(capacity)`) al combinar.
- ❌ Indicador visual en el editor de qué mesas forman un grupo.
- ❌ Historial de combinaciones (cuándo se combinaron, quién, para qué reserva).

## 7. Asignación de camareros a secciones / rangos

- ❌ Tabla `section_assignments` — camarero asignado a una sección en un turno.
- ❌ Asignación por rango de mesas (mesas T1-T10 al camarero A).
- ❌ Vista "mis mesas" filtrada por el camarero autenticado.
- ❌ Indicador visual de qué camarero cubre qué zona en el plano.
- ❌ Reasignación en caliente cuando un camarero termina el turno.
- ❌ Rotación de rangos entre turnos.
- ❌ Notificación al camarero cuando se ocupa/reserva una mesa de su rango.
- ❌ Métricas de carga por camarero (mesas ocupadas, rotaciones).

## 8. Aforo y capacidad

- 🔧 Capacidad almacenada por mesa; no hay cálculo de aforo total en el módulo.
- ❌ Aforo total del local calculado como suma de `capacity` de todas las mesas activas.
- ❌ Aforo por sección.
- ❌ Límite de aforo legal por sección (terraza con limitación municipal).
- ❌ Aforo actual en tiempo real: número de comensales sentados en este momento.
- ❌ Alerta cuando el aforo supera X % del máximo.
- ❌ Restricción de reservas cuando el aforo legal se acerque al máximo.
- ❌ Registro de aforo para declaración sanitaria / cumplimiento normativo.

## 9. Integración con el módulo de reservas (`platform/reservations`)

- 🔧 `reservation_id` en `table_events` linkea reserva ↔ transición, pero sin sincronización activa de ida.
- ❌ Asignación automática de mesa al confirmar una reserva (según tamaño de grupo y disponibilidad).
- ❌ Sugerir mesa óptima: capacidad mínima suficiente, misma sección preferida, preferencias de accesibilidad.
- ❌ Escuchar evento `reservation.confirmed` de `platform/reservations` → marcar mesa como `reserved`.
- ❌ Escuchar `reservation.cancelled` → liberar mesa (`reserved → free`).
- ❌ Escuchar `reservation.seated` → transición `reserved → occupied`.
- ❌ Endpoint "¿qué mesas hay libres para un grupo de N personas a las HH:MM?" (consulta de disponibilidad temporal).
- ❌ Ver en el plano qué mesas tienen reserva próxima (indicador de hora).

## 10. Integración con el POS (`platform/pos`)

- ❌ Escuchar `pos.bill.opened` → transición automática `reserved/free → occupied`.
- ❌ Escuchar `pos.bill.closed` / `pos.bill.paid` → transición `occupied → dirty`.
- ❌ Endpoint "abrir cuenta en mesa X" que dispara apertura de bill en POS + transición `occupied`.
- ❌ Mostrar en el plano si una mesa tiene cuenta abierta y su importe parcial.
- ❌ Vincular `order_id`/`bill_id` en `table_events` (para reconciliación posterior).
- ❌ Alerta al camarero cuando una mesa lleva >N minutos ocupada sin cuenta abierta.

## 11. Múltiples planos por horario / temporada / servicio

- ❌ Concepto de `floor_plan_version` (comida, cena, terraza de verano, navidades).
- ❌ Activar/desactivar un plano en función de hora o fecha.
- ❌ Clonar un plano existente como base para una versión nueva.
- ❌ Vista de previsualización de un plano no activo.
- ❌ Registro de qué versión estaba activa en un turno concreto (para análisis histórico).

## 12. Código QR por mesa

- ❌ Generación de QR por mesa que enlace a la carta digital o a la web de pago en mesa.
- ❌ QR con URL parametrizada (`?table=T5&tenant=...`) para apertura automática de sesión.
- ❌ Descarga masiva de QR de todas las mesas (ZIP de imágenes o PDF imprimible).
- ❌ Rotación periódica del QR (anti-reutilización de capturas de pantalla).
- ❌ Estadísticas de escaneos por mesa.

## 13. Accesibilidad y necesidades especiales

- ❌ Flag `accessible` en la mesa (acceso en silla de ruedas, espacio suficiente).
- ❌ Búsqueda/filtro de mesas accesibles en el motor de asignación de reservas.
- ❌ Campo `notes` de requisitos especiales por mesa.
- ❌ Indicador en el plano visual de mesas adaptadas.
- ❌ Notificación al camarero asignado cuando una reserva incluye necesidades de movilidad.

## 14. Zonas temáticas / regulatorias

- ❌ Flag `smoking_allowed` por sección.
- ❌ Flag `pets_allowed` por sección.
- ❌ Zona de lactancia / zona infantil.
- ❌ Zona de reservado privado (sala cerrada con facturación mínima).
- ❌ Zona exterior cubierta vs descubierta (importante para climatología).
- ❌ Integración con las preferencias del cliente en la reserva (solicitar zona no fumadora, terraza, etc.).

## 15. Métricas de ocupación y rotación

- ❌ Ocupación media por sección y por mesa en un periodo.
- ❌ Tiempo medio de permanencia (tiempo entre `occupied` y `dirty`/`free`).
- ❌ Número de rotaciones (veces que una mesa pasó a `occupied`) por turno / por día.
- ❌ Tasa de no-show (mesa reservada que nunca llegó a `occupied`).
- ❌ Eficiencia de la sala: comensales servidos / capacidad total × hora.
- ❌ Export CSV de métricas por periodo para cuadro de mando externo.

## 16. Heatmaps y analítica visual

- ❌ Heatmap de ocupación superpuesto sobre el plano (color por mesa según tasa de ocupación).
- ❌ Heatmap de ingresos (mesa más rentable por turno).
- ❌ Mapa de "zonas frías" (mesas con baja rotación → reposicionamiento).
- ❌ Comparativa de secciones: terraza vs interior por temporada.
- ❌ Vista timeline del día: línea de tiempo de estados por mesa (Gantt de la sala).

## 17. Multi-local / multi-tenant

- ✅ Aislamiento completo por `(app_id, tenant_id)` con RLS.
- 🔧 Sin soporte explícito de `sub_tenant_id` — contexto nullable disponible en servicio pero no usado en queries de floor-plan.
- ❌ Soporte de `sub_tenant_id` para cadenas con múltiples locales bajo un mismo tenant.
- ❌ Vista consolidada multi-local para el responsable de la cadena (agregación de ocupación de todos los locales).
- ❌ Replicar layout de un local a otro dentro de la misma cadena.
- ❌ Permisos por local: un manager de local solo ve sus secciones.

## 18. Eventos especiales y configuración de sala ad hoc

- ❌ Modo "evento privado": bloquear toda una sección y asignarla a un evento de `platform/reservations`.
- ❌ Redistribución temporal del plano para banquete / celebración (sin sobreescribir el layout permanente).
- ❌ Aforo máximo diferente para el evento (p. ej. cocktail de pie vs cena sentada).
- ❌ Comunicación automática al equipo de sala cuando se activa un layout de evento.
- ❌ Lista de requerimientos del evento (decoración, audio, proyección) ligada al registro de evento.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **PATCH y DELETE de sección y mesa** — operaciones CRUD básicas que faltan; desbloqueantes para cualquier UI de configuración.
2. **Separación de mesas combinadas** (`table.split`) + validaciones al combinar (estado libre, bloqueo de secundarias) — cierra el flujo de combinación a medias.
3. **Endpoint GET de `table_events` por mesa** — el audit log existe en DB pero no está expuesto; necesario para que el portal lo muestre.
4. **Integración con `platform/reservations`**: escuchar `reservation.confirmed/cancelled/seated` para mover el estado de mesa automáticamente — elimina trabajo manual del staff.
5. **Integración con `platform/pos`**: escuchar `pos.bill.opened/closed` para sincronizar estado — evita inconsistencias entre POS y plano.
6. **WebSocket / SSE de estado de mesas** — el plano en tiempo real es el diferenciador clave del módulo; sin push no hay valor en el panel del camarero.
7. **Aforo en tiempo real** (suma de `party_size` de mesas `occupied`) — cumplimiento legal y gestión operativa básica.
8. **Asignación de camareros a secciones** — funcionalidad esperada en cualquier restaurante con > 1 camarero.
9. **Código QR por mesa** — REUSE `platform/storage` para generar y servir la imagen; alto impacto en experiencia del comensal con bajo coste de implementación.
10. **Múltiples layouts por horario/temporada** — necesario en restaurantes con terraza o sala de eventos; sin esto el plano es estático.
