FROM node:22-bookworm-slim AS build
WORKDIR /app
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
RUN pnpm install --frozen-lockfile --filter "@kickrocks/stealth-browser..."
COPY apps/stealth-browser apps/stealth-browser
RUN pnpm --filter "@kickrocks/stealth-browser" build
RUN CI=true pnpm install --frozen-lockfile --prod --filter "@kickrocks/stealth-browser..."

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DISPLAY=:99 \
    KICKROCKS_CHROME_PROFILE=/profile \
    # Docker's default seccomp profile blocks the user namespaces Chrome's sandbox needs.
    KICKROCKS_WORKER_NO_SANDBOX=true \
    KICKROCKS_WORKER_HEADLESS=false
WORKDIR /app/apps/stealth-browser
COPY --from=build /app /app
# Real Chrome on amd64; Playwright's Chromium on other architectures. Xvfb gives the
# headed browser a virtual display. tini reaps Chrome's child processes.
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
COPY apps/stealth-browser/docker-entrypoint.sh /usr/local/bin/kickrocks-stealth-browser
RUN chmod 0755 /usr/local/bin/kickrocks-stealth-browser
# Owned by the unprivileged user so a fresh named volume inherits writable permissions.
VOLUME ["/profile"]
USER node
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/kickrocks-stealth-browser"]
