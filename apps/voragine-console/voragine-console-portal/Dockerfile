# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/voragine-console/voragine-console-portal/package.json ./apps/voragine-console/voragine-console-portal/

RUN pnpm install --no-frozen-lockfile --filter @voragine-console/voragine-console-portal

COPY apps/voragine-console/voragine-console-portal/ ./apps/voragine-console/voragine-console-portal/

WORKDIR /app/apps/voragine-console/voragine-console-portal
EXPOSE 5177
CMD ["pnpm", "dev"]

# ── Build ─────────────────────────────────────────────────────
# Build stage installs devDeps (vite) — runtime image is nginx-alpine.
FROM base AS build

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/voragine-console/voragine-console-portal/package.json ./apps/voragine-console/voragine-console-portal/

RUN pnpm install --frozen-lockfile --filter @voragine-console/voragine-console-portal

COPY apps/voragine-console/voragine-console-portal/ ./apps/voragine-console/voragine-console-portal/

RUN pnpm --filter @voragine-console/voragine-console-portal build

# ── Production ────────────────────────────────────────────────
FROM nginx:alpine AS production
COPY --from=build /app/apps/voragine-console/voragine-console-portal/dist /usr/share/nginx/html
COPY infra/nginx/spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/_health || exit 1
