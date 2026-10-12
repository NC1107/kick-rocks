# syntax=docker/dockerfile:1.7

# bundled puts the reply model in the image; none leaves it out and the server falls back to the
# rules and, when one is set up, the language model. The model is a release asset pinned by digest,
# so the version stays tied to the code that reads it (labels, input format, threshold).
# It stays none until apps/server/reply-model/release.json names a published release; then pass
# REPLY_MODEL=bundled with the url and tarSha256 from that file (install.sh does).
ARG REPLY_MODEL=none
ARG REPLY_MODEL_URL=
ARG REPLY_MODEL_SHA256=

FROM node:22-bookworm-slim AS reply-model-bundled
ARG REPLY_MODEL_URL
ARG REPLY_MODEL_SHA256
ADD --checksum=sha256:${REPLY_MODEL_SHA256} ${REPLY_MODEL_URL} /reply-model.tar
RUN mkdir /reply-model && tar -xf /reply-model.tar -C /reply-model && rm /reply-model.tar

FROM node:22-bookworm-slim AS reply-model-none
RUN mkdir /reply-model

FROM reply-model-${REPLY_MODEL} AS reply-model

FROM node:22-bookworm-slim AS build
# The CUDA provider is a postinstall download and a GPU is never used, so it is switched off here
# as well as by pnpm's list of packages allowed to run scripts.
ENV ONNXRUNTIME_NODE_INSTALL=skip
WORKDIR /app
# node-gyp fallback for the SQLCipher driver when no prebuilt binary matches the image.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/agent-worker/package.json apps/agent-worker/
COPY apps/stealth-browser/package.json apps/stealth-browser/
COPY e2e/package.json e2e/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/brokers/package.json packages/brokers/
COPY packages/legal/package.json packages/legal/
COPY packages/recipes/package.json packages/recipes/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm data:build && pnpm build
RUN pnpm --filter @kickrocks/server --prod deploy --legacy /out/server
# onnxruntime-node carries a binary for every platform (288 MB). Only the one this image runs on
# is kept, which is 45 MB on x64. There are no musl builds, so the base image must stay Debian.
RUN set -eu; \
  case "$(uname -m)" in x86_64) keep=x64 ;; aarch64) keep=arm64 ;; *) echo "No onnxruntime binary for $(uname -m)" >&2; exit 1 ;; esac; \
  for napi in $(find -L /out/server/node_modules -type d -path '*/onnxruntime-node/bin/napi-v6'); do \
    find "$napi" -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} +; \
    find "$napi/linux" -mindepth 1 -maxdepth 1 ! -name "$keep" -exec rm -rf {} +; \
  done; \
  test -f "$(find -L /out/server/node_modules -path "*/onnxruntime-node/bin/napi-v6/linux/$keep/onnxruntime_binding.node" | head -n 1)"

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    KICKROCKS_DATA_DIR=/data \
    KICKROCKS_HOST=0.0.0.0 \
    KICKROCKS_PORT=8420 \
    KICKROCKS_WEB_DIST=/app/web \
    KICKROCKS_REPLY_MODEL_DIR=/app/reply-model \
    ORT_DISABLE_TELEMETRY=1
WORKDIR /app
# First of the app layers, because it is by far the largest and changes only with a new release.
COPY --from=reply-model /reply-model /app/reply-model
# After the heavy layers, so a new commit does not invalidate them. The build context has no .git,
# so install.sh and the CI publish job pass the stamp in.
ARG KICKROCKS_VERSION=
ARG KICKROCKS_COMMIT_DATE=
ENV KICKROCKS_VERSION=$KICKROCKS_VERSION \
    KICKROCKS_COMMIT_DATE=$KICKROCKS_COMMIT_DATE
COPY --from=build /out/server /app/server
COPY --from=build /app/apps/web/dist /app/web
COPY --from=build /app/packages/brokers/data/generated /app/server/node_modules/@kickrocks/brokers/data/generated
COPY --from=build /app/packages/db/drizzle /app/server/node_modules/@kickrocks/db/drizzle
# Owned by the unprivileged user so a fresh named volume inherits writable permissions.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8420
USER node
CMD ["node", "/app/server/dist/main.js"]
