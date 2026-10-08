#!/usr/bin/env bash
# Sets up and manages Kick Rocks with Docker.
#
#   ./install.sh              write .env, build the images, start everything, wait until it answers
#   ./install.sh --stop       stop every container and keep all data
#   ./install.sh --start      start the stopped containers again
#   ./install.sh --backup [FILE]   write the data volume to FILE, readable only by you
#   ./install.sh --uninstall  delete the containers, the data volume, the browser profile and the images
#   ./install.sh --url        print the address of the UI
#
# Safe to run again; it never overwrites a token.
set -euo pipefail

caller_dir="$PWD"
cd "$(dirname "$0")"

# The value of KEY in .env, or nothing when it is unset or empty.
env_value() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n 1 | sed -e "s/^\"\(.*\)\"\$/\1/" -e "s/^'\(.*\)'\$/\1/"
}

# Where the UI is reached: the public URL when one is set, else the address compose publishes.
app_url() {
  local public bind port
  public="$(env_value KICKROCKS_PUBLIC_URL)"
  if [ -n "$public" ]; then
    printf '%s\n' "${public%/}"
    return
  fi
  bind="$(env_value KICKROCKS_BIND_ADDRESS)"
  port="$(env_value KICKROCKS_HOST_PORT)"
  case "${bind:-127.0.0.1}" in 0.0.0.0|"::") bind=127.0.0.1 ;; esac
  bind="${bind:-127.0.0.1}"
  case "$bind" in
    \[*) ;;
    *:*) bind="[$bind]" ;;
  esac
  printf 'http://%s:%s\n' "$bind" "${port:-8420}"
}

if [ "${1:-}" = "--url" ]; then
  app_url
  exit 0
fi

command -v docker >/dev/null || { echo "Docker is required: https://docs.docker.com/get-docker/" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required." >&2; exit 1; }

# Every profile is named, so stop and uninstall reach the optional agent worker even when .env does not list it.
ALL_PROFILES=(--profile worker --profile agent)

random_token() {
  if command -v openssl >/dev/null; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

data_volume() {
  printf '%s_kickrocks-data\n' "$(docker compose config | sed -n 's/^name: //p')"
}

# Whether the person has already set a password, so a second run does not ask for one again.
password_is_set() {
  local state
  state="$(docker compose exec -T server node -e 'fetch("http://127.0.0.1:8420/api/auth/state").then((r) => r.text()).then(console.log)' 2>/dev/null || true)"
  case "$state" in
    *'"setupRequired":false'*) return 0 ;;
    *) return 1 ;;
  esac
}

backup_hint() {
  echo
  echo "Your data and its key live in one docker volume. Back it up with:"
  echo "  ./install.sh --backup"
  echo "Keep that file off shared and cloud storage: it holds the key to everything in it."
}

