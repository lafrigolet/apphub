# ADR 014 — `chat` module + the platform's first WebSocket gateway

**Status:** Accepted

## Context

Apps need in-app chat between their members: support (member ↔ staff/agent),
1-on-1 (direct), and group conversations. The only existing messaging is
`platform/messaging` (in platform-**marketplace**): strictly 1:1 buyer↔vendor,
tied to `order_id`, with anti-disintermediation PII redaction that is wrong for
internal member chat. [ADR 010](010-messaging-realtime-deferred.md) deferred
real-time for that module (polling now, WebSocket later).

The new requirement is explicit: chat must work **browser-to-browser in real
time**. The platform had **no** WebSocket/SSE anywhere — all delivery was Redis
pub/sub + HTTP polling.

## Decision

1. **New horizontal module `platform/chat`** in platform-core (schema
   `platform_chat`, role `svc_platform_chat`), reusable by every app — not an
   extension of marketplace `messaging` (different domain, no order coupling, no
   forced redaction, plus groups + support). Multi-tenant by RLS like every
   other platform-core module (`current_setting('app.app_id'/'app.tenant_id')`).

2. **First WebSocket gateway in the platform.** `GET /v1/chat/ws` via
   `@fastify/websocket`, registered once on the root platform-core app. The
   handshake authenticates the JWT from the **query string** (or
   `Sec-WebSocket-Protocol`) because browsers can't set an `Authorization`
   header on a WS connection — verified in-module (HS256 signature when
   `PLATFORM_JWT_SECRET` is set, else decode-only, matching `appGuard`).

3. **Cross-instance fan-out over Redis.** After a write commits, the service
   publishes an rt frame to `chat:rt:{appId}:{tenantId}` carrying
   `recipientUserIds`. Every platform-core instance `psubscribe`s `chat:rt:*`
   and forwards each frame to its locally-connected sockets whose user is a
   recipient. This makes delivery work browser-to-browser across replicas
   without sticky sessions.

4. **Single write path.** Message *sending* always goes through the REST POST
   (persist → then fan out). The socket only carries server→client delivery and
   client→server `typing` / `presence.ping`. Keeps writes auditable and avoids a
   second validation/permission surface.

5. **Presence & typing are ephemeral** — Redis keys with TTL
   (`chat:presence:*`, `chat:typing:*`), never Postgres. They're best-effort and
   reconstructable, so durability isn't warranted.

6. **Member chat is permissive by default.** PII redaction is OFF (a per-tenant
   `settings.redaction_enabled` toggle reuses the `messaging` redact approach);
   blocks + reports provide moderation.

## Consequences

- NGINX must allow the WS upgrade on `/api/chat/ws` (Upgrade/Connection headers
  + long read timeout); the rest of `/api/chat/` is normal HTTP.
- The gateway holds in-memory socket state per process; horizontal scale relies
  on the Redis fan-out, not shared socket state. A dropped Redis subscriber
  degrades to "no real-time" (REST history still works) rather than data loss.
- This unblocks revisiting ADR 010: marketplace `messaging` could later adopt
  the same gateway pattern.

## Alternatives considered

- **Extend marketplace `messaging`** — rejected: different domain, would force
  order/redaction assumptions onto generic chat and live in the wrong monolith.
- **SSE instead of WebSocket** — one-way only; chat wants symmetric typing
  signals and a single persistent connection. WS is the better fit.
- **Polling (status quo per ADR 010)** — fails the explicit browser-to-browser
  real-time requirement.
- **A dedicated socket server / external service (e.g. Pusher)** — premature;
  Redis fan-out inside platform-core reuses existing infra and keeps the
  monolith-ready-to-split property.
