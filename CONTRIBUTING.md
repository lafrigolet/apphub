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
     server_name myapp.apphub.local myapp.apphub.com;
     include /etc/nginx/snippets/platform-routes.conf;
     location /api/app/ { proxy_pass http://my_service/v1/; … }
     location /         { proxy_pass http://my_portal; … }
   }
   ```
8. Add upstream blocks to `infra/nginx/conf.d/upstream.conf`
9. Add `/etc/hosts` entry: `127.0.0.1 myapp.apphub.local`

## Adding a new app-specific microservice

1. Copy `apps/__app-template__/__app__-service/` as a starting template
2. Rename the directory and update `package.json` name
3. Create a PostgreSQL schema in `infra/postgres/init/`
4. Add an entry to `docker-compose.yml`
5. Add a `location` block to the relevant `infra/nginx/conf.d/{app}.conf`
6. Add an upstream block to `infra/nginx/conf.d/upstream.conf`
7. Set `EXPECTED_APP_ID` to the app's `app_id` in the service environment
8. Document new env vars in `.env.example`

## Adding a new platform service

1. Copy any existing `platform/` service as a template
2. Assign the next port in the 3000–3009 range
3. Add the schema to `infra/postgres/init/01_platform_schemas.sql`
4. Add the service to `docker-compose.yml`
5. Add a `location` block to `infra/nginx/snippets/platform-routes.conf`
6. Add an upstream block to `infra/nginx/conf.d/upstream.conf`
7. Set `EXPECTED_APP_ID=platform`

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
