# Casos de uso — `platform/menu` (platform-restaurant)

> Dominio: carta F&B (food & beverage). Gestión del menú de un restaurante o negocio de hostelería: cartas múltiples, secciones/categorías, ítems con precio, grupos de modificadores con opciones (extras, con/sin, variantes), alérgenos (14 UE), badges (vegano, picante…), ventanas de disponibilidad por franja horaria y días de la semana, 86-list (ítem agotado temporalmente) y foto del plato vía `platform/storage`.

## Estado actual (implementado)

Cartas (`menus`) con nombre, descripción e `is_active`; categorías por tipo de servicio (`course_type`); ítems con SKU único, precio en centavos, moneda, alérgenos como array de texto, badges como array de texto, `station` (partida de cocina), `prep_time_seconds`, foto vía `photo_url` (legacy) y `photo_object_id` (REUSE `platform/storage`), flag `is_available` y flag `eighty_sixed`; grupos de modificadores (`modifier_groups`) con `min_choices`/`max_choices`; modificadores individuales (`modifiers`) con `price_delta_cents`, opción por defecto y orden; ventanas de disponibilidad (`availability_windows`) con scope polimórfico (menú, categoría o ítem), días de semana y rango en minutos; 86-list (marcar/desmarcar ítem agotado con publicación de evento Redis); publicación de carta (`menu.published`); aislamiento por `(app_id, tenant_id)` con RLS en cada tabla; soporte `sub_tenant_id` (multi-local).

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Gestión de cartas (menus)

- ✅ Crear carta con nombre, descripción e `is_active`.
- ✅ Listar todas las cartas de un tenant ordenadas por `created_at DESC`.
- ✅ Obtener carta completa (árbol: carta → categorías → ítems).
- ✅ Activar / desactivar carta vía `PATCH /v1/menu/items/:id` (campo `isActive` en ítem; `is_active` en menú patcheable desde el mismo endpoint de menú).
- ✅ Publicar carta y emitir evento `menu.published` (snapshot para KDS/POS/portales).
- ❌ Actualizar nombre/descripción/estado de una carta existente (`PATCH /v1/menu/menus/:id` — no existe, solo POST + publish).
- ❌ Eliminar carta (soft-delete / hard-delete).
- ❌ Duplicar carta (clonar árbol completo: categorías + ítems + modificadores).
- ❌ Carta activa por defecto vs carta en borrador / carta archivada — estados explícitos más allá de `is_active`.
- ❌ Versionado de carta: historial de cambios con `published_at` + rollback a versión anterior.
- ❌ Programar activación de carta (p. ej. "nueva carta de verano activa a partir del 01-07").
- ❌ Cartas diferenciadas por canal: sala / delivery / takeaway — misma carta con precios distintos según canal.
- ❌ Carta de degustación / menú del día como entidad separada de la carta general.

## 2. Categorías / secciones

- ✅ Crear categoría vinculada a una carta con `course_type` (`starter, main, dessert, drink, side, combo, other`).
- ✅ Orden visual de categorías dentro de la carta (`display_order`).
- ✅ Listado de categorías de una carta ordenado por `display_order, name`.
- ❌ Actualizar categoría (`PATCH /v1/menu/categories/:id` — no existe).
- ❌ Eliminar categoría (con cascada a ítems y modificadores).
- ❌ Subcategorías (categoría padre / hijo) para cartas con jerarquía profunda (p. ej. "Vinos" → "Tintos" → "Ribera del Duero").
- ❌ `course_type` ampliado: `breakfast`, `brunch`, `snack`, `set_menu`, `kids` — el enum actual cubre hostelería básica pero no todos los formatos.
- ❌ Categorías compartidas entre varias cartas (p. ej. misma sección "Bebidas" en carta sala y carta delivery).
- ❌ Descripción / banner de categoría (texto intro, imagen de sección).

## 3. Ítems de carta — datos maestros

