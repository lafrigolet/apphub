import { readFileSync } from 'node:fs'

// DEV-ONLY: a tiny self-contained web tester for the QR / payment-link flow.
// Served same-origin from platform-core so it needs no CORS and no separate
// static server — open it on a phone via the existing `adb reverse tcp:3000`.
// Registered only when NODE_ENV !== 'production' (see src/index.js).
const HTML = readFileSync(new URL('../dev/checkout-tester.html', import.meta.url), 'utf8')

export async function devRoutes(fastify) {
  // GET /v1/payments/dev/checkout-tester — the cashier test page (public; the
  // API calls it makes carry the cashier JWT it obtains via /v1/auth/login).
  fastify.get('/checkout-tester', {
    config: { public: true },
    schema: { hide: true },
  }, async (req, reply) => reply.type('text/html').send(HTML))
}
