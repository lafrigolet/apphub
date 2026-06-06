---
description: Bootstrap a new app — minimal portal (landing only, no backend) with full dev + prod + CI wiring
argument-hint: <app-name>
---

# Bootstrap app `$ARGUMENTS`

Create a minimal portal for that app (landing page only — no backend services)
by executing **all** these steps in order.

> **Why this list is long**: a previous bootstrap (`js-electric`, May 2026)
> shipped only the dev pieces and triggered a prod outage. CI built and
> published a new `apphub-nginx:<sha>` image that baked in the new
> `seed/<name>.conf` referencing upstream `<name>_portal` — but the portal
> assets were never built/deployed, so the upstream pointed at nothing.
> Nginx crashed in a restart loop, Cloudflare returned HTTP 521 on **every**
> subdomain. The deploy-side steps below exist to prevent this. Don't skip
> them.

> **Modelo (ADR 017)**: todos los frontends viven en UN contenedor `portals`
> (`infra/portals/Dockerfile`): en dev son N procesos vite (HMR intacto,
> un puerto por portal), en prod un nginx-alpine sirviendo cada `dist/` en
> el MISMO puerto que su vite — los upstreams del gateway no cambian entre
> dev y prod. Un portal nuevo NO crea contenedor: se registra en el
> contenedor `portals`.

## Dev wiring

1. **Determine next available port** — check `infra/portals/portals.conf`
   and `infra/nginx/conf.d/upstream.conf` for the highest frontend port in
   use (5173+) and increment by 1.

2. **Create portal files** under `apps/<name>/<name>-portal/`:
   - `package.json` — name `@<name>/<name>-portal`; deps: react 18, react-dom,
     react-router-dom; devDeps: vite, @vitejs/plugin-react, tailwindcss,
     autoprefixer, postcss
   - `vite.config.js` — port from step 1,
     `allowedHosts: ['<name>.hulkstein.local']`, proxy `/api` →
     `http://nginx:80`, `server.host: true`
   - `index.html` — minimal HTML shell with `<div id="root">` and
     `src/main.jsx` module script
   - `src/main.jsx` — React 18 `createRoot` entry
   - `src/App.jsx` — centered "Welcome!" page using Tailwind
   - `tailwind.config.js` — content glob
     `['./index.html', './src/**/*.{js,jsx}']`
   - `postcss.config.js` — standard tailwindcss + autoprefixer plugins
   - **No Dockerfile** — the portal ships inside the shared `portals`
     container (next step).

3. **Register in the `portals` container** (`infra/portals/`):
   - `Dockerfile` — add the portal in the FOUR places the existing ones
     appear: `deps` stage (`COPY .../package.json`), `development` stage
     (`COPY` source dir), `build` stage (`COPY` source dir + a
     `pnpm --filter @<name>/<name>-portal build` line), `production` stage
     (`COPY --from=build .../dist /usr/share/nginx/html/<name>`).
   - `dev-entrypoint.sh` — add the launch line:
     ```sh
     VITE_API_BASE_URL="http://<name>.${GW}" \
       pnpm --filter @<name>/<name>-portal exec vite --host &
     ```
   - `portals.conf` — add a server block:
     ```nginx
     server {
       listen <port>;
       server_name _;
       root /usr/share/nginx/html/<name>;
       index index.html;
       include /etc/nginx/snippets/spa-locations.conf;
     }
     ```

4. **Add to `pnpm-workspace.yaml`** — append `'apps/<name>/*'` — then
   **regenerate the lockfile**: run
   `pnpm install --filter @<name>/<name>-portal` from the repo root so
   `pnpm-lock.yaml` picks up the new package. CI uses `--frozen-lockfile`;
   skipping this fails the build with `ERR_PNPM_OUTDATED_LOCKFILE`.

5. **Add NGINX upstream** in `infra/nginx/conf.d/upstream.conf` **and**
   `infra/nginx/conf.d/upstream.prod.conf` (identical since ADR 017):
   ```nginx
   upstream <name>_portal { server portals:<port>; }
   ```

6. **Add NGINX seed** `infra/nginx/seed/<name>.conf` (per-subdomain server
   block, hydrated into Redis by the gateway sidecar; baked into the nginx
   image at build):
   - `server_name <name>.hulkstein.local <name>.hulkstein.com`
   - `include /etc/nginx/snippets/platform-routes.conf`
   - `location /` → `proxy_pass http://<name>_portal` with WebSocket
     upgrade headers

7. **Add to `docker-compose.yml`** — on the existing `portals` service:
   - port mapping `'<port>:<port>'`
   - bind mounts for HMR (`src/`, `vite.config.js`, `index.html`,
     `tailwind.config.js`, `postcss.config.js`)
   No new service, no `depends_on` change (nginx already depends on
   `portals`).

## Prod / CI wiring — DO NOT SKIP

8. **`docker-compose.prod.yml`** — nothing per-portal: the single `portals`
   override (image `apphub-portals`, `target: production`) already covers
   the new portal. Just confirm it's intact.

9. **Register in `deploy/services.json`** — add
   `"apps/<name>/<name>-portal/**"` to the `paths` of the existing
   `portals` entry (do NOT create a new service). Touching
   `deploy/services.json` triggers a **full-matrix** rebuild on the next
   push (per `generate-matrix.sh`). That's the documented cost — accept it.

## Final wiring + verification

10. **Verify** by telling the user to:
    - Add `127.0.0.1 <name>.hulkstein.local` to Windows
      `C:\Windows\System32\drivers\etc\hosts`
    - Run `docker compose up -d --build portals nginx`
    - Open `http://<name>.hulkstein.local:8080`

11. **Post-commit sanity** — after the user pushes, watch the deploy run
    (`gh run watch <id>`). Confirm both `Build portals` and `Build nginx`
    succeed. If only nginx succeeded and the portals build failed, prod
    will crash on the next nginx recreate — roll back the nginx image tag
    immediately and fix the portals build before retrying.
