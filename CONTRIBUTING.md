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
- [ ] No TypeScript errors (`pnpm typecheck`)
- [ ] No lint errors (`pnpm lint`)
- [ ] `.env.example` updated if new env vars were added
- [ ] Migration added (not edited) if DB schema changed
- [ ] `CHANGELOG.md` entry added for user-facing changes
- [ ] PR description explains *why*, not just *what*

## Adding a new microservice

1. Copy `services/split-payments` as a starting template
2. Rename the service directory and update `package.json` name
3. Create a new PostgreSQL schema in `infra/postgres/init/XX_schema_name.sql`
4. Add an entry to `docker-compose.yml`
5. Add the route to `infra/nginx/nginx.conf`
6. Register the pipeline in `turbo.json`
7. Add the service to the services table in `README.md`
8. Document any new environment variables in `.env.example`

## Adding a new frontend app

1. Scaffold with Vite: `pnpm create vite apps/my-app --template react-ts`
2. Add Tailwind CSS following the existing `apps/` setup
3. Add the app to `docker-compose.yml` with its own port
4. Add a DNS entry in `infra/nginx/nginx.conf` for local development
5. Import `@splitpay/sdk-js` for all API calls — never use raw fetch against services

## Database migrations

- Add a new file in `services/my-service/migrations/` with the next sequential number
- Never edit or delete existing migration files
- Migrations run automatically on service startup in development
- In production, migrations are run as a separate step before deploying

## Code review etiquette

- Review the *logic*, not the style (linters handle style)
- Suggest, don't demand: "what do you think about..." instead of "you must..."
- Approve once concerns are addressed; don't leave PRs in limbo
- Response time target: 24 hours on working days
