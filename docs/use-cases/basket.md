# Casos de uso — `platform/basket` (platform-marketplace)

> Dominio: carrito de compra (shopping cart) Redis-only. Añadir/actualizar/quitar ítems, guardar para después, merge de carrito invitado al hacer login, aplicar códigos promocionales, cálculo de subtotales/descuentos/envío, detección de carritos abandonados. Sin schema PostgreSQL — todo el estado vive en Redis.

## Estado actual (implementado)

Carrito por usuario autenticado (`basket:<appId>:<tenantId>:<userId>`); carrito de sesión anónima/invitada con mismo esquema de claves usando un `guestUserId` UUID generado en cliente; merge invitado → autenticado post-login (acumula cantidad en ítems coincidentes, elimina la clave invitada); guardado para después (`basket:saved:<appId>:<tenantId>:<userId>`); motor de promociones Redis-only (tipos: `percent`, `fixed_amount`, `free_shipping`, con `minSubtotalCents`, `maxUsesPerUser`, `expiresAt`, `enabled`); cálculo de resumen (`subtotalCents`, `discountCents`, `shippingCents`, `totalCents`); código promo persistido en el JSON del carrito para re-calcular sin re-aplicar; CRUD de promos por staff/admin del tenant; job de carritos abandonados en `platform-scheduler` (idle ≥24h con ítems → evento `basket.abandoned` con supresión 7 días via marker key); aislamiento multi-tenant/multi-app en todas las claves.

Leyenda: ✅ implementado · 🔧 parcial · ❌ no implementado.

---

## 1. Ciclo de vida del ítem (add / update / remove)

- ✅ Añadir ítem al carrito (`PUT /v1/basket/items`) con `itemId`, `quantity`, `name`, `priceCents`, `metadata` opcional.
- ✅ Actualizar ítem existente (mismo `itemId` → reemplaza la entrada completa, no acumula cantidad — comportamiento "set quantity").
- ✅ Quitar un ítem concreto (`DELETE /v1/basket/items/:itemId`).
- ✅ Vaciar el carrito completo (`DELETE /v1/basket`).
- ✅ Obtener el carrito actual (`GET /v1/basket`); devuelve `{ items: [] }` si vacío.
- 🔧 `upsertItem` no verifica disponibilidad de stock antes de añadir — falta integración con `platform/inventory`.
- 🔧 `priceCents` lo aporta el cliente — no se valida contra el catálogo (`platform/catalog`) en el momento de añadir.
- ✅ Incremento/decremento atómico de cantidad (`PATCH /v1/basket/items/:itemId/quantity` con `delta`, resultado clamped ≥1).
- ❌ Límite máximo de cantidad por ítem (e.g. no superar 10 unidades de un mismo producto).
- ❌ Límite máximo de líneas de carrito (e.g. no más de 100 SKUs distintos).
- ❌ Sugerencias de ítems relacionados / cross-sell al añadir.

## 2. Persistencia, TTL y expiración

- ✅ Estado persistido en Redis mediante `SET` sin TTL explícito — el carrito sobrevive reinicios del proceso.
- ✅ TTL deslizante en las claves `basket:*` — cada mutación refresca la expiración (`SET … EX`). Configurable por `BASKET_TTL_AUTH_SECONDS` (30d) y `BASKET_TTL_GUEST_SECONDS` (7d); `0` desactiva el TTL para esa clase.
- 🔧 El job `basket-abandoned` detecta idleness via `OBJECT IDLETIME` pero **no** borra la clave al emitir el evento — la clave persiste hasta que el usuario vacía el carrito o convierte a pedido.
- ❌ TTL configurable por tenant (e.g. carritos de guest expiran en 7 días, autenticados en 30 días).
- 🔧 Limpieza de claves vacías: un carrito que queda `items: []` (sin promo) se **borra** en la propia mutación (`writeBasket`); igual la lista saved-for-later vacía. Falta aún la limpieza de carritos de usuarios eliminados.
- ✅ Renovación automática del TTL con cada operación (sliding expiry) — implementado vía `SET … EX` en cada mutación; `applyPromo`/`clearPromo` usan `KEEPTTL` para no alterar la ventana.

