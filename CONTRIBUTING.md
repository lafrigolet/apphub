# Contributing

## Getting started

1. Fork the repository and clone your fork
2. Follow [DEVELOPMENT.md](./DEVELOPMENT.md) to set up your local environment
3. Create a branch: `git checkout -b feat/my-feature`
4. Make your changes following [CONVENTIONS.md](./CONVENTIONS.md)
5. Add or update tests
6. Run the full test suite: `pnpm test`
7. Open a pull request against `main`

## Pull request checklist

- [ ] Tests pass locally (`pnpm test`)
- [ ] No lint errors (`pnpm lint`)
- [ ] `.env.example` updated if new env vars were added
- [ ] Migration added (not edited) if DB schema changed
- [ ] `CHANGELOG.md` entry added for user-facing changes
- [ ] PR description explains *why*, not just *what*

## Adding a new app

1. `cp -r apps/__app-template__/ apps/my-app/` — rename every `__app__` placeholder
2. Update `package.json` names (`@my-app/my-app-portal`, `@my-app/my-app-service`)
3. Assign ports: frontend 5176+, services 3030+
4. Register the app in DB: `INSERT INTO platform_tenants.apps (app_id, subdomain, …)`
5. Create a PostgreSQL schema: `infra/postgres/init/0N_my_app.sql`
6. Add containers to `docker-compose.yml`
7. Add NGINX server block `infra/nginx/conf.d/my-app.conf`:
   ```nginx
   server {
     listen 80;
     server_name myapp.hulkstein.local myapp.hulkstein.com;
     include /etc/nginx/snippets/platform-routes.conf;
     location /api/app/ { proxy_pass http://my_service/v1/; … }
     location /         { proxy_pass http://my_portal; … }
   }
   ```
8. Add upstream blocks to `infra/nginx/conf.d/upstream.conf`
9. Add `/etc/hosts` entry: `127.0.0.1 myapp.hulkstein.local`

## Adding a new app-specific microservice

1. Copy `apps/__app-template__/__app__-service/` as a starting template
2. Rename the directory and update `package.json` name
3. Create a PostgreSQL schema in `infra/postgres/init/`
4. Add an entry to `docker-compose.yml`
5. Add a `location` block to the relevant `infra/nginx/conf.d/{app}.conf`
6. Add an upstream block to `infra/nginx/conf.d/upstream.conf`
7. Set `EXPECTED_APP_ID` to the app's `app_id` in the service environment
8. Document new env vars in `.env.example`

## Adding a new platform module

The platform side ships as **three monolith containers**: `platform-core` (port 3000),
`platform-marketplace` (port 3100), `platform-restaurant` (port 3200). New cross-cutting
capabilities are added as a **module** of the monolith whose domain they fit best — not
as a new container.

1. Pick the right monolith (core / marketplace / restaurant) — see the registry in
   `CLAUDE.md`. If the new capability does not fit any existing domain, propose a fourth
   monolith via an ADR before implementing.
2. Copy any existing module (e.g. `platform/auth/`) as the template.
3. Add the schema + dedicated DB role to `infra/postgres/init/01_platform_schemas.sql`.
4. Export `register({ app, db, redis, logger })` and `runMigrations(superuserUrl)` from
   `platform/<module>/src/index.js`.
5. Wire the module into the chosen orchestrator's `moduleDescriptors` array
   (`platform/{core,marketplace,restaurant}/src/server.js`).
6. Add `DATABASE_URL_<MODULE>` and `SVC_PLATFORM_<MODULE>_DB_PASSWORD` to that
   orchestrator's service in `docker-compose.yml`, plus a volume mount for the
   module's source.
7. Add an `/api/<module>/` block in `infra/nginx/snippets/platform-routes.conf` pointing
   at the chosen orchestrator's upstream (`platform_core` / `platform_marketplace` /
   `platform_restaurant`).
8. Set `EXPECTED_APP_ID=platform` (already set on each orchestrator container).
9. Update the platform module registry in `CLAUDE.md` and the services table in
   `ARCHITECTURE.md`.

## Database migrations

- Add a new file in `{service}/migrations/` with the next sequential number
- Never edit or delete existing migration files
- Migrations run automatically on service startup in development
- In production, migrations are run as a separate step before deploying

## Code review etiquette

- Review the *logic*, not the style (linters handle style)
- Suggest, don't demand: "what do you think about…" instead of "you must…"
- Approve once concerns are addressed; don't leave PRs in limbo
- Response time target: 24 hours on working days
