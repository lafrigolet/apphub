// Integration: PaymentIntent → succeeded webhook → state machine.
//
// The unit suite (payment-intent.service.test.js, webhook.service.test.js,
// payment.routes.test.js) already covers the full lifecycle with the Stripe SDK,
// DB and Redis mocked. A true DB-backed integration run requires a live Postgres
// (MIGRATION_DATABASE_URL) + Redis, so it is gated behind that env var and
// skipped in CI unit runs.

import { describe } from 'vitest'

describe.skipIf(!process.env.MIGRATION_DATABASE_URL)(
  'payments — Intent → succeeded webhook → state machine (DB-backed)',
  () => {
    // Port the asserts from splitpay/src/__tests__/integration when a payments
    // integration harness (real Pool + RLS context) is wired up:
    //   - POST /v1/payments/intents creates a pending transaction row
    //   - webhook payment_intent.succeeded flips the row to succeeded
    //   - replaying the same POST with the same idempotencyKey returns the
    //     original transaction and creates no second Intent
    //   - payment_intent.payment_failed → status=failed + payment.failed event
  },
)
