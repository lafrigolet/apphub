# Casos de uso — `platform/catalog` (platform-marketplace)

> Dominio: catálogo de productos y servicios. Gestión de ítems, variantes, categorías, precios, atributos, imágenes, ciclo de vida editorial (borrador / publicado / archivado) y versionado. Consumido por cualquier app que necesite exponer un listado vendible (marketplace, tienda, directorio de servicios, menú digital, etc.).

## Estado actual (implementado)

Tabla `platform_catalog.items` con `(app_id, tenant_id, sub_tenant_id, name, description, price_cents, currency, category, metadata JSONB, active, status, version_number, published_at)` protegida por RLS por `(app_id, tenant_id)`. Galería de imágenes en `item_images` (referencia a `platform_storage.objects`). Historial de versiones publicadas en `item_versions` (snapshot JSONB, `actor_user_id`). CRUD completo + búsqueda básica por texto (ILIKE). Transición de estado `draft/published/archived` con snapshot automático. Import/export CSV. Guard `appGuard` + identidad JWT. Eventos de dominio Redis (`catalog.item.created/updated/published/archived/deleted`) en `platform.events`. Paginación `?limit/?offset`. Soft-delete (`deleted_at`) + restore. SEO básico (`slug` único, `meta_title`, `meta_description`). Discriminador `item_type`. Categorías jerárquicas (`categories.parent_id`) + relación M:N `item_categories`.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Gestión básica de ítems (CRUD)

- ✅ Crear ítem (`POST /v1/items`) con `name, description, price_cents, currency, category, metadata`.
- ✅ Consultar un ítem por id (`GET /v1/items/:id`).
- ✅ Listar todos los ítems del tenant (`GET /v1/items`), con filtro `activeOnly`.
- ✅ Actualizar ítem parcial (`PATCH /v1/items/:id`): nombre, descripción, precio, moneda, categoría, metadata, activo.
- ✅ Eliminar ítem (`DELETE /v1/items/:id`) — hard delete.
- ✅ Aislamiento multi-tenant: RLS por `(app_id, tenant_id)`; `sub_tenant_id` nullable admite dos niveles de jerarquía.
- ✅ Soft-delete (borrado lógico) con `deleted_at` (`POST /v1/items/:id/soft-delete`) para preservar referencias en pedidos históricos; las lecturas excluyen borrados salvo `?includeDeleted=true`.
- ✅ Restauración de ítems eliminados (`POST /v1/items/:id/restore`).
- ❌ Auditoría de quién creó/modificó/eliminó (`actor_user_id` solo en versiones publicadas).

## 2. Ciclo de vida editorial — estados

- ✅ Estados `draft / published / archived` con transición vía `PATCH /v1/items/:id/status`.
- ✅ `published_at` se registra al publicar.
- ✅ Transición `draft → published` dispara snapshot automático en `item_versions`.
- 🔧 No se valida el diagrama de transiciones permitidas (p. ej. `archived → draft` está implícitamente permitido, sin restricción explícita).
- ❌ Transición `published → draft` ("despublicar") no genera snapshot ni evento.
- ❌ Fecha de publicación programada (`publish_at`) — publicación automática diferida (REUSE `platform/scheduler`).
- ❌ Fecha de expiración / archivado automático (`expire_at`).
- ❌ Revisión y aprobación antes de publicar (flujo de aprobación con rol `reviewer`).

## 3. Versionado y auditoría editorial

- ✅ Tabla `item_versions` con snapshot JSONB completo de cada publicación y `actor_user_id`.
- ✅ `version_number` incremental por ítem; único `(item_id, version_number)`.
- ✅ Listado de versiones (`GET /v1/items/:id/versions`).
- ❌ Consulta de un snapshot concreto (`GET /v1/items/:id/versions/:versionNumber`).
- ❌ Restaurar ("rollback") un ítem a una versión anterior.
- ❌ Diff visual entre dos versiones consecutivas.
- ❌ Snapshot incluye solo las columnas del momento de implementación — no incluye galería de imágenes ni atributos estructurados futuros.

