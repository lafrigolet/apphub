# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/aikikan/aikikan-server/package.json ./apps/aikikan/aikikan-server/

RUN pnpm install --no-frozen-lockfile --filter @aikikan/aikikan-server...

COPY apps/aikikan/aikikan-server ./apps/aikikan/aikikan-server

WORKDIR /app/apps/aikikan/aikikan-server
EXPOSE 3030
CMD ["pnpm", "dev"]

# ── Production ────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/aikikan/aikikan-server/package.json ./apps/aikikan/aikikan-server/

RUN pnpm install --frozen-lockfile --filter @aikikan/aikikan-server...

COPY apps/aikikan/aikikan-server ./apps/aikikan/aikikan-server

WORKDIR /app/apps/aikikan/aikikan-server
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3030/health', r => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1
CMD ["node", "src/server.js"]
