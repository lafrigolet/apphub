# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
# Standalone dev image for yoga-portal. The default dev compose bundles
# yoga-portal inside the multi-service `yoga-studio` PM2 container; this
# stage exists for prod (where we run the portal as its own nginx-alpine
# container) and for cases where only the portal needs to run in isolation.
FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY apps/yoga-studio/yoga-portal/package.json ./apps/yoga-studio/yoga-portal/package.json

RUN pnpm install --no-frozen-lockfile --filter @yoga-studio/yoga-portal...

COPY packages/eslint-config ./packages/eslint-config
COPY apps/yoga-studio/yoga-portal ./apps/yoga-studio/yoga-portal

WORKDIR /app/apps/yoga-studio/yoga-portal
EXPOSE 5174
CMD ["pnpm", "dev", "--host"]

# ── Build ─────────────────────────────────────────────────────
# Build stage installs devDeps (vite) — runtime image is nginx-alpine.
FROM base AS build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/eslint-config/package.json ./packages/eslint-config/package.json
COPY apps/yoga-studio/yoga-portal/package.json ./apps/yoga-studio/yoga-portal/package.json

RUN pnpm install --frozen-lockfile --filter @yoga-studio/yoga-portal...

COPY packages/eslint-config ./packages/eslint-config
COPY apps/yoga-studio/yoga-portal ./apps/yoga-studio/yoga-portal

RUN pnpm --filter @yoga-studio/yoga-portal build

# ── Production ────────────────────────────────────────────────
FROM nginx:alpine AS production
COPY --from=build /app/apps/yoga-studio/yoga-portal/dist /usr/share/nginx/html
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost/_health || exit 1