## 4. Galería de imágenes / media

- ✅ Tabla `item_images` vinculada a `platform_storage.objects` (`object_id`).
- ✅ Múltiples imágenes por ítem con `display_order` explícito; la primera es la imagen principal (thumbnail).
- ✅ `alt_text` por imagen para accesibilidad.
- ✅ `GET /v1/items/:id/images`, `POST /v1/items/:id/images`, `DELETE /v1/items/:id/images/:imageId`.
- ❌ Reordenación masiva de imágenes (`PATCH /v1/items/:id/images/reorder`) — ahora solo se puede reordenar recreando registros.
- ❌ Marcado explícito de imagen primaria (hoy por convención de `display_order = 0`).
- ❌ Vídeos / embeds de YouTube/Vimeo como media alternativa.
- ❌ Generación de miniaturas / variantes de resolución (REUSE `platform/storage` + procesado asíncrono).
- ❌ Validación de tipo MIME / peso máximo en el side del catálogo (hoy delega en storage).
- ❌ CDN cache-busting al cambiar imágenes.

## 5. Búsqueda y filtrado

- ✅ Búsqueda básica por texto `?q=` sobre `name ILIKE` y `description ILIKE`.
- ✅ Filtro `activeOnly` (activo/todos).
- 🔧 Búsqueda ILIKE sin índice `pg_trgm` — rendimiento degradado con catálogos grandes; comentario en repo lo señala.
- ✅ Paginación `?limit/?offset` en `GET /v1/items` (devuelve `{ data, total, limit, offset }`); sin `limit` mantiene la lista plana (back compat).
- ❌ Búsqueda full-text con pesos diferenciados (nombre > descripción) usando `tsvector/tsquery`.
- ❌ Búsqueda difusa (fuzzy) con `pg_trgm` / Trigram.
- ❌ Filtro por categoría, estado, rango de precio, moneda, `active`.
- ❌ Ordenación configurable (`?sort=price_asc|price_desc|name|created_at|updated_at`).
- ❌ Facetas / agregaciones para UI de filtros (conteo por categoría, rango de precios).
- ❌ Búsqueda en atributos/metadata JSONB.
- ❌ Autocompletado / suggest (prefix search).
- ❌ Integración con motor de búsqueda externo (Elasticsearch / Meilisearch / pgvector).

## 6. Categorías y colecciones

- 🔧 `category` existe como campo `TEXT` libre por ítem — coexiste con la tabla normalizada (no se eliminó por compatibilidad).
- ✅ Tabla `categories` con `id, name, slug, parent_id` (árbol jerárquico). CRUD vía `GET/POST /v1/categories`, `PATCH/DELETE /v1/categories/:id`. Borrar una categoría re-parenta sus hijos a `NULL`.
- ✅ Múltiples categorías por ítem (relación M:N `item_categories`): `GET/POST /v1/items/:id/categories`, `DELETE /v1/items/:id/categories/:categoryId`, y `GET /v1/categories/:id/items`.
- ❌ Colecciones / listas curadas (selección manual de ítems para homepage, promociones, temporadas).
- ❌ Orden de ítems dentro de una colección (`display_order`).
- ✅ Slugs de categoría únicos por `(app_id, tenant_id)` para URLs amigables y SEO.
- ✅ `description` de categoría (`display_order` también disponible). Imagen de categoría: ❌ pendiente.
- ❌ Herencia de atributos / impuestos desde la categoría.

## 7. Variantes, SKU y opciones configurables

- ❌ Tabla `item_variants` (talla, color, sabor, etc.) con `sku, price_delta_cents, stock_qty`.
- ❌ Grupos de opciones (`option_groups`: "Talla", "Color") y valores (`option_values`: "S", "M", "L").
- ❌ Matriz de variantes: combinación cartesiana de opciones → variante con su propio precio y stock.
- ❌ SKU único por variante; relación con `platform/inventory` para control de stock.
- ❌ Ítem configurable (el comprador elige opciones en la PDP antes de añadir al carrito).
- ❌ Variante predeterminada por ítem.
- ❌ Imagen específica por variante.
- ❌ Desactivar variantes individuales sin desactivar el ítem padre.

