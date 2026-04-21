FROM node:20-alpine AS base
RUN npm install -g pnpm@9
WORKDIR /app

FROM base AS development
ENV NODE_ENV=development
COPY pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY apps/voragine-console/voragine-console-portal/package.json ./apps/voragine-console/voragine-console-portal/
RUN pnpm install --no-frozen-lockfile --filter @voragine-console/voragine-console-portal
COPY apps/voragine-console/voragine-console-portal/ ./apps/voragine-console/voragine-console-portal/
WORKDIR /app/apps/voragine-console/voragine-console-portal
CMD ["pnpm", "dev"]