backup() {
  local file="${1:-$HOME/kickrocks-backup-$(date +%Y%m%d-%H%M%S).tgz}" volume
  volume="$(data_volume)"
  docker volume inspect "$volume" >/dev/null 2>&1 || { echo "No data volume named $volume yet." >&2; exit 1; }
  case "$file" in
    /*) ;;
    *) file="$caller_dir/$file" ;;
  esac
  case "$(cd "$(dirname "$file")" && pwd)/" in
    "$PWD"/*) echo "Refusing to write the backup inside the repository: it holds the database key." >&2; exit 1 ;;
  esac
  # A copy of a running database can be inconsistent, so everything stops for the copy.
  # Only what was running comes back, so a service stopped on purpose stays stopped.
  was_running=()
  mapfile -t was_running < <(docker compose "${ALL_PROFILES[@]}" ps --services --status running)
  docker compose "${ALL_PROFILES[@]}" stop
  if [ "${#was_running[@]}" -gt 0 ]; then
    trap 'docker compose "${ALL_PROFILES[@]}" start "${was_running[@]}" >/dev/null' EXIT
  fi
  # tar runs as root inside the container because it must read the key, but the archive is written
  # by this shell, so it belongs to the invoking user and no one else can read it.
  (umask 077 && docker run --rm -v "$volume":/data:ro alpine tar czf - -C /data . >"$file")
  echo "Wrote $file (readable only by you). It contains the database key: keep it off shared and cloud storage."
}

uninstall() {
  echo "This deletes the Kick Rocks containers, the data volume (database and key), the browser profile, and the images."
  echo "Back up first with ./install.sh --backup if you might want your data again."
  read -r -p 'Type "delete" to continue: ' answer
  [ "$answer" = "delete" ] || { echo "Nothing was changed."; exit 1; }
  docker compose "${ALL_PROFILES[@]}" down --volumes --rmi all --remove-orphans
  echo "Removed. The folder $PWD and its .env are still here; delete the folder when you are done."
}

# The host's IANA time zone, or nothing when it cannot be told. The containers run on UTC unless
# told otherwise, which would put quiet hours at the wrong time of day and make the browser report
# a zone that does not match the home address.
host_timezone() {
  local zone link
  if command -v timedatectl >/dev/null 2>&1; then
    zone="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
  fi
  if [ -z "${zone:-}" ] && [ -L /etc/localtime ]; then
    link="$(readlink /etc/localtime)"
    zone="${link#*zoneinfo/}"
  fi
  if [ -z "${zone:-}" ] && [ -f /etc/timezone ]; then
    zone="$(head -n 1 /etc/timezone)"
  fi
  case "${zone:-}" in
    ""|*[!A-Za-z0-9_+/-]*) ;;
    *) printf '%s\n' "$zone" ;;
  esac
}

# Writes TZ to .env once, so a time zone the person set by hand is never overwritten.
ensure_timezone() {
  local zone
  [ -z "$(env_value TZ)" ] || return 0
  zone="$(host_timezone)"
  if [ -z "$zone" ]; then
    echo "Could not read this machine's time zone. Set TZ in .env, such as TZ=America/Los_Angeles, so quiet hours use your local time." >&2
    return 0
  fi
  sed -i.bak '/^TZ=/d' .env && rm -f .env.bak
  printf 'TZ=%s\n' "$zone" >> .env
  echo "Wrote TZ=$zone to .env"
}

# With the worker in COMPOSE_PROFILES, plain `docker compose up`, `stop` and `down` reach it too.
# An install from before the worker was a profile gets it added here.
ensure_worker_profile() {
  local profiles
  touch .env
  profiles="$(env_value COMPOSE_PROFILES)"
  case ",$profiles," in
    *,worker,*) ;;
    *)
      sed -i.bak '/^COMPOSE_PROFILES=/d' .env && rm -f .env.bak
      printf 'COMPOSE_PROFILES=%s\n' "${profiles:+$profiles,}worker" >> .env
      echo "Set COMPOSE_PROFILES=${profiles:+$profiles,}worker in .env"
      ;;
  esac
}

case "${1:-}" in
  --stop)
    docker compose "${ALL_PROFILES[@]}" stop
    echo "Stopped. Your data is untouched. Run ./install.sh --start to bring it back."
    exit 0
    ;;
  --start)
    ensure_worker_profile
    docker compose up -d --wait
    echo "Kick Rocks is running at $(app_url)"
    exit 0
    ;;
  --backup)
    backup "${2:-}"
    exit 0
    ;;
  --uninstall)
    uninstall
    exit 0
    ;;
  "") ;;
  *)
    echo "Unknown option: $1" >&2
    exit 2
    ;;
esac

touch .env
if ! grep -q '^KICKROCKS_WORKER_TOKEN=.\{16,\}' .env; then
  sed -i.bak '/^KICKROCKS_WORKER_TOKEN=/d' .env && rm -f .env.bak
  printf 'KICKROCKS_WORKER_TOKEN=%s\n' "$(random_token)" >> .env
  echo "Wrote a random KICKROCKS_WORKER_TOKEN to .env"
fi
ensure_worker_profile
ensure_timezone
chmod 600 .env

docker compose up -d --build --wait --wait-timeout 180 || {
  echo >&2
  echo "Kick Rocks did not become ready. See why with: docker compose logs server" >&2
  exit 1
}

echo
echo "Kick Rocks is running at $(app_url)"
if password_is_set; then
  echo "A password is already set, so sign in with it."
else
  echo "Open it, set a password, and create a profile with your name, email, and state."
fi
backup_hint