## 8. Precios — moneda, escalonado y multi-tenant

- ✅ Precio base `price_cents + currency` por ítem (EUR por defecto).
- 🔧 Una sola moneda por ítem — no hay precios múltiples en distintas monedas para el mismo ítem.
- ❌ Tabla `item_prices` (precio por moneda, por canal, por mercado).
- ❌ Precios escalonados / por volumen (`qty_from, qty_to, price_cents`).
- ❌ Precio especial por segmento de cliente (`member_price`, `b2b_price`).
- ❌ Precio específico por `sub_tenant_id` (p. ej. precio diferente para cada sucursal).
- ❌ Precio con impuesto incluido vs excluido (`tax_included: bool`) y tipo impositivo (`vat_rate`).
- ❌ Redondeo y formateo por moneda/locale.
- ❌ Historial de cambios de precio para analítica.

## 9. Descuentos, promociones y cupones

- ❌ Descuento fijo o porcentual directamente sobre el ítem (`discount_pct`, `discount_cents`, `sale_price_cents`).
- ❌ Vigencia de oferta (`sale_from / sale_until`).
- ❌ Módulo de cupones/códigos promocionales (REUSE o nuevo módulo `platform/promotions`).
- ❌ Reglas de descuento automático por volumen o categoría.
- ❌ Precio tachado / precio original visible en la PDP.
- ❌ Integración con `platform/basket` para aplicar descuentos al carrito.

## 10. Atributos, especificaciones y metadata estructurada

- 🔧 `metadata JSONB` libre — válido para MVP; sin esquema, sin validación, sin facetas.
- ❌ Tabla `attribute_definitions` (nombre, tipo: texto/número/booleano/enum, obligatorio, filtrable).
- ❌ Tabla `item_attributes` que instancia los valores de esos atributos para cada ítem.
- ❌ Herencia de atributos desde la categoría (todos los ítems de "Zapatos" tienen "Talla" y "Material").
- ❌ Atributos filtrables para facetas de búsqueda.
- ❌ Especificaciones técnicas renderizables en tabla (peso, dimensiones, material, garantía…).
- ❌ Atributos multi-idioma (traducciones por `locale`).

## 11. SEO — slugs, meta y descripción rica

- ✅ `slug` único por `(app_id, tenant_id)` para URLs amigables (`/tienda/zapatillas-running-pro`); validado kebab-case en la API.
- ✅ `meta_title` y `meta_description` por ítem (en create/update).
- ❌ `og:image` / Open Graph tags.
- ❌ `canonical_url`.
- ❌ Schema.org `Product` / `Offer` JSON-LD.
- ❌ Descripción rica (HTML/Markdown sanitizado) separada de `description` plana.
- ❌ Generación / sugerencia automática de slug desde el nombre.
- ❌ Prevención de slugs duplicados (con sufijo numérico).

## 12. Publicación, visibilidad y canales

- 🔧 `active` boolean controla visibilidad básica; `status` controla ciclo editorial — sin granularidad por canal.
- ❌ Visibilidad por canal: web pública, app móvil, API B2B, POS, quiosco.
- ❌ Visibilidad por segmento de usuario (solo miembros, solo mayoristas, solo B2C).
- ❌ Ventana horaria de disponibilidad (p. ej. menú de almuerzo 12–16h) — (REUSE `platform/menu` pattern).
- ❌ Disponibilidad geográfica (solo visible en ciertas zonas/países).
- ❌ Restricción de edad / verificación de identidad.
- ❌ Ítem exclusivo / privado accesible solo con código o invitación.

## 13. Tipos de ítem — físico, digital y servicio

