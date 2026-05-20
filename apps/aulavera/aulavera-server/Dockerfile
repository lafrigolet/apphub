# ── Base ──────────────────────────────────────────────────────
FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

# ── Development ───────────────────────────────────────────────
FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/aulavera/aulavera-server/package.json ./apps/aulavera/aulavera-server/

RUN pnpm install --no-frozen-lockfile --filter @aulavera/aulavera-server...

COPY apps/aulavera/aulavera-server ./apps/aulavera/aulavera-server

WORKDIR /app/apps/aulavera/aulavera-server
EXPOSE 3031
CMD ["pnpm", "dev"]

# ── Production ────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ ./packages/
COPY apps/aulavera/aulavera-server/package.json ./apps/aulavera/aulavera-server/

RUN pnpm install --frozen-lockfile --filter @aulavera/aulavera-server...

COPY apps/aulavera/aulavera-server ./apps/aulavera/aulavera-server

WORKDIR /app/apps/aulavera/aulavera-server
EXPOSE 3031
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3031/health', r => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1
CMD ["node", "src/server.js"]