## 3. Carrito de sesión anónima (invitado)

- ✅ Soporte de carrito para usuarios no autenticados — el cliente genera un `guestUserId` UUID y lo usa como `userId` en las llamadas.
- ✅ La clave Redis sigue el mismo layout `basket:<appId>:<tenantId>:<guestUserId>` — no hay distinción de estructura.
- 🔧 No existe endpoint dedicado de "carrito invitado" con token temporal — el cliente debe custodiar el `guestUserId` en `localStorage`.
- ❌ Carrito invitado persistido por server-side session / cookie httpOnly (sin dependencia de `localStorage`).
- ❌ Vínculo explícito entre `guestUserId` y dispositivo/IP para recuperación cross-tab.
- ❌ Indicador de si un carrito es invitado o autenticado en la respuesta del GET.

## 4. Merge invitado → autenticado (post-login)

- ✅ `POST /v1/basket/merge` con `guestUserId` — fusiona el carrito invitado en el carrito autenticado.
- ✅ Ítems presentes en ambos → se **suma** la cantidad (no se reemplaza).
- ✅ Ítems solo en el carrito invitado → se **añaden** al carrito autenticado.
- ✅ La clave invitada se elimina al final del merge (no queda duplicado en re-login desde mismo dispositivo).
- ✅ `userId === guestUserId` → no-op seguro; devuelve el carrito sin error.
- 🔧 Estrategia de merge hardcoded (`quantity sum`) — sin opción de elegir "usar solo el carrito autenticado" o "usar solo el invitado".
- ❌ Merge automático en el momento del login (hoy requiere que el cliente llame explícitamente a `/v1/basket/merge`).
- ❌ Resolución de conflictos de precio: si el mismo ítem tiene `priceCents` distinto en los dos carritos, se conserva el precio del carrito **autenticado** (comportamiento no especificado ni documentado).
- ❌ Notificación al usuario si el merge añadió ítems ("hemos recuperado tu cesta anterior").

## 5. Guardado para después (saved-for-later)

- ✅ Mover ítem de carrito → guardado (`POST /v1/basket/saved` con `itemId`).
- ✅ Listar ítems guardados (`GET /v1/basket/saved`).
- ✅ Mover ítem guardado de vuelta al carrito (`POST /v1/basket/saved/:itemId/move-back`).
- ✅ Eliminar ítem guardado (`DELETE /v1/basket/saved/:itemId`).
- ✅ `saveForLater` con `itemId` inexistente → no-op seguro.
- 🔧 La lista guardada es una estructura plana sin metadatos adicionales (fecha de guardado, motivo, prioridad).
- ❌ Wishlist como objeto de primera clase con nombre, visibilidad y capacidad de compartir (distinto de saved-for-later).
- ❌ Límite de ítems en la lista guardada.
- ❌ Migración de ítems guardados al carrito en bloque ("añadir todo a la cesta").
- ❌ Persistencia de la lista guardada para usuarios invitados.
- ❌ Recordatorio automático ("tienes 3 ítems guardados para después") — REUSE `platform/notifications`.

## 6. Cálculo de subtotales, descuentos y envío

- ✅ `GET /v1/basket/summary` calcula `subtotalCents = Σ (priceCents × quantity)`.
- ✅ `discountCents` derivado del código promo aplicado.
- ✅ `totalCents = subtotalCents − discountCents + effectiveShipping`.
- ✅ `shippingCents` pasado como query param — la API acepta el coste de envío calculado externamente.
- 🔧 El importe de envío lo calcula el cliente/llamante — no se integra con `platform/shipping` para obtener la tarifa real según peso/zona.
- ❌ Cálculo de impuestos (IVA, IGIC, GST…) sobre el subtotal o ítem a ítem.
- ❌ Desglose de impuestos en el resumen (`taxCents`, tipo impositivo por línea).
- ❌ Envío estimado gratuito a partir de umbral (`freeShippingThreshold`) configurable por tenant.
- ❌ Multi-moneda — todos los importes están en la misma moneda implícita (centavos); sin conversión ni `currencyCode`.
- ❌ Redondeo configurable por moneda (e.g. 5 céntimos de euro, 1 JPY).