- 🔧 El modelo es genérico (sirve para producto físico, digital o servicio).
- ✅ Campo `item_type`: `physical | digital | service | bundle | subscription` (default `physical`; validado en create/update). El cableado downstream (descarga/agenda/suscripción) sigue ❌.
- ❌ Ítems digitales: enlace de descarga / licencia protegida post-compra (integrar con `platform/storage`).
- ❌ Ítems de tipo servicio: vinculación a `platform/services` (duración, modalidad, agenda).
- ❌ Ítems de tipo suscripción: vinculación a `platform/subscriptions`.
- ❌ Peso y dimensiones (para cálculo de envío con `platform/shipping`).
- ❌ Código de barras / EAN / GTIN.
- ❌ Número de referencia interno / número de parte.

## 14. Bundles, kits y productos relacionados

- ❌ Tabla `item_bundles` — un ítem padre agrupa N ítems hijos con cantidad.
- ❌ Precio de bundle (fijo o calculado como suma de componentes con descuento).
- ❌ Stock de bundle derivado del stock del componente más escaso.
- ❌ Productos relacionados: `item_relations` con tipo `related | cross_sell | up_sell | replacement`.
- ❌ "Frecuentemente comprado junto" (frecuency based, derivado de datos de `platform/orders`).
- ❌ Sección "también te puede gustar" en la PDP.

## 15. Inventario — relación con `platform/inventory`

- ❌ Columna `sku` en `items` / `item_variants` como clave de enlace con `platform_inventory.stock`.
- ❌ Stock actual del ítem visible en catálogo sin cruzar esquemas (publicar evento / leer snapshot Redis).
- ❌ Indicador `in_stock / low_stock / out_of_stock` derivado de `platform/inventory`.
- ❌ Ocultar o desactivar automáticamente el ítem al llegar a stock cero.
- ❌ `backorder_allowed` — permitir venta con stock negativo.
- ❌ `max_qty_per_order` — límite de unidades por pedido.

## 16. Eventos de dominio (Redis pub/sub)

- ✅ `catalog.item.created` — ítem nuevo creado (para indexar en búsqueda, notificar integraciones…).
- ✅ `catalog.item.updated` — ítem modificado (cache-busting, re-indexación); incluye restore y transiciones de estado no-publicación.
- ✅ `catalog.item.published` — transición a estado publicado (notificar suscriptores, feed RSS).
- ✅ `catalog.item.archived` — ítem retirado del catálogo.
- ✅ `catalog.item.deleted` — ítem eliminado (limpieza en basket, wishlists); flag `hard:true|false` distingue hard de soft delete.
- ❌ Consumidores de estos eventos en `platform/basket`, `platform/orders`, `platform/inventory` (cross-cutting, fuera de `platform/catalog`).

## 17. Importación / exportación masiva

- ✅ Export CSV (`GET /v1/items/export.csv`) de todos los ítems del tenant.
- ✅ Import CSV (`POST /v1/items/import.csv`): crea o actualiza por `id`; reporta `inserted/updated/errors`.
- ✅ Parser CSV propio con soporte de campos entrecomillados y comas embebidas.
- 🔧 El CSV solo incluye columnas de la tabla principal — no exporta imágenes, atributos, variantes.
- 🔧 Sin dry-run (previsualización de cambios antes de confirmar).
- 🔧 Sin validación detallada por fila — errores se contabilizan pero no se reportan con contexto (fila, campo).
- 🔧 Columna `status` no se aplica al importar (se ignora en `importCsv`).
- ❌ Import/export XLSX (Excel).
- ❌ Import asíncrono con job de fondo para ficheros grandes (REUSE `platform/scheduler` o queue).
- ❌ Mapeo interactivo de columnas CSV (el header debe coincidir exactamente).
- ❌ Importación incremental: solo actualizar columnas presentes en el CSV.
- ❌ Exportación filtrada (por categoría, estado, rango de fechas).

## 18. Feeds externos — Google Shopping, marketplace, XML

