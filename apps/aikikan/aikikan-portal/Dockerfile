# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/aikikan/aikikan-portal/package.json ./apps/aikikan/aikikan-portal/package.json

RUN pnpm install --no-frozen-lockfile --filter @aikikan/aikikan-portal...

COPY apps/aikikan/aikikan-portal ./apps/aikikan/aikikan-portal

WORKDIR /app/apps/aikikan/aikikan-portal
EXPOSE 5176
CMD ["pnpm", "dev", "--host"]

# ── Build ─────────────────────────────────────────────────────
# Build stage installs devDeps (vite) — runtime image is nginx-alpine.
FROM base AS build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/aikikan/aikikan-portal/package.json ./apps/aikikan/aikikan-portal/package.json

RUN pnpm install --frozen-lockfile --filter @aikikan/aikikan-portal...

COPY apps/aikikan/aikikan-portal ./apps/aikikan/aikikan-portal

RUN pnpm --filter @aikikan/aikikan-portal build

# ── Production ────────────────────────────────────────────────
FROM nginx:alpine AS production
COPY --from=build /app/apps/aikikan/aikikan-portal/dist /usr/share/nginx/html
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/_health || exit 1
