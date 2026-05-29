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
> image was never built (not in `deploy/services.json`) so its container
> never came up. Nginx crashed in a restart loop, Cloudflare returned HTTP
> 521 on **every** subdomain. The four "deploy-side" steps below (CI
> registration, prod compose override, prod upstream, lockfile) exist to
> prevent this. Don't skip them — even for a "landing only, no backend" app
> the CI pipeline still publishes nginx in parallel and the same crash
> awaits.

## Dev wiring

1. **Determine next available port** — check `docker-compose.yml` and
   `infra/nginx/conf.d/upstream.conf` for the highest frontend port in use
   (5173+) and increment by 1.

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
   - `Dockerfile` — **multi-stage** (dev + build + production) copying the
     same pattern as `apps/aulavera/aulavera-portal/Dockerfile`:
     - `development` stage runs `pnpm dev --host` on port 5xxx
     - `build` stage runs `pnpm build` to produce `dist/`
     - `production` stage is `nginx:alpine` copying `dist/` to
       `/usr/share/nginx/html` + `infra/nginx/spa.conf` to `default.conf`,
       `EXPOSE 80`, healthcheck on `/_health`

3. **Add to `pnpm-workspace.yaml`** — append `'apps/<name>/*'`

4. **Regenerate the lockfile** — run
   `pnpm install --filter @<name>/<name>-portal` from the repo root so
   `pnpm-lock.yaml` picks up the new package. CI uses `--frozen-lockfile`;
   skipping this fails the build with `ERR_PNPM_OUTDATED_LOCKFILE`.

5. **Add NGINX dev upstream** in `infra/nginx/conf.d/upstream.conf`:
   ```nginx
   upstream <name>_portal { server <name>-portal:<port>; }
   ```

6. **Add NGINX seed** `infra/nginx/seed/<name>.conf` (per-subdomain server
   block, hydrated into Redis by the gateway sidecar; baked into the nginx
   image at build):
   - `server_name <name>.hulkstein.local <name>.hulkstein.com`
   - `include /etc/nginx/snippets/platform-routes.conf`
   - `location /` → `proxy_pass http://<name>_portal` with WebSocket
     upgrade headers

7. **Add to `docker-compose.yml`** (dev compose):
   - New service `<name>-portal`: `build.target: development`,
     `context: .`, port mapping `<port>:<port>`,
     `VITE_API_BASE_URL: http://<name>.hulkstein.local:8080`, source bind
     mounts for HMR
   - Add `<name>-portal` to nginx `depends_on`

## Prod / CI wiring — DO NOT SKIP

8. **Add NGINX prod upstream** in
   `infra/nginx/conf.d/upstream.prod.conf`:
   ```nginx
   upstream <name>_portal { server <name>-portal:80; }
   ```
   (Prod portals are `nginx:alpine` serving the built `dist/` on port 80,
   not vite on 5xxx like dev.)

9. **Add prod override in `docker-compose.prod.yml`**:
   ```yaml
   <name>-portal:
     image: ${IMAGE_REGISTRY:-ghcr.io/lafrigolet}/apphub-<name>-portal:${IMAGE_TAG:-latest}
     build:
       target: production
     ports: !reset []
     volumes: !reset []
   ```
   Also add `<name>-portal: { condition: service_started }` to nginx's
   `depends_on` in the same file.

10. **Register in `deploy/services.json`** — append an entry so CI builds
    and publishes the image to GHCR:
    ```json
    {
      "name": "<name>-portal",
      "dockerfile": "apps/<name>/<name>-portal/Dockerfile",
      "paths": [
        "apps/<name>/<name>-portal/**",
        "packages/sdk-js/**",
        "pnpm-lock.yaml",
        "pnpm-workspace.yaml"
      ],
      "restart_policy": "rolling"
    }
    ```
    Touching `deploy/services.json` triggers a **full-matrix** rebuild on
    the next push (per `generate-matrix.sh`). That's the documented cost —
    accept it.

## Final wiring + verification

11. **Verify** by telling the user to:
    - Add `127.0.0.1 <name>.hulkstein.local` to Windows
      `C:\Windows\System32\drivers\etc\hosts`
    - Run `docker compose up -d --build <name>-portal nginx`
    - Open `http://<name>.hulkstein.local:8080`

12. **Post-commit sanity** — after the user pushes, watch the deploy run
    (`gh run watch <id>`). Confirm both `Build <name>-portal` and
    `Build nginx` succeed. If only nginx succeeded and the portal failed,
    prod will crash on the next nginx recreate — roll back the nginx image
    tag immediately and fix the portal build before retrying.
