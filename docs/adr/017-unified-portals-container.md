# ADR 017 — Single `portals` container for all frontends

## Status

Accepted — 2026-06-06.

## Context

Every app frontend shipped as its own container: 9 portals × (Vite dev server
in dev / `nginx:alpine` serving the built `dist/` in prod). The prod
containers were nearly identical — the only difference was which `dist/`
folder they served — yet each carried its own Dockerfile, compose service
(dev + prod override), GHCR image, CI matrix entry, upstream definition and
healthcheck. On a single-box deployment that is pure operational overhead.

## Decision

One `portals` container (`infra/portals/Dockerfile`) hosting all 9 frontends:

- **dev** target: 9 Vite processes in one container, launched by
  `dev-entrypoint.sh`. Container env is shared across processes, so each
  portal's `VITE_*` (notably `VITE_API_BASE_URL`, which points at its own
  subdomain) is injected **per process** by the entrypoint. HMR is intact —
  same bind mounts, same ports (5173, 5175–5182, from each `vite.config.js`).
- **production** target: `nginx:alpine` with one server block **per port**
  (the same Vite ports), each rooted at `/usr/share/nginx/html/<portal>` and
  including the shared `spa-locations.conf` (hashed-asset caching, SPA
  fallback, `/_health`). One ~160 MB image replaces nine.
- **Port-per-portal instead of Host-based routing** — deliberately. The
  gateway already picks the portal per server block (rendered dynamically
  from Redis), and `tenant-console` serves dynamic hostnames (ADR 012) that
  a static `map $host` would break. Identical ports in dev and prod also
  mean `upstream.conf` and `upstream.prod.conf` portal entries are now the
  same: `upstream <x>_portal { server portals:<port>; }`.
- The 9 per-portal Dockerfiles and `infra/nginx/spa.conf` are removed;
  `deploy/services.json` replaces 9 entries with one `portals` entry
  (image `apphub-portals`); `/opendragon-bootstrap-app` now registers new
  portals inside the shared container instead of scaffolding one.

## Consequences

- Containers: 9 frontends → 1 (dev and prod). One image to build/publish.
- **Coarser deploy granularity**: touching any portal rebuilds/redeploys the
  `portals` image with all 9. Acceptable: assets are static, rollout is
  atomic, and Docker layer cache keeps rebuild cost low. Rollback is also
  all-or-nothing for frontends.
- A broken build in ANY portal blocks the portals image (previously it only
  blocked its own). The bootstrap command's post-deploy check now watches
  `Build portals`.
- New portals are wired by editing 3 files under `infra/portals/` + the
  shared compose service — no new container, no new CI entry.

## Alternatives considered

- **Serve portal statics from the gateway nginx image** — zero extra
  containers, but couples app assets to the routing tier: every frontend
  change would redeploy the most critical piece of the stack. Rejected.
- **Host-based `map` inside a single portals nginx on one port** — breaks
  tenant-console's dynamic hostnames (ADR 012) and duplicates routing
  knowledge the gateway already owns. Rejected in favour of port-per-portal.
- **Keep per-portal containers** — correct at a scale where portals deploy
  independently by different teams; overkill for a single-box deployment.