## 7. Códigos promocionales y descuentos

- ✅ Aplicar código promo al carrito (`POST /v1/basket/promo` con `code`).
- ✅ Quitar código promo aplicado (`DELETE /v1/basket/promo`).
- ✅ Tipo `percent` — descuento porcentual en basis points (e.g. `1000` = 10%).
- ✅ Tipo `fixed_amount` — descuento fijo en centavos, acotado al subtotal máximo.
- ✅ Tipo `free_shipping` — elimina el coste de envío.
- ✅ Validaciones en la aplicación: promo `enabled`, `expiresAt`, `minSubtotalCents`.
- ✅ Código promo persistido en el JSON del carrito — `GET /v1/basket/summary` lo re-evalúa en cada llamada.
- ✅ Si el promo fue eliminado o deshabilitado tras ser aplicado, `basketSummary` lo descarta automáticamente.
- ✅ `maxUsesPerUser` implementada con contador Redis atómico (`INCR`/`DECR`) en `basket:promo-usage:<app>:<tenant>:<CODE>:<user>`: `applyPromo` reserva un uso (rollback si excede el límite → error `usage limit reached`); re-aplicar el mismo código ya aplicado es idempotente; `clearPromo` libera la reserva; el contador hereda el `expiresAt` del promo.
- 🔧 Un solo promo activo por carrito — no se pueden combinar múltiples códigos.
- ❌ Límite total de usos del código (`maxUsesTotal`).
- ❌ Contador de usos real en Redis o Postgres para hacer cumplir `maxUsesPerUser`.
- ❌ Descuentos automáticos (sin código): reglas por volumen, por categoría, por bundle.
- ❌ Descuentos vinculados a suscripciones (REUSE `platform/subscriptions`) o niveles de fidelidad.
- ❌ Gift cards / crédito de cuenta como forma de pago parcial.
- ❌ Descuentos anidados (e.g. primero porcentual y luego fijo).
- ❌ Historial de códigos usados por usuario.

## 8. CRUD de promociones por staff/admin del tenant

- ✅ Upsert de definición de promo (`PUT /v1/basket/promos/:code`) — requiere rol `staff | super_admin | owner | admin`.
- ✅ Listado de promos del tenant (`GET /v1/basket/promos`).
- ✅ Borrado de promo (`DELETE /v1/basket/promos/:code`).
- ✅ Promos almacenadas en Redis con clave `basket:promo:<appId>:<tenantId>:<CODE>`.
- 🔧 No hay GET individual de una promo por código para staff (solo list + evaluate implícito en applyPromo).
- ❌ Paginación en `listPromos` — hoy itera con SCAN sin límite.
- ❌ Fechas de inicio (`startsAt`) además de `expiresAt`.
- ❌ Restricción de promo a categorías de catálogo, SKUs específicos o users de un segmento.
- ❌ Migración de promos a Postgres para durabilidad garantizada (hoy solo Redis).
- ❌ Audit log de quién creó/modificó/borró cada promo.

## 9. Validación de stock (integración con `platform/inventory`)

- ❌ Verificar disponibilidad de stock al hacer `upsertItem` — comparar `quantity` solicitada con `platform/inventory`.
- ❌ Reserva temporal de stock ("hold") al añadir al carrito (liberada si el carrito expira o se vacía).
- ❌ Error / advertencia cuando el stock disminuye por debajo de la cantidad en carrito (entre add y checkout).
- ❌ Actualización automática del carrito si un ítem se queda sin stock (`out_of_stock` flag en la línea).
- ❌ Bloqueo de checkout si hay ítems sin stock suficiente.

## 10. Validación de precios contra `platform/catalog`

