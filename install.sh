#!/usr/bin/env bash
# Sets up and manages Kick Rocks with Docker.
#
#   ./install.sh              write .env, build the images, start everything, wait until it answers
#   ./install.sh --stop       stop every container and keep all data
#   ./install.sh --start      start the stopped containers again
#   ./install.sh --backup [FILE]   write the data volume to FILE, readable only by you
#   ./install.sh --restore FILE    replace the data volume with the contents of a backup FILE
#   Add --passphrase-file PATH to either to encrypt the backup, or to open an encrypted one.
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

# What the EXIT trap tidies up. Set by backup and restore, which both stop the services first.
was_running=()
partial_file=""
scratch_volumes=()
# Restore sets these so an interrupted run can tell a harmless stop from a half-copied data volume.
previous_volume=""
restore_volume=""
swap_started=false
copy_over='find /to -mindepth 1 -delete && cp -a /from/. /to/'

finish() {
  [ -z "$partial_file" ] || rm -f "$partial_file"
  if [ "$swap_started" = true ]; then
    was_running=()
    echo "The restore was interrupted, so the services stay stopped: the data volume may hold a partial copy." >&2
    if [ -n "$previous_volume" ]; then
      echo "Your previous data is safe in the volume $previous_volume. Put it back with:" >&2
      echo "  docker run --rm -v $previous_volume:/from:ro -v $restore_volume:/to alpine sh -c '$copy_over'" >&2
    fi
  elif [ -n "$previous_volume" ]; then
    docker volume rm -f "$previous_volume" >/dev/null 2>&1 || true
  fi
  [ "${#scratch_volumes[@]}" -eq 0 ] || docker volume rm -f "${scratch_volumes[@]}" >/dev/null 2>&1 || true
  if [ "${#was_running[@]}" -gt 0 ]; then
    docker compose "${ALL_PROFILES[@]}" start "${was_running[@]}" >/dev/null
  fi
}

# Stops every service for a consistent copy of the volume. Only what was running comes back when the
# script ends, so a service stopped on purpose stays stopped.
stop_for_copy() {
  trap finish EXIT
  # On a new machine the project has no containers, and compose reports that as an error.
  [ -n "$(docker compose "${ALL_PROFILES[@]}" ps -a -q)" ] || return 0
  # Compose prints a blank line when nothing runs, which would otherwise become a service named "".
  mapfile -t was_running < <(docker compose "${ALL_PROFILES[@]}" ps --services --status running | sed '/^$/d')
  docker compose "${ALL_PROFILES[@]}" stop
}

absolute_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$caller_dir/$1" ;;
  esac
}

passphrase_file=""

# Reads the passphrase option that --backup and --restore share, leaving the file argument in
# archive_arg.
archive_arg=""
parse_archive_args() {
  archive_arg=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --passphrase-file)
        [ -n "${2:-}" ] || { echo "--passphrase-file needs a path." >&2; exit 2; }
        passphrase_file="$(absolute_path "$2")"
        [ -s "$passphrase_file" ] || { echo "The passphrase file $passphrase_file is missing or empty." >&2; exit 1; }
        command -v openssl >/dev/null || { echo "A passphrase needs openssl, which is not installed." >&2; exit 1; }
        shift 2
        ;;
      *)
        archive_arg="$1"
        shift
        ;;
    esac
  done
}

openssl_cipher=(openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt)

# The archive as a plain gzip tar on stdout, decrypting first when a passphrase was given.
read_archive() {
  if [ -n "$passphrase_file" ]; then
    "${openssl_cipher[@]}" -d -pass "file:$passphrase_file" -in "$1"
  else
    cat "$1"
  fi
}

encrypt_if_asked() {
  if [ -n "$passphrase_file" ]; then
    "${openssl_cipher[@]}" -pass "file:$passphrase_file"
  else
    cat
  fi
}

# openssl marks its output with this, so an encrypted archive is told apart from a plain one.
is_encrypted_archive() {
  head -c 8 "$1" 2>/dev/null | grep -aq '^Salted__'
}

# Whether an archive is a readable gzip tar that holds the database and its key.
# A truncated download or a half-written file fails the listing, and so does an archive of something else.
# A wrong passphrase decrypts to noise, which fails here too.
archive_is_intact() {
  local listing
  listing="$(read_archive "$1" 2>/dev/null | tar tz 2>/dev/null)" || return 1
  printf '%s\n' "$listing" | grep -qx '\./kickrocks\.db' || return 1
  printf '%s\n' "$listing" | grep -qx '\./db\.key'
}

# Whether the unpacked data in VOLUME opens with the key beside it. An archive can list whole and
# still hold a database that no key opens, and restoring it would swap good data for unusable data.
# It runs in the server image because that is the build that has to open the restored database.
volume_database_opens() {
  local script
  script='
    const fs = require("fs");
    const Database = require("better-sqlite3");
    const key = fs.readFileSync("/check/db.key", "utf8").trim();
    if (!/^[0-9a-f]{64}$/i.test(key)) process.exit(1);
    const db = new Database("/check/kickrocks.db", { readonly: true, fileMustExist: true });
    db.pragma("cipher=\u0027sqlcipher\u0027");
    db.pragma("legacy=4");
    db.pragma("key=\"x\u0027" + key + "\u0027\"");
    db.prepare("select count(*) from sqlite_master").get();
    if (db.pragma("quick_check", { simple: true }) !== "ok") process.exit(1);
  '
  docker compose run --rm --no-deps -T --user 0 --workdir /app/server/node_modules/@kickrocks/db -v "$1":/check \
    --entrypoint node server -e "$script" >/dev/null 2>&1
}

