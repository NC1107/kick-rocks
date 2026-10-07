FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY apps/agent-worker/package.json apps/agent-worker/
COPY e2e/package.json e2e/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/brokers/package.json packages/brokers/
COPY packages/legal/package.json packages/legal/
COPY packages/recipes/package.json packages/recipes/
# Only the agent worker and what it depends on, so the image does not build the server's native modules.
RUN pnpm install --frozen-lockfile --filter "@kickrocks/agent-worker..."
COPY packages/shared packages/shared
COPY packages/recipes packages/recipes
COPY apps/worker apps/worker
COPY apps/agent-worker apps/agent-worker
RUN pnpm --filter "@kickrocks/agent-worker..." build
# The agent worker imports the recipe worker's browser and API client from its build output, so the
# workspace is kept in place instead of being deployed as one package. Only dev dependencies go.
RUN CI=true pnpm install --frozen-lockfile --prod --filter "@kickrocks/agent-worker..."

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DISPLAY=:99 \
    KICKROCKS_CHROME_PROFILE=/profile \
    # Docker's default seccomp profile blocks the user namespaces Chrome's sandbox needs.
    KICKROCKS_WORKER_NO_SANDBOX=true \
    KICKROCKS_WORKER_HEADLESS=false
WORKDIR /app/apps/agent-worker
COPY --from=build /app /app
# Real Chrome where Google ships it (amd64), because bot checks trust it more than Chromium. Other
# architectures get Playwright's Chromium, which the worker falls back to on its own. Xvfb gives the
# headed browser a display, and tini reaps the browser's child processes.
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates tini xauth xvfb \
  && if [ "$(dpkg --print-architecture)" = "amd64" ]; then \
       node node_modules/playwright/cli.js install --with-deps chrome; \
     else \
       node node_modules/playwright/cli.js install --with-deps chromium; \
     fi \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /profile /tmp/.X11-unix /ms-playwright \
  && chmod 1777 /tmp/.X11-unix \
  && chown -R node:node /profile /ms-playwright
COPY apps/agent-worker/docker-entrypoint.sh /usr/local/bin/kickrocks-agent-worker
RUN chmod 0755 /usr/local/bin/kickrocks-agent-worker
# Owned by the unprivileged user so a fresh named volume inherits writable permissions.
VOLUME ["/profile"]
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kickrocks-agent-worker"]
