#!/usr/bin/env bash
# Sets up Kick Rocks with Docker: writes .env with a random worker token, builds the images,
# and starts the server and the browser worker. Safe to run again; it never overwrites a token.
set -euo pipefail

cd "$(dirname "$0")"

command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/get-docker/" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required." >&2; exit 1; }

random_token() {
  if command -v openssl >/dev/null; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

touch .env
if ! grep -q '^KICKROCKS_WORKER_TOKEN=.\{16,\}' .env; then
  sed -i.bak '/^KICKROCKS_WORKER_TOKEN=/d' .env && rm -f .env.bak
  printf 'KICKROCKS_WORKER_TOKEN=%s\n' "$(random_token)" >> .env
  echo "Wrote a random KICKROCKS_WORKER_TOKEN to .env"
fi
chmod 600 .env

docker compose --profile worker up -d --build

echo
echo "Kick Rocks is starting at http://127.0.0.1:8420"
echo "Open it and set a password. Then connect a mailbox under Profiles."
