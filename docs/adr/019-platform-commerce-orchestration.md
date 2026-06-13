# ADR 019 — Módulo `platform/commerce` (orquestación de comercio)

- **Estado:** Aceptado
- **Fecha:** 2026-06-13
- **Contexto:** backoffice de `luciapassardi` (yoga) reutilizando módulos de plataforma.

## Contexto

Varios módulos cubren piezas de "vender algo": `platform/payments` cobra
(Stripe), `platform/packages` gestiona bonos prepago, `platform/bookings`
gestiona reservas. Pero **ninguno cierra el ciclo "pago → compra cumplida"**:
al cobrarse un pago, nadie crea el bono ni confirma la reserva automáticamente.
Es un hueco genérico (cualquier app que venda online lo necesita), detectado al
construir el backoffice de luciapassardi.

Restricciones de la plataforma:
- Un módulo **no puede cruzar el esquema** de otro (regla CLAUDE.md #4/#13).
- La comunicación cross-módulo va por **eventos Redis** (`platform.events`) o por
  la API HTTP pública. El patrón ya establecido para "reaccionar a algo y
  escribir lo mío" son los **subscribers** (p.ej. `packages` consume
  `booking.completed` para descontar sesión).

## Decisión

Crear un módulo de plataforma **`platform/commerce`** (en `platform-core`,
esquema `platform_commerce`, rol `svc_platform_commerce`) que **orquesta** la
conversión de un pago en una compra cumplida, **dirigido por eventos** y sin
cruzar esquemas:

1. El cliente crea un **checkout** (`POST /v1/commerce/checkouts`) con la
   intención (`kind=package` → bono; `kind=booking` → reserva).
2. El portal crea la sesión de pago en `platform/payments` y **enlaza** el
   `transactionId` al checkout (`PATCH /v1/commerce/checkouts/:id`).
3. Al cobrar, `payments` emite `payment.succeeded`; commerce **casa** el checkout
   por `provider_tx_id`, lo marca `paid` y **emite `commerce.purchase.paid`**.
4. El **módulo dueño** consume ese evento y cumple, escribiendo SU esquema:
   - `platform/packages` → crea el bono (`handleCommercePaid`).
   - `platform/bookings` → confirma la reserva (`commerce-paid.handler`).

## Alternativas descartadas

- **Extender `payments`** para crear bonos/confirmar reservas: rompería el
  boundary (payments escribiría en packages/bookings) y acoplaría dominios.
- **Que commerce llame por HTTP a packages/bookings** en el subscriber: el
  subscriber no tiene JWT de usuario; requeriría un token de servicio. El patrón
  de eventos ya existente es más simple y respeta los boundaries.
- **Servidor app-local (`luciapassardi-server`)**: la lógica "vender bono/clase"
  es genérica y la querrán otras apps → mejor en plataforma (reuse > local).

## Consecuencias

- (+) Reutilizable por cualquier app; cada módulo sigue siendo dueño de su
  esquema; idempotente (un único `commerce.purchase.paid` por checkout).
- (−) Un salto de evento extra (payment → commerce → fulfillment) y una pequeña
  extensión-subscriber en `packages` y `bookings`.
- El feed de "próximos eventos" y el horario de la landing pasan a leer datos
  reales de `platform/services`; los recordatorios salen gratis del
  `platform-scheduler` (booking-reminders, package-expiry-warning).