- ✅ Crear ítem con SKU único por `(app_id, tenant_id)`, nombre, descripción, precio en centavos, moneda (ISO 4217, default EUR).
- ✅ `course_type` por ítem (hereda o sobreescribe el de la categoría).
- ✅ `station` (partida de cocina: "parrilla", "frío", "postres") para enrutar al KDS.
- ✅ `prep_time_seconds` para cálculo de tiempo de preparación.
- ✅ `metadata JSONB` — campo libre para datos extra sin migración.
- ✅ `is_available` — disponibilidad manual del ítem.
- ✅ Actualizar ítem: nombre, descripción, precio, disponibilidad, alérgenos, badges, foto, station, tiempo de prep, course_type.
- ❌ Eliminar ítem (soft-delete / hard-delete).
- ❌ Mover ítem a otra categoría (`categoryId` está excluido del `itemPatchBody`).
- ❌ Variantes de tamaño/presentación como entidad propia (p. ej. "Ración" / "Media ración" / "Pincho") — hoy se modelan como modificadores de precio pero sin semántica de tamaño.
- ❌ IVA/impuesto por ítem o por categoría (tipo reducido 10%, superreducido 4%, general 21% España).
- ❌ Precio coste (food cost) y margen — gestión de rentabilidad por plato.
- ❌ Código de barras / PLU para integración con TPV externo.
- ❌ Peso neto / volumen / unidad de medida para platos vendidos por gramo/litro.
- ❌ Info nutricional: calorías, proteínas, carbohidratos, grasas, sal (Reglamento UE 1169/2011).

## 4. Modificadores y opciones

- ✅ Grupos de modificadores (`modifier_groups`) vinculados a un ítem con `name`, `min_choices`, `max_choices`, `display_order`.
- ✅ Modificadores individuales con `name`, `price_delta_cents` (delta de precio, puede ser 0 o negativo), `is_default`, `display_order`.
- ✅ Validación de `min_choices`/`max_choices` en el modelo (`INT NOT NULL DEFAULT 0/1`).
- ❌ Grupos de modificadores compartidos entre ítems (p. ej. mismo grupo "Punto de la carne" para todos los filetes) — hoy son 1:N ítem.
- ❌ Modificadores anidados (modificador que activa un sub-grupo: "añadir salsa" → "¿cuál salsa?").
- ❌ Modificadores con stock propio (p. ej. trufa: límite de unidades al día).
- ❌ Modificadores excluyentes entre sí dentro del mismo grupo (radio vs checkbox).
- ❌ Modificador con alérgeno propio (p. ej. añadir queso introduce lactosa).
- ❌ Grupos de modificadores con `is_required` explícito (hoy se infiere de `min_choices > 0` pero sin semántica visible en API).
- ❌ Precio diferenciado de modificador por canal (sala vs delivery).

## 5. Alérgenos e información nutricional

- ✅ Campo `allergens TEXT[]` en ítem — array libre de etiquetas de alérgenos.
- 🔧 Sin vocabulario controlado: los 14 alérgenos de la UE (Reglamento UE 1169/2011 — gluten, crustáceos, huevos, pescado, cacahuetes, soja, lácteos, frutos de cáscara, apio, mostaza, sésamo, sulfitos, altramuces, moluscos) no se validan; cualquier texto es aceptado.
- ❌ Enum o catálogo de los 14 alérgenos EU con iconos normalizados.
- ❌ Campo `may_contain_allergens TEXT[]` (trazas / contaminación cruzada).
- ❌ Filtro de carta por alérgeno: "mostrar solo ítems sin gluten para este cliente".
- ❌ Info nutricional: tabla de valores energéticos (kcal/kJ), macros, sal, por 100g y por ración.
- ❌ Etiquetado de aditivos / colorantes (Reglamento UE 1333/2008).
- ❌ Advertencias legales de presentación (p. ej. "los pescados/mariscos podrían contener anisakis").

## 6. Badges y etiquetas

- ✅ Campo `badges TEXT[]` en ítem — array libre de etiquetas visuales (vegano, vegetariano, picante, sin gluten, novedad, recomendado…).
- 🔧 Sin vocabulario controlado: las etiquetas son texto libre sin catálogo normalizado ni iconos asociados.
- ❌ Catálogo de badges con icono, color, descripción y orden canónico.
- ❌ Badge "recomendado" / "destacado" con priorización en la presentación de la carta.
- ❌ Badge "novedad" con fecha de caducidad automática (el ítem deja de ser "nuevo" tras N días).
- ❌ Badge "popular" calculado automáticamente desde `platform/orders` (top N por ventas).
- ❌ Badge "premium" / "chef's choice" gestionado por staff.
- ❌ Filtro de carta pública por badge (p. ej. "ver solo veganos").

## 7. Disponibilidad por franja horaria (availability windows)

