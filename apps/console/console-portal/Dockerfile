# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/console/console-portal/package.json ./apps/console/console-portal/

RUN pnpm install --no-frozen-lockfile --filter @console/console-portal

COPY apps/console/console-portal/ ./apps/console/console-portal/

WORKDIR /app/apps/console/console-portal
EXPOSE 5177
CMD ["pnpm", "dev"]

# ── Build ─────────────────────────────────────────────────────
# Build stage installs devDeps (vite) — runtime image is nginx-alpine.
FROM base AS build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/console/console-portal/package.json ./apps/console/console-portal/

RUN pnpm install --frozen-lockfile --filter @console/console-portal

COPY apps/console/console-portal/ ./apps/console/console-portal/

RUN pnpm --filter @console/console-portal build

# ── Production ────────────────────────────────────────────────
FROM nginx:alpine AS production
COPY --from=build /app/apps/console/console-portal/dist /usr/share/nginx/html
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/_health || exit 1