- ❌ Feed Google Shopping / Google Merchant Center (XML/CSV con campos `g:id, g:title, g:description, g:link, g:image_link, g:price, g:availability, g:gtin, g:brand`).
- ❌ Feed XML genérico configurable (marketplace B2B, comparadores de precios).
- ❌ Feed RSS de novedades del catálogo.
- ❌ Webhook saliente al publicar/archivar ítems (para sincronizar con ERP/PIM externo).
- ❌ Integración con Facebook / Instagram Catalog (Product Catalog API).
- ❌ Exportación a formato WooCommerce / Shopify para migración.

## 19. Multi-idioma e internacionalización

- ❌ Tabla `item_translations` con `(item_id, locale, name, description, meta_title, meta_description)`.
- ❌ Fallback al idioma base si falta la traducción en el locale solicitado.
- ❌ API de contenido localizado (`GET /v1/items?locale=es`).
- ❌ Workflow de traducción: estado por locale (`untranslated / in_progress / approved`).
- ❌ Multi-moneda: precio por locale/mercado en la misma respuesta.
- ❌ Formateo de precios según locale (separador decimal, símbolo de moneda).

## 20. Marketplace multi-vendor y aprobación de productos

- ❌ Campo `vendor_id` en `items` (vendedor en un marketplace multi-vendor).
- ❌ Catálogo segregado por vendor: un vendor solo puede CRUD sus propios ítems.
- ❌ Flujo de aprobación de producto por staff del marketplace antes de publicar.
- ❌ Motivo de rechazo y comentarios de revisión.
- ❌ Comisión o porcentaje configurado por vendor / por categoría (integrar con `platform/splitpay`).
- ❌ Listado de ítems por vendor para páginas de perfil de tienda.
- ❌ Ítems en consignación vs propios del marketplace.

## 21. Analítica y reporting

- ❌ Conteo de vistas (page views) por ítem — evento `catalog.item.viewed`.
- ❌ Tasa de conversión vista → añadir al carrito → pedido.
- ❌ Ítems más vendidos (cruzando con `platform/orders`).
- ❌ Ítems sin stock agotado (cruzando con `platform/inventory`).
- ❌ Distribución de ítems por categoría, estado, rango de precios.
- ❌ Dashboard de rendimiento del catálogo con métricas de conversión.
- ❌ Export de métricas de analítica (CSV/JSON) para BI externo.

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ✅ ~~**Paginación** (`limit/offset`) en `GET /v1/items`~~ (implementado: `{ data, total, limit, offset }`, sin `limit` mantiene lista plana).
2. ✅ ~~**Eventos Redis** (`catalog.item.created/updated/published/archived`)~~ (implementado en `platform.events`, incluye `catalog.item.deleted` con flag `hard`).
3. ✅ ~~**Tabla `categories`** con `parent_id` (árbol) + relación M:N `item_categories`~~ (implementado: CRUD de categorías + asignación item↔categoría + listado por categoría).
4. ✅ ~~**`slug` único por `(app_id, tenant_id)`** + `meta_title / meta_description`~~ (implementado: slug validado kebab-case, único por tenant).
5. ✅ ~~**`item_type` discriminador** (`physical/digital/service/bundle`)~~ (implementado: columna + validación; cableado downstream pendiente).
6. **Índice `pg_trgm`** sobre `name` y activación de búsqueda fuzzy — mejora inmediata de rendimiento de búsqueda. (Pendiente: requiere `CREATE EXTENSION pg_trgm`, cross-cutting de infra/superuser.)
7. **Variantes (`item_variants`)** con SKU y `price_delta_cents` + enlace a `platform/inventory` — bloquea la mayoría de casos de uso de e-commerce reales. (Pendiente: cambio grande; ver nota.)
8. **Precios multi-moneda** (`item_prices`) — necesario para cualquier tenant con presencia internacional.
9. ✅ ~~**Soft-delete** (`deleted_at`) en lugar de hard delete~~ (implementado: `POST .../soft-delete` + `.../restore`; el `DELETE` original se mantiene como hard delete explícito).
10. **Feed Google Shopping** — alto valor comercial para tenants con tienda física/online; coste de implementación moderado sobre datos ya disponibles.