- ✅ Crear ventana de disponibilidad con `scope_type` polimórfico (`menu`, `category`, `item`), `scope_id`, `days_of_week INT[]` (0=dom…6=sáb), `start_minute`, `end_minute`, `label` opcional.
- ✅ Validación de rangos: `start_minute` 0–1439, `end_minute` 0–1440.
- ✅ Ventana a nivel de menú entero, categoría o ítem individual.
- ❌ Listar ventanas de disponibilidad (`GET /v1/menu/availability-windows` — no existe).
- ❌ Actualizar / eliminar ventana (`PATCH/DELETE /v1/menu/availability-windows/:id` — no existe).
- ❌ Motor de evaluación: endpoint `GET /v1/menu/menus/:id/available-now` que aplica todas las ventanas activas para devolver solo ítems disponibles en este momento.
- ❌ Ventanas con zona horaria explícita por tenant (hoy se asume UTC o la zona del servidor).
- ❌ Ventanas de disponibilidad para fechas específicas (festivos, eventos especiales) no solo días de semana.
- ❌ Ventana de "happy hour" con precio diferenciado (no solo visibilidad).
- ❌ Múltiples ventanas por mismo scope con unión lógica (OR) — hoy no hay conflicto resuelto.
- ❌ Herencia de ventanas: ítem hereda ventana de su categoría, que hereda la del menú.
- ❌ "Siempre disponible" como estado explícito (ausencia de ventana = siempre disponible, pero no comunicado en API).

## 8. 86-list (ítems agotados temporalmente)

- ✅ Marcar ítem como agotado (`POST /v1/menu/items/:id/eighty-six` → `eighty_sixed = true`).
- ✅ Restaurar ítem agotado (`POST /v1/menu/items/:id/restore` → `eighty_sixed = false`).
- ✅ Evento Redis `menu.item.eighty_sixed` con `{ appId, tenantId, itemId, sku }` para que KDS, POS y portales actualicen en tiempo real.
- ✅ Evento Redis `menu.item.restored` al volver a stock.
- ✅ `listAvailableItems` excluye ítems con `eighty_sixed = true` o `is_available = false`.
- ❌ 86-list a nivel de modificador individual (p. ej. "trufa agotada hoy" dentro del grupo de extras).
- ❌ 86-list a nivel de categoría completa (p. ej. "sin postres esta tarde").
- ❌ 86-list con restauración automática a hora/fecha programada ("restablecer a las 18:00" / "restablecer mañana a apertura").
- ❌ Historial de 86-list con timestamps de cada entrada y salida — auditoría de roturas de stock.
- ❌ Notificación automática al chef / manager cuando un ítem se agota (REUSE `platform/notifications`).
- ❌ Vista pública de la 86-list para el equipo de sala en tiempo real (WebSocket, REUSE `platform/chat` o gateway propio).
- ❌ Integración con `platform/inventory`: reducir stock automáticamente y disparar 86 al llegar a 0 unidades.

## 9. Fotos de plato y multimedia

- ✅ `photo_url TEXT` — URL externa (legacy, sin gestión de ciclo de vida).
- ✅ `photo_object_id UUID` — referencia a objeto en `platform/storage` (MinIO/S3), añadida en migración `0002`.
- ✅ Índice sobre `photo_object_id` para consultas inversas (¿qué ítems usan este objeto?).
- 🔧 Doble campo (`photo_url` + `photo_object_id`) — transitorio, `photo_url` legacy no se elimina.
- ❌ Galería de imágenes por ítem (múltiples fotos, orden, foto principal).
- ❌ Generación automática de variantes redimensionadas / WebP vía `platform/storage` (thumbnails para carta móvil).
- ❌ Vídeo corto del plato (Reels / TikTok style) — `video_object_id`.
- ❌ Alt-text / descripción accesible de la imagen.
- ❌ Cleanup de objeto huérfano en `platform/storage` al eliminar ítem o cambiar foto.

## 10. Multi-idioma de la carta

- ❌ Traducciones de nombre y descripción por idioma (`locale`) en tabla `menu_item_translations`.
- ❌ Traducciones de categorías y modificadores.
- ❌ Idioma de presentación seleccionable en la carta pública (cabecera `Accept-Language` o parámetro `?lang=`).
- ❌ Idioma por defecto configurable por tenant.
- ❌ Workflow de traducción: estado `draft / translated / approved` por par (ítem, locale).
- ❌ Exportar textos pendientes de traducción a CSV/XLIFF para traductores externos.
- ❌ Traducción de badges y etiquetas de alérgenos.

## 11. Precios por canal y por franja horaria

- 🔧 Un único `price_cents` por ítem — sin diferenciación de canal ni franja.
- ❌ Precios por canal: `dine_in`, `delivery`, `takeaway` con margen configurable o precio absoluto.
- ❌ Precio especial por franja horaria (happy hour, menú mediodía) independiente de la ventana de disponibilidad.
- ❌ Precio especial por segmento de cliente (`loyalty_tier`: normal / VIP / empleado).
- ❌ Precio negociado por tenant (acuerdo corporativo con precio por volumen).
- ❌ Redondeo de precios por canal (reglas configurables: redondear a 0.05 €, a 0.10 €…).
- ❌ Historial de cambios de precio con `effective_from` / `effective_until` — auditoría de precios.
- ❌ Precio en divisas múltiples (precio en EUR + precio en GBP para restaurantes en zona turística fronteriza).

