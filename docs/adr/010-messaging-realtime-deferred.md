# ADR 010 — Real-time in `messaging` deferred (polling now, WebSocket later)

## Status

Accepted — 2026-05-02. Implementation deferred; this ADR fixes the future
design so the work is not re-litigated later.

## Context

`platform/messaging` (in `platform-marketplace`) currently exposes only
synchronous REST: `GET .../threads/:id/messages`, `POST .../messages`,
`POST .../messages/:mid/read`, plus the storage-backed attachments added in
this branch. Frontends fetch updates by polling those endpoints.

`TODO.md` lists "WebSocket / SSE real-time" as `[o]` for messaging. The other
items in the marketplace block were self-contained inside one module and one
DB. Real-time touches **four components at once**:

1. nginx — needs `proxy_http_version 1.1`, the `Upgrade` header, a long
   `proxy_read_timeout`, and sticky sessions if the upstream has more than
   one replica.
2. `platform-marketplace` — needs a WebSocket plugin (`@fastify/websocket`),
   a per-thread connection registry, an authentication path that doesn't rely
   on the standard `Authorization` header (the WS handshake passes credentials
   over the upgrade URL or a sub-protocol), and idle-connection / heartbeat
   handling.
3. Redis — becomes the **broadcaster** for cross-replica fan-out. A POST to
   replica A must reach the open WebSocket on replica B; the only reasonable
   way is `PUBLISH messaging:thread:<id>` and a per-replica subscriber that
   walks its local registry on each message.
4. The frontend / SDK — needs a reconnect / catch-up policy (cursor on the
   last seen message id) and a fallback to polling when WS is unavailable.

None of those are hard individually. Together they are a deliberate
architectural step: a stateful long-lived connection layer alongside the
stateless HTTP path. Doing it half-considered tends to produce silent fan-out
bugs (some replicas miss messages) and operational drag (WS connections that
never close, sticky-session misconfig, mismatched auth between handshake and
subsequent requests).

We have other priorities to ship first; everything `messaging` does today
works on polling.

## Decision

**Keep messaging REST-only for now.** Pin the design for the eventual upgrade
so the cost of taking it on later is the cost of writing code, not the cost of
re-deciding the architecture.

When we do implement it:

- **Channel:** WebSocket via `@fastify/websocket`, exposed at
  `GET /v1/messages/threads/:id/stream` (WS upgrade).
- **Auth:** the JWT travels as a query string (`?access_token=…`) on the
  upgrade URL; the handshake validates it against the same `appGuard` used
  by REST. No reuse of the `Authorization` header — browsers don't send it
  on the WS handshake.
- **Cross-replica fan-out:** Redis Pub/Sub. Each replica subscribes to
  `messaging:thread:*` (or pattern subscribes); `messaging.service.postMessage`
  publishes after the DB INSERT; per-replica subscribers walk a local
  `Map<threadId, Set<WebSocket>>` and push to the matching connections only.
- **Sticky sessions:** nginx upstream gains `hash $http_x_forwarded_for
  consistent;` so the same client lands on the same replica across reconnects.
  Without this, single-replica deployments still work, but the moment we scale
  out we depend on it.
- **Catch-up on reconnect:** the client sends `?since=<messageId>` on the
  upgrade URL; the server replays from Postgres the messages newer than
  `since` before flipping into live mode. This makes WS recoverable across
  network glitches without losing messages.
- **REST stays.** WS is additive. Clients without a real-time need keep
  polling. Both paths are first-class.
- **No SSE.** The work to add a broadcaster is the same; WS bidirectionality
  is useful for typing indicators and presence (deferred features that the
  TODO already lists as `[ ]`).

## Why this design now

Writing the ADR up front lets the next person — possibly me, possibly you —
implement it without re-discovering the same trade-offs. The decisions above
are the *implementations* most other Node platforms (Discord, Linear, Slack)
have converged on; deviating without reason just means rediscovering their
constraints.

## Consequences

**Positive**
- Operational footprint stays exactly as today (single REST upstream, no
  long-lived connection pool to monitor).
- The DB schema and the REST surface remain stable; nothing forces a
  migration when WS lands.
- All other platform-marketplace gaps in `TODO.md` are closed; future work in
  this module is unblocked.

**Negative**
- Frontends can't build typing indicators / presence / live-receipts on top of
  messaging until WS lands; if those features become user-visible promises
  before then, we'd have to walk them back.
- Aggressive polling at scale costs more Postgres than the equivalent WS
  fan-out would. Today's volume is well under that threshold; it would only
  matter if a tenant's chat became continuously hot. Mitigate with a polite
  client poll cadence (5–10 s, backoff when idle).

**Reversible?** Yes. WS is a strict superset; adding it doesn't break
anything REST. The decisions in this ADR can also be revisited if a better
broker (NATS, Kafka, etc.) becomes part of the stack for unrelated reasons.

## Implementation TODO when revisited

1. `infra/nginx/conf.d/upstream.conf` — add `hash $http_x_forwarded_for
   consistent;` to `platform_marketplace` upstream.
2. `infra/nginx/snippets/platform-routes.conf` — long `proxy_read_timeout`
   on `/api/messages/`.
3. `platform-marketplace/server.js` — register `@fastify/websocket`.
4. `platform/messaging/src/services/ws-broker.js` (new) — local registry +
   Redis subscriber.
5. `platform/messaging/src/services/messaging.service.postMessage` — emit
   the per-thread Redis publish after DB INSERT.
6. `platform/messaging/src/routes/ws.routes.js` (new) — handshake auth +
   `since` catch-up + register/unregister socket lifecycle.
7. Frontend SDK in `apps/*/portal/src/lib/messaging-client.js` — connect WS
   when feature-flagged, fall back to polling otherwise.

Each of those is small; together they take a focused day. The decisions above
mean none of them require new design.
