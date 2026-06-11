FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json            ./packages/platform-sdk/package.json
COPY apps/aikikan/aikikan-server/package.json      ./apps/aikikan/aikikan-server/package.json
COPY apps/aulavera/aulavera-server/package.json    ./apps/aulavera/aulavera-server/package.json
COPY apps/apps-servers/package.json                ./apps/apps-servers/package.json

RUN pnpm install --no-frozen-lockfile --filter @apphub/apps-servers...

COPY packages/platform-sdk                  ./packages/platform-sdk
COPY apps/aikikan/aikikan-server/src        ./apps/aikikan/aikikan-server/src
COPY apps/aikikan/aikikan-server/migrations ./apps/aikikan/aikikan-server/migrations
COPY apps/aulavera/aulavera-server/src        ./apps/aulavera/aulavera-server/src
COPY apps/aulavera/aulavera-server/migrations ./apps/aulavera/aulavera-server/migrations
COPY apps/apps-servers/src                  ./apps/apps-servers/src

WORKDIR /app/apps/apps-servers
CMD ["pnpm", "dev"]

FROM base AS production
ENV NODE_ENV=production

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/platform-sdk/package.json            ./packages/platform-sdk/package.json
COPY apps/aikikan/aikikan-server/package.json      ./apps/aikikan/aikikan-server/package.json
COPY apps/aulavera/aulavera-server/package.json    ./apps/aulavera/aulavera-server/package.json
COPY apps/apps-servers/package.json                ./apps/apps-servers/package.json

RUN pnpm install --no-frozen-lockfile --prod --filter @apphub/apps-servers...

COPY packages/platform-sdk                  ./packages/platform-sdk
COPY apps/aikikan/aikikan-server/src        ./apps/aikikan/aikikan-server/src
COPY apps/aikikan/aikikan-server/migrations ./apps/aikikan/aikikan-server/migrations
COPY apps/aulavera/aulavera-server/src        ./apps/aulavera/aulavera-server/src
COPY apps/aulavera/aulavera-server/migrations ./apps/aulavera/aulavera-server/migrations
COPY apps/apps-servers/src                  ./apps/apps-servers/src

WORKDIR /app/apps/apps-servers
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3030
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3030/health || exit 1
CMD ["node", "src/server.js"]