## 12. Combos, menús del día y packs

- 🔧 `course_type = 'combo'` existe como tipo de categoría, pero sin entidad de combo propia.
- ❌ Entidad `combo` / `set_menu`: conjunto de ítems con precio total especial (inferior a la suma individual).
- ❌ Menú del día: primer plato (elige 1 de N), segundo plato (elige 1 de N), postre, bebida + precio fijo.
- ❌ Builder de combos para el cliente: selección guiada paso a paso.
- ❌ Validación de combo al añadir al carro (REUSE `platform/basket`): todos los componentes deben estar disponibles.
- ❌ Precio de combo variable según componentes elegidos (base + delta de modificadores).
- ❌ Disponibilidad de combo con ventana propia (menú del día solo de 13:00 a 16:00).
- ❌ Calorías totales del combo calculadas dinámicamente.

## 13. IVA e impuestos

- 🔧 `currency` almacenado por ítem pero sin campo de tipo impositivo.
- ❌ Tipo de IVA por ítem: superreducido (4%), reducido (10%), general (21%) — obligatorio en España.
- ❌ Tipo de IVA por categoría (p. ej. todos los platos principales al 10%, bebidas alcohólicas al 21%).
- ❌ IVA incluido vs IVA excluido en el precio almacenado — configuración por tenant.
- ❌ Desglose de IVA en ticket / integración con `platform/pos` para correcta emisión de factura.
- ❌ Soporte multi-país: VAT UK (20%), TVA Francia (10%/20%), etc.
- ❌ Exenciones fiscales para colectivos (ONG, comedores sociales).

## 14. QR de carta y carta pública

- ❌ Generación de código QR por carta (o por tabla) que apunte a la URL pública de la carta (`/menu/:tenantSlug`).
- ❌ Endpoint público de carta sin autenticación (`config: { public: true }`) para que clientes de la mesa la lean con su móvil.
- ❌ Personalización visual de la carta pública (logo, colores, tipografía del tenant).
- ❌ Carta pública con filtros (por alérgeno, por badge, por categoría).
- ❌ Vista imprimible de la carta (PDF generado bajo demanda).
- ❌ QR por mesa que transmite el `sub_tenant_id` (local concreto) y número de mesa para integración con POS.
- ❌ Caché de carta pública en Redis con invalidación al publicar (`menu.published`).

## 15. Relación con inventory (gestión de stock de ingredientes)

- ❌ Enlace ítem ↔ SKUs de `platform/inventory` (receta simple: "una hamburguesa consume 200g de ternera y 1 panecillo").
- ❌ Descontar stock de ingredientes en `platform/inventory` al confirmar un pedido en `platform/orders`.
- ❌ Disparar 86-list automáticamente cuando un ingrediente llega a stock mínimo en `platform/inventory`.
- ❌ Vista de merma / consumo previsto por ítem y por período.
- ❌ Alertas de reaprovisionamiento derivadas de la demanda de carta (top 10 ingredientes en riesgo de rotura).

## 16. Integración con POS, KDS y orders

- 🔧 Campo `station` en ítem existe para enrutar pedido al KDS; evento `menu.item.eighty_sixed` consumible por KDS y POS.
- ❌ Sincronización activa carta → KDS: cuando se publica un menú, el KDS actualiza su vista de ítems activos en tiempo real (REUSE `menu.published`).
- ❌ Enriquecimiento del pedido en `platform/orders` con datos de la carta (nombre, foto, alérgenos, station) al crear línea de pedido — hoy `platform/orders` solo conoce `catalog_item_id` de `platform/catalog`.
- ❌ Validación de disponibilidad en `platform/basket` / `platform/orders` antes de confirmar: ítem en 86-list o ventana cerrada → error con mensaje legible.
- ❌ Precio activo en el momento del pedido ("precio capturado") — `platform/orders` debe capturar el `price_cents` vigente, no referenciarlo dinámicamente.
- ❌ `platform/pos`: abrir un ítem de carta directamente desde el TPV con modificadores seleccionados.
- ❌ Impresión de ticket con nombre de ítem y modificadores seleccionados (integración `platform/pos`).

## 17. Multi-tenant y multi-local (sub_tenant_id)

