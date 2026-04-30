# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
# Live `pnpm dev` with HMR. Source bind-mounted from host in dev compose.
FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY apps/portal/package.json ./apps/portal/package.json

RUN pnpm install --no-frozen-lockfile --filter @splitpay/portal...

COPY packages/eslint-config ./packages/eslint-config
COPY apps/portal ./apps/portal

WORKDIR /app/apps/portal
EXPOSE 5173
CMD ["pnpm", "dev", "--host"]

# ── Build ─────────────────────────────────────────────────────
# Intermediate stage: install full deps (incl. devDeps — vite lives there)
# and emit dist/. NODE_ENV is intentionally left unset here so pnpm installs
# devDeps. The runtime image (nginx-alpine) does not run Node at all.
FROM base AS build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY apps/portal/package.json ./apps/portal/package.json

RUN pnpm install --frozen-lockfile --filter @splitpay/portal...

COPY packages/eslint-config ./packages/eslint-config
COPY apps/portal ./apps/portal

RUN pnpm --filter @splitpay/portal build

# ── Production ────────────────────────────────────────────────
# Runtime image: nginx-alpine serving the static bundle. ~20 MB, no Node.
FROM nginx:alpine AS production
COPY --from=build /app/apps/portal/dist /usr/share/nginx/html
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost/_health || exit 1