- 🔧 `priceCents` lo aporta el cliente — sin validación server-side contra el catálogo.
- ❌ Re-validación de precios al calcular el resumen (`GET /v1/basket/summary`) contra `platform/catalog`.
- ❌ Alerta / recálculo automático cuando el precio del catálogo cambia mientras el ítem está en el carrito.
- ❌ Precio bloqueado al añadir (snapshot) vs. precio dinámico al checkout.
- ❌ Precios por rol de usuario (socio, mayorista, staff).

## 11. Conversión a pedido (integración con `platform/orders`)

- ❌ Endpoint de checkout (`POST /v1/basket/checkout`) que convierte el carrito en un `order` via `platform/orders`.
- ❌ Limpieza atómica del carrito tras crear el pedido con éxito.
- ❌ Paso del `appliedPromo`, `discountCents` y `shippingCents` al pedido resultante.
- ❌ Idempotencia del checkout (evitar pedidos duplicados por doble click).
- ❌ Rollback del carrito si la creación del pedido falla.
- ❌ Vista previa de pedido antes de confirmar (order preview).

## 12. Carritos abandonados (integración con `platform/scheduler` + `platform/notifications`)

- ✅ Job `basket-abandoned` en `platform-scheduler` detecta carritos idle ≥24h con ≥1 ítem via `OBJECT IDLETIME`.
- ✅ Supresión de eventos duplicados: marker key `basket:abandoned-emitted:<sha>` con TTL 7 días.
- ✅ Evento `basket.abandoned` publicado en `platform.events` con `{ appId, tenantId, userId, buyerEmail, itemCount, idleSeconds, basketKey }`.
- ✅ Hydratación del `buyerEmail` desde `platform_auth.users` directamente en el job.
- 🔧 El job escanea **todas** las claves `basket:*` incluyendo `basket:saved:*` — solo filtra las que no tienen 4 segmentos, pero si cambia el layout de claves podría incluir falsos positivos.
- 🔧 No hay consumidor implementado del evento `basket.abandoned` en `platform/notifications` — la notificación al usuario no se envía.
- ❌ Email de recuperación de carrito abandonado (REUSE `platform/notifications`) con los ítems del carrito.
- ❌ Secuencia escalonada de recordatorios (T+1h "¿olvidaste algo?", T+24h descuento de recuperación).
- ❌ Exclusión de carritos de usuarios que ya compraron recientemente (REUSE `platform/orders`).
- ❌ Tasa de recuperación (carritos abandonados vs. carritos recuperados) en analítica.
- ❌ Configuración del umbral de inactividad (`IDLE_THRESHOLD_SECONDS`) por tenant.

## 13. Eventos del sistema (`basket.updated`, `basket.abandoned`)

- ✅ `basket.abandoned` publicado por el scheduler job (ver § 12).
- ✅ `basket.updated` publicado en `platform.events` tras cada mutación (`upsertItem`, `patchQuantity`, `removeItem`, `clearBasket`, `mergeBaskets`, `saveForLater`) con `{ type, appId, tenantId, userId, action, itemCount, lineCount, at }`. Best-effort: un fallo de publish no rompe la escritura del carrito.
- ❌ `basket.checkout_started` al iniciar el proceso de pago.
- ❌ `basket.checkout_completed` tras crear el pedido con éxito.
- ❌ Suscripción de otros módulos a `basket.updated` para invalidar cachés o recalcular stock reservado.

## 14. Carrito multi-vendedor (sub-carritos)

- 🔧 `metadata` libre en cada ítem permite anotar `vendorId`/`sellerId`, pero el motor no los agrupa ni valida.
- ❌ Sub-carritos agrupados por vendedor (`vendorId`) con subtotales y envíos independientes.
- ❌ Checkout separado por vendedor (un pedido por vendedor dentro de la misma cesta).
- ❌ Comisión de marketplace calculada por vendedor en el resumen.
- ❌ Restricción de combinar ítems de vendedores distintos si el tenant lo requiere.

## 15. Multi-tenant / multi-app