backup() {
  local file volume
  file="$(absolute_path "${1:-$HOME/kickrocks-backup-$(date +%Y%m%d-%H%M%S).tgz}")"
  volume="$(data_volume)"
  docker volume inspect "$volume" >/dev/null 2>&1 || { echo "No data volume named $volume yet." >&2; exit 1; }
  case "$(cd "$(dirname "$file")" && pwd)/" in
    "$PWD"/*) echo "Refusing to write the backup inside the repository: it holds the database key." >&2; exit 1 ;;
  esac
  stop_for_copy
  # The archive is built beside its destination and renamed only once it reads back whole, so a
  # failed run never replaces a good backup with a broken one.
  partial_file="$file.partial"
  # tar runs as root inside the container because it must read the key, but the archive is written
  # by this shell, so it belongs to the invoking user and no one else can read it.
  if ! (umask 077 && docker run --rm -v "$volume":/data:ro alpine tar czf - -C /data . | encrypt_if_asked >"$partial_file") || ! archive_is_intact "$partial_file"; then
    echo "The backup did not complete, so nothing was written to $file." >&2
    exit 1
  fi
  mv -f "$partial_file" "$file"
  echo "Wrote $file (readable only by you). It contains the database key: keep it off shared and cloud storage."
}

# Replaces the data volume with a backup. The archive is unpacked into a scratch volume first, so a
# bad archive is found before the live data is touched, and the old data is put back if the swap fails.
# The copy of the old data is the only way back, so it is deleted only once the restore is known good.
restore() {
  local file volume scratch previous answer had_previous=false
  [ -n "${1:-}" ] || { echo "Usage: ./install.sh --restore FILE" >&2; exit 2; }
  file="$(absolute_path "$1")"
  [ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }
  if is_encrypted_archive "$file" && [ -z "$passphrase_file" ]; then
    echo "$file is encrypted. Add --passphrase-file PATH with its passphrase." >&2
    exit 1
  fi
  archive_is_intact "$file" || { echo "$file is not a complete Kick Rocks backup, or the passphrase is wrong, so nothing was changed." >&2; exit 1; }
  volume="$(data_volume)"
  restore_volume="$volume"
  scratch="$volume-restore-$$"
  previous="$volume-previous-$$"
  echo "This replaces the data in the volume $volume with the contents of $file."
  read -r -p 'Type "restore" to continue: ' answer
  [ "$answer" = "restore" ] || { echo "Nothing was changed."; exit 1; }
  stop_for_copy
  scratch_volumes=("$scratch")
  docker volume create "$scratch" >/dev/null
  if ! read_archive "$file" | docker run --rm -i -v "$scratch":/data alpine sh -c 'tar xzf - -C /data && test -s /data/kickrocks.db && test -s /data/db.key'; then
    echo "The archive could not be unpacked, so nothing was changed." >&2
    exit 1
  fi
  if ! volume_database_opens "$scratch"; then
    echo "The database in the archive does not open with the key in it, so nothing was changed." >&2
    exit 1
  fi
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    docker volume create "$previous" >/dev/null
    previous_volume="$previous"
    if ! docker run --rm -v "$volume":/from:ro -v "$previous":/to alpine cp -a /from/. /to/; then
      docker volume rm -f "$previous" >/dev/null 2>&1 || true
      previous_volume=""
      echo "Could not copy the current data aside, so nothing was changed." >&2
      echo "A restore needs room for about three times the size of the data. Free some disk space and try again." >&2
      exit 1
    fi
    had_previous=true
  else
    docker volume create \
      --label "com.docker.compose.project=${volume%_kickrocks-data}" \
      --label com.docker.compose.volume=kickrocks-data "$volume" >/dev/null
  fi
  swap_started=true
  if ! docker run --rm -v "$scratch":/from:ro -v "$volume":/to alpine sh -c "$copy_over"; then
    echo "Swapping in the backup failed." >&2
    if [ "$had_previous" = true ] && docker run --rm -v "$previous":/from:ro -v "$volume":/to alpine sh -c "$copy_over"; then
      docker volume rm -f "$previous" >/dev/null 2>&1 || true
      previous_volume=""
      swap_started=false
      echo "The previous data is back." >&2
      exit 1
    fi
    was_running=()
    swap_started=false
    previous_volume=""
    if [ "$had_previous" = true ]; then
      echo "Putting the previous data back failed too, so the services stay stopped: $volume holds a partial copy." >&2
      echo "Your previous data is safe in the volume $previous. Put it back with:" >&2
      echo "  docker run --rm -v $previous:/from:ro -v $volume:/to alpine sh -c '$copy_over'" >&2
    fi
    exit 1
  fi
  swap_started=false
  [ "$had_previous" = false ] || docker volume rm -f "$previous" >/dev/null 2>&1 || true
  previous_volume=""
  echo "Restored $volume from $file."
  if [ "${#was_running[@]}" -eq 0 ]; then
    echo "Nothing was running, so nothing was started. Run ./install.sh to bring it up."
  fi
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
    shift
    parse_archive_args "$@"
    backup "$archive_arg"
    exit 0
    ;;
  --restore)
    shift
    parse_archive_args "$@"
    restore "$archive_arg"
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

# The build context has no .git, so the version is read here and passed in as a build argument.
if [ -z "${KICKROCKS_VERSION:-}" ]; then
  KICKROCKS_VERSION="$(git describe --tags --always --dirty 2>/dev/null || true)"
  export KICKROCKS_VERSION
fi

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
