FROM node:22-bookworm-slim AS build
WORKDIR /app
# node-gyp fallback for the SQLCipher driver when no prebuilt binary matches the image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/brokers/package.json packages/brokers/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm data:build && pnpm build
RUN pnpm --filter @kickrocks/server --prod deploy --legacy /out/server

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    KICKROCKS_DATA_DIR=/data \
    KICKROCKS_HOST=0.0.0.0 \
    KICKROCKS_PORT=8420 \
    KICKROCKS_WEB_DIST=/app/web
WORKDIR /app
COPY --from=build /out/server /app/server
COPY --from=build /app/apps/web/dist /app/web
COPY --from=build /app/packages/brokers/data/generated /app/server/node_modules/@kickrocks/brokers/data/generated
COPY --from=build /app/packages/db/drizzle /app/server/node_modules/@kickrocks/db/drizzle
VOLUME ["/data"]
EXPOSE 8420
USER node
CMD ["node", "/app/server/dist/main.js"]