- ✅ Aislamiento por `(app_id, tenant_id)` con RLS en todas las tablas.
- ✅ `sub_tenant_id` almacenado en `menus` para escenarios multi-local (un tenant con varios locales).
- 🔧 `sub_tenant_id` solo en `menus`, no propagado a categorías/ítems/modificadores como columna propia (se hereda implícitamente por FK cascade).
- ❌ Carta maestra del tenant + cartas por local con sobreescritura de precios/disponibilidad por `sub_tenant_id`.
- ❌ Ítem disponible en local A pero no en local B (disponibilidad por sub_tenant).
- ❌ Precio diferenciado por local (mismo ítem, distinto precio según local).
- ❌ Sincronización de carta maestra → locales: el staff central actualiza un ítem y se propaga a todos los locales salvo sobreescritura local.

## 18. Versionado y programación de cambios de carta

- ❌ Versión de carta con `version_number`, `published_at`, `published_by`.
- ❌ Comparación entre versiones (diff) para auditoría de cambios.
- ❌ Rollback a versión publicada anterior.
- ❌ Programar cambio de carta para fecha futura: "la nueva carta de otoño se activa el 01-09 a las 00:00" (REUSE `platform/scheduler` → job `menu-scheduled-publish`).
- ❌ Borrador editable sin afectar a la carta publicada (rama `draft` vs `live`).
- ❌ Audit log de quién cambió qué y cuándo (`changed_by`, `changed_at`, `old_value`, `new_value`).

## 19. Analítica y reporting

- ❌ Ventas por ítem de carta en un período (requiere JOIN con `platform/orders`).
- ❌ Top N ítems más pedidos (automático o exportable).
- ❌ Tasa de conversión por ítem: ratio entre ítems vistos en carta y ítems pedidos.
- ❌ Ingresos por categoría / canal / franja horaria.
- ❌ Análisis de rentabilidad por plato (precio venta − food cost − merma).
- ❌ Frecuencia de 86 por ítem — indicador de rotura de stock recurrente que justifica ajustar compras.
- ❌ Popularidad de modificadores (qué extras se eligen más).
- ❌ Export CSV de la carta con todos sus datos para hoja de cálculo.

## 20. Eventos Redis y suscriptores

- ✅ `menu.published` — publicado en `platform.events` con `{ appId, tenantId, menuId, name }`.
- ✅ `menu.item.eighty_sixed` — con `{ appId, tenantId, itemId, sku }`.
- ✅ `menu.item.restored` — con `{ appId, tenantId, itemId, sku }`.
- ❌ `menu.item.created` / `menu.item.updated` / `menu.item.deleted` — eventos de ciclo de vida de ítems para que `platform/catalog` o servicios externos sincronicen su catálogo.
- ❌ `menu.category.created` / `menu.category.updated` — para invalidación de caché o KDS.
- ❌ `menu.availability_window.updated` — para que los portales actualicen su vista "disponible ahora".
- ❌ Suscriptor en `platform/kds`: consumir `menu.item.eighty_sixed` para marcar ítem en la pantalla de cocina sin recargar.
- ❌ Suscriptor en `platform/pos`: consumir `menu.published` para refrescar la carta del TPV sin reiniciar.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. **CRUD completo de carta**: `PATCH /v1/menu/menus/:id` + `DELETE` + `PATCH/DELETE` de categorías — bloqueante para cualquier admin de carta que no sea solo creación.
2. **Motor de disponibilidad `available-now`**: endpoint que evalúa ventanas activas en tiempo real — desbloqueador para POS/basket/kds.
3. **Vocabulario controlado de alérgenos** (enum de 14 UE) con validación — obligatorio en hostelería española/europea (Reglamento UE 1169/2011).
4. **IVA por ítem/categoría** — imprescindible para la integración con `platform/pos` y emisión de facturas correctas.
5. **Invalidación de 86-list por `platform/inventory`**: suscriptor en scheduler que dispara `eightySixItem` al llegar stock a 0 — REUSE de infraestructura existente, alto valor operativo.
6. **Carta pública sin auth** + generación de QR — caso de uso central en restauración (mesas con QR).
7. **Precios por canal** (`dine_in / delivery / takeaway`) — necesario en cuanto se integre con `platform/orders` por canal.
8. **Versionado y borrador** de carta — permite actualizar la carta sin interrumpir el servicio en curso.
9. **Traducciones** (multi-idioma) — prioritario en zonas turísticas; REUSE del campo `metadata JSONB` como solución interim antes de tabla dedicada.
10. **Combo / menú del día** como entidad propia — uno de los productos más rentables en hostelería; `course_type = 'combo'` ya reserva el slot semántico.