- ✅ Todas las claves Redis incluyen `appId` y `tenantId` — aislamiento completo entre tenants y apps.
- ✅ Los promos también son por `(appId, tenantId)` — un tenant no ve los promos de otro.
- 🔧 No hay validación de que el `appId`/`tenantId` del JWT coincida con la clave del carrito invitado al hacer merge.
- ❌ Cuotas de Redis por tenant (número máximo de ítems, claves activas).
- ❌ Configuración diferenciada de TTL, umbral de abandono, moneda por tenant.

## 16. Recuperación y portabilidad del carrito

- ✅ Un carrito persiste en Redis y se recupera en cualquier sesión mientras la clave exista.
- ❌ Recuperación de carrito desde otro dispositivo para usuarios autenticados (funciona si el userId es el mismo, pero no hay endpoint de "recuperar carrito anterior" explícito).
- ❌ Exportar carrito como enlace compartible (carrito compartido entre usuarios).
- ❌ Importar carrito desde un enlace / código QR.
- ❌ Historial de carritos anteriores (aunque se hayan vaciado o convertido en pedido).

## 17. Mini-cart y experiencia frontend

- ✅ `GET /v1/basket` devuelve el carrito completo con todos los campos necesarios para renderizar un mini-cart.
- ✅ `GET /v1/basket/summary` devuelve los totales listos para mostrar en el resumen de pago.
- ✅ Endpoint de recuento rápido (`GET /v1/basket/count`) para el badge del mini-cart sin serializar todos los ítems.
- ✅ Endpoint de "mini-cart" optimizado — `GET /v1/basket/count` devuelve `{ itemCount, lineCount, subtotalCents, appliedPromo }`.
- ❌ WebSocket / SSE para sincronización en tiempo real del carrito entre tabs/dispositivos del mismo usuario.
- ❌ Versioning / ETag para invalidación de caché en cliente.

## 18. Analítica, reporting y administración

- ❌ Panel de administración con estadísticas: carritos activos, tasa de abandono, conversión carrito→pedido.
- ❌ Valor medio de carrito por tenant y por app.
- ❌ Ítems más añadidos/eliminados del carrito (product discovery signal).
- ❌ Distribución de descuentos aplicados y su impacto en el ticket medio.
- ❌ Export (CSV/XLSX) de carritos activos para campañas de recuperación.
- ❌ Métricas de uso de códigos promo (usos totales, usos por usuario, ahorro total generado).

---

## Recomendaciones de priorización (mayor valor / menor coste)

1. ✅ ~~**TTL configurado en las claves**~~ (`EX 30d` autenticados / `EX 7d` invitados, sliding + `KEEPTTL` en promos) + borrado de claves vacías en cada mutación — implementado.
2. **Consumidor de `basket.abandoned` en `platform/notifications`** — email de recuperación de carrito; REUSE directo de infraestructura existente, alto impacto en ingresos. *(Cross-cutting: requiere cambios en `platform/notifications`.)*
3. ✅ ~~**Validación de `maxUsesPerUser`**~~ con contador Redis atómico (`INCR`/`DECR`, reserva+rollback, idempotente, liberación en `clearPromo`) — implementado.
4. **Re-validación de `priceCents` contra `platform/catalog`** al calcular el summary — imprescindible para integridad financiera en marketplaces reales.
5. **Verificación de stock en `upsertItem`** (REUSE `platform/inventory`) y advertencia en summary si stock insuficiente — desbloquea el checkout seguro.
6. **Endpoint de checkout** (`POST /v1/basket/checkout`) que crea el pedido via `platform/orders` y vacía el carrito — cierra el ciclo compra completo.
7. ✅ ~~**`basket.updated` event**~~ tras cada mutación (upsert/patch/remove/clear/merge/save) en `platform.events` — implementado (best-effort).
8. ✅ ~~**Recuento rápido**~~ (`GET /v1/basket/count` → `{ itemCount, lineCount, subtotalCents, appliedPromo }`) — implementado.
9. **Impuestos en el summary** (`taxCents`, tipo por línea) — obligatorio para mercados con IVA/GST visible en el precio final.
10. **Sub-carritos por vendedor** — necesario antes de habilitar el marketplace multi-vendedor; requiere modelo de datos en `metadata` + agrupación en el motor.
