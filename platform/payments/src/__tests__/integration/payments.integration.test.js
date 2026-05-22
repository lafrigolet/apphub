// Placeholder de integration — el módulo `platform/payments` es hoy un
// esqueleto sin servicio de PaymentIntents. El flujo Intent → succeeded
// webhook → state machine vive en `platform/splitpay`, donde la
// suite real debería materializarse (test todos pendientes en el bloque
// de abajo). Este fichero queda registrado para que el watcher de
// `__tests__/integration/**` no lo eche en falta.
//
// Cuando `platform/payments` exponga `createPaymentIntent` propio
// (fuera del flujo splitpay), reemplazar el `describe.todo` por un
// `describe.skipIf(!process.env.MIGRATION_DATABASE_URL)` y portar los
// asserts desde splitpay/idempotency.test.js.

import { describe } from 'vitest'

describe.todo('payments — Intent → succeeded webhook → state machine (cuando exista el servicio)', () => {
  // it.todo('POST /v1/payments/intents crea el row pending')
  // it.todo('webhook payment_intent.succeeded marca el row succeeded')
  // it.todo('reintentar el mismo POST con idempotencyKey NO crea segundo Intent')
  // it.todo('un PaymentIntent fallido → status=failed + emit payment.failed event')
})
