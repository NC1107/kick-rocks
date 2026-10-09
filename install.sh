#!/usr/bin/env bash
# Sets up and manages Kick Rocks with Docker.
#
#   ./install.sh              write .env, build the images, start everything, wait until it answers
#   ./install.sh --stop       stop every container and keep all data
#   ./install.sh --start      start the stopped containers again
#   ./install.sh --backup [FILE]   write the data volume to FILE, readable only by you
#   ./install.sh --restore FILE    replace the data volume with the contents of a backup FILE
#   ./install.sh --schedule-backup DIR [--keep N]   print the crontab line for a daily backup into DIR
#   ./install.sh --schedule-backup DIR --once [--keep N]   take one backup into DIR now and keep the newest N
#   Add --passphrase-file PATH to either to encrypt the backup, or to open an encrypted one.
#   The passphrase is the first line of that file.
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
  echo "Add --passphrase-file PATH to encrypt it, and keep that file apart from the backup."
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
        # Only the first line is the passphrase, so a blank one would encrypt with no passphrase at all.
        [ -n "$(head -n 1 "$passphrase_file" | tr -d '\r')" ] || { echo "The first line of the passphrase file $passphrase_file is empty." >&2; exit 1; }
        shift 2
        ;;
      *)
        archive_arg="$1"
        shift
        ;;
    esac
  done
}

# Backups before the authenticated format were written by openssl and are still read. The digest is
# pinned because OpenSSL and LibreSSL have not always agreed on a default, and the iteration count
# is not stored in those files, so it must never change here.
legacy_openssl_decrypt=(openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt)

server_image() {
  printf '%s-server\n' "$(docker compose config | sed -n 's/^name: //p')"
}

# Encrypts or decrypts stdin with the server image, which has node and no other tool that encrypts,
# so the host needs nothing installed. It runs as root because the passphrase file is readable only
# by its owner, and with no network because nothing it does needs one.
crypt() {
  docker run --rm -i --user 0 --network none --entrypoint node \
    -v "$passphrase_file":/passphrase:ro -v "$PWD/scripts/backup-crypt.mjs":/backup-crypt.mjs:ro \
    "$(server_image)" /backup-crypt.mjs "$1" /passphrase
}

# plain, legacy (openssl) or krbk (this script's format), told apart by what a file starts with.
archive_format() {
  local magic
  magic="$(head -c 8 "$1" 2>/dev/null | LC_ALL=C tr -d '\0')"
  case "$magic" in
    Salted__*) echo legacy ;;
    KRBK*) echo krbk ;;
    *) echo plain ;;
  esac
}

# The archive as a plain gzip tar on stdout, decrypting first when a passphrase was given.
read_archive() {
  if [ -z "$passphrase_file" ]; then
    cat "$1"
    return
  fi
  case "$(archive_format "$1")" in
    legacy)
      command -v openssl >/dev/null || { echo "This backup was written with openssl, which is not installed." >&2; return 1; }
      "${legacy_openssl_decrypt[@]}" -pass "file:$passphrase_file" -in "$1"
      ;;
    krbk) crypt decrypt <"$1" ;;
    *) cat "$1" ;;
  esac
}

encrypt_if_asked() {
  if [ -n "$passphrase_file" ]; then
    crypt encrypt
  else
    cat
  fi
}

is_encrypted_archive() {
  [ "$(archive_format "$1")" != plain ]
}

# Says why an archive could not be used, as far as the format lets it be told.
explain_unusable_archive() {
  local file="$1" status=0
  if [ "$(archive_format "$file")" = krbk ] && [ -n "$passphrase_file" ]; then
    read_archive "$file" >/dev/null 2>&1 || status=$?
    case "$status" in
      2) echo "The passphrase does not open $file, so nothing was changed." >&2; return ;;
      3) echo "$file is damaged or has been altered, so nothing was changed." >&2; return ;;
    esac
  elif [ "$(archive_format "$file")" = legacy ]; then
    echo "$file is not a complete Kick Rocks backup, it is damaged, or the passphrase is wrong, so nothing was changed." >&2
    return
  fi
  echo "$file is not a complete Kick Rocks backup, so nothing was changed." >&2
}

# Whether an archive is a readable gzip tar that holds the database and its key.
# A truncated download or a half-written file fails the listing, and so does an archive of something else.
# A wrong passphrase on an openssl backup decrypts to noise, which fails here too.
archive_is_intact() {
  local listing
  listing="$(read_archive "$1" 2>/dev/null | tar tz 2>/dev/null)" || return 1
  printf '%s\n' "$listing" | grep -qx '\./kickrocks\.db' || return 1
  printf '%s\n' "$listing" | grep -qx '\./db\.key'
}

# Exit status of the database check when the database is there but does not open with its key.
# Anything else non-zero means the check could not run, which says nothing about the backup.
readonly DATABASE_UNUSABLE=3

# Builds the server image with its output on screen when this machine does not have it yet, so the
# check never spends minutes building it out of sight.
ensure_server_image() {
  local project
  project="$(docker compose config | sed -n 's/^name: //p')"
  docker image inspect "$project-server" >/dev/null 2>&1 && return 0
  echo "Building the server image first, which the check of the backup needs. This takes a few minutes."
  docker compose build server
}

# Whether the unpacked data in VOLUME opens with the key beside it. An archive can list whole and
# still hold a database that no key opens, and restoring it would swap good data for unusable data.
# It runs in the server image because that is the build that has to open the restored database.
# The volume is mounted read-only and the files are opened from a copy, because opening a WAL
# database creates side files, and root-owned ones in the volume that gets swapped in would make
# every later write by the server fail.
volume_database_opens() {
  local script
  script='
    const fs = require("fs");
    const Database = require("better-sqlite3");
    const unusable = () => process.exit(Number(process.env.DATABASE_UNUSABLE));
    try {
      fs.mkdirSync("/tmp/check");
      for (const name of fs.readdirSync("/check")) {
        if (/^(kickrocks\.db(-wal)?|db\.key)$/.test(name)) fs.copyFileSync("/check/" + name, "/tmp/check/" + name);
      }
      const key = fs.readFileSync("/tmp/check/db.key", "utf8").trim();
      if (!/^[0-9a-f]{64}$/i.test(key)) unusable();
      const db = new Database("/tmp/check/kickrocks.db", { fileMustExist: true });
      db.pragma("cipher=\u0027sqlcipher\u0027");
      db.pragma("legacy=4");
      db.pragma("key=\"x\u0027" + key + "\u0027\"");
      db.prepare("select count(*) from sqlite_master").get();
      if (db.pragma("quick_check", { simple: true }) !== "ok") unusable();
    } catch {
      unusable();
    }
  '
  docker compose run --rm --no-deps -T --user 0 --workdir /app/server/node_modules/@kickrocks/db \
    -e "DATABASE_UNUSABLE=$DATABASE_UNUSABLE" -v "$1":/check:ro \
    --entrypoint node server -e "$script" >/dev/null
}

# The server reads this file to show how old the last good backup is. It is written only after the
# archive read back whole, and it is the server user's, so the server can always read it back.
record_verified_backup() {
  docker run --rm -v "$1":/data -e "VERIFIED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" alpine \
    sh -c 'echo "$VERIFIED_AT" > /data/last-backup && chown 1000:1000 /data/last-backup' \
    || echo "The backup is good, but the app could not be told about it, so it may still call the backup old." >&2
}

# The server holds every send until it has looked in the mailbox's Sent folder for mail that went
# out after the backup was taken, because the restored database never saw those sends and would
# mail the same broker again. The server user owns the file so it can remove it once it is satisfied.
record_restore() {
  docker run --rm -v "$1":/data -e "RESTORED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)" alpine \
    sh -c 'echo "$RESTORED_AT" > /data/restored-at && chown 1000:1000 /data/restored-at' \
    || echo "The restore worked, but the server could not be told to check for mail sent since the backup. Look in the mailbox's Sent folder before requests go out again." >&2
}

backup() {
  local file volume
  file="$(absolute_path "${1:-$HOME/kickrocks-backup-$(date +%Y%m%d-%H%M%S).tgz${passphrase_file:+.enc}}")"
  volume="$(data_volume)"
  docker volume inspect "$volume" >/dev/null 2>&1 || { echo "No data volume named $volume yet." >&2; exit 1; }
  case "$(cd "$(dirname "$file")" && pwd)/" in
    "$PWD"/*) echo "Refusing to write the backup inside the repository: it holds the database key." >&2; exit 1 ;;
  esac
  if [ -n "$passphrase_file" ]; then
    ensure_server_image || { echo "Could not build the server image that encrypts the backup, so nothing was written." >&2; exit 1; }
  fi
  stop_for_copy
  # The archive is built beside its destination and renamed only once it reads back whole, so a
  # failed run never replaces a good backup with a broken one.
  partial_file="$file.partial"
  # The disk reserve is 8 MB of random bytes that mean nothing outside the volume it guards. A
  # rollback copy of the database is a second, stale database that a restore would bring back.
  # tar runs as root inside the container because it must read the key, but the archive is written
  # by this shell, so it belongs to the invoking user and no one else can read it.
  if ! (umask 077 && docker run --rm -v "$volume":/data:ro alpine tar czf - --exclude ./.disk-reserve --exclude './kickrocks.db.before-*' -C /data . | encrypt_if_asked >"$partial_file") || ! archive_is_intact "$partial_file"; then
    echo "The backup did not complete, so nothing was written to $file." >&2
    exit 1
  fi
  mv -f "$partial_file" "$file"
  record_verified_backup "$volume"
  if [ -n "$passphrase_file" ]; then
    echo "Wrote $file (readable only by you, encrypted). Keep the passphrase file apart from the backup: whoever has both has the database key."
  else
    echo "Wrote $file (readable only by you). It contains the database key: keep it off shared and cloud storage."
  fi
}

# Takes one backup into DIR, then deletes all but the newest KEEP scheduled ones. Nothing is deleted
# unless the new backup read back whole, so a run that fails leaves every earlier backup in place.
# Scheduled archives have their own prefix so a folder of manual backups is never rotated away.
scheduled_backup() {
  local dir="$1" keep="$2" file stamp suffix old n=0
  suffix=".tgz${passphrase_file:+.enc}"
  (umask 077 && mkdir -p "$dir")
  stamp="$(date +%Y%m%d-%H%M%S)"
  # Name order has to be time order. The counter is fixed width, and it continues after the highest
  # one left in this second, because the newest backup is never pruned and so is always still there.
  for old in "$dir"/kickrocks-scheduled-"$stamp"-[0-9][0-9][0-9][0-9]*; do
    [ -e "$old" ] || continue
    old="${old##*-}"
    old=$((10#${old:0:4}))
    [ "$old" -le "$n" ] || n="$old"
  done
  file="$(printf '%s/kickrocks-scheduled-%s-%04d%s' "$dir" "$stamp" "$((n + 1))" "$suffix")"
  backup "$file"
  # Both kinds are rotated together, so adding or dropping a passphrase never strands the old
  # backups, which hold the database key, outside the count. The name carries the time, and the
  # suffix would only be compared after the time is equal.
  find "$dir" -maxdepth 1 -type f \( -name 'kickrocks-scheduled-*.tgz' -o -name 'kickrocks-scheduled-*.tgz.enc' \) -print | LC_ALL=C sort -r | tail -n +"$((keep + 1))" | while IFS= read -r old; do
    [ "$old" = "$file" ] || rm -f "$old"
  done
}

# Quoted for a POSIX shell, which is what cron runs the line with.
shell_quote() {
  local quote="'" escaped
  escaped="${1//$quote/$quote\\$quote$quote}"
  printf "'%s'" "$escaped"
}

# Replaces the data volume with a backup. The archive is unpacked into a scratch volume first, so a
# bad archive is found before the live data is touched, and the old data is put back if the swap fails.
# The copy of the old data is the only way back, so it is deleted only once the restore is known good.
restore() {
  local file volume scratch previous answer opens had_previous=false
  [ -n "${1:-}" ] || { echo "Usage: ./install.sh --restore FILE" >&2; exit 2; }
  file="$(absolute_path "$1")"
  [ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }
  if is_encrypted_archive "$file" && [ -z "$passphrase_file" ]; then
    echo "$file is encrypted. Add --passphrase-file PATH with its passphrase." >&2
    exit 1
  fi
  if [ -n "$passphrase_file" ] && [ "$(archive_format "$file")" = krbk ]; then
    ensure_server_image || { echo "Could not build the server image that opens the backup, so nothing was changed." >&2; exit 1; }
  fi
  archive_is_intact "$file" || { explain_unusable_archive "$file"; exit 1; }
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
  ensure_server_image || { echo "Could not build the server image to check the backup with, so nothing was changed. Run ./install.sh once and try again." >&2; exit 1; }
  opens=0
  volume_database_opens "$scratch" || opens=$?
  if [ "$opens" -eq "$DATABASE_UNUSABLE" ]; then
    echo "The database in the archive does not open with the key in it, so nothing was changed." >&2
    exit 1
  elif [ "$opens" -ne 0 ]; then
    echo "The check of the backup could not run (docker exited with $opens), so nothing was changed. The backup itself may be fine." >&2
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
  # The archive holds the marker of the backup before it, so the live one is put back: the person
  # checking backup state right after a restore must not be told the backup is older than it is.
  if [ "$had_previous" = true ]; then
    docker run --rm -v "$previous":/live:ro -v "$volume":/to alpine \
      sh -c 'if [ -f /live/last-backup ]; then cp -p /live/last-backup /to/last-backup; else rm -f /to/last-backup; fi' \
      || echo "The restore worked, but the last backup time could not be carried over, so the About page may show an older one." >&2
  fi
  [ "$had_previous" = false ] || docker volume rm -f "$previous" >/dev/null 2>&1 || true
  previous_volume=""
  record_restore "$volume"
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
  --schedule-backup)
    shift
    schedule_dir=""
    schedule_keep=7
    schedule_once=false
    schedule_rest=()
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --once) schedule_once=true; shift ;;
        --keep)
          case "${2:-}" in
            ''|*[!0-9]*|0) echo "--keep needs a number of backups to keep, 1 or more." >&2; exit 2 ;;
          esac
          schedule_keep="$2"
          shift 2
          ;;
        --passphrase-file) schedule_rest+=("$1" "${2:-}"); shift 2 || shift ;;
        *) schedule_dir="$1"; shift ;;
      esac
    done
    [ -n "$schedule_dir" ] || { echo "--schedule-backup needs the folder to write backups to." >&2; exit 2; }
    parse_archive_args "${schedule_rest[@]+"${schedule_rest[@]}"}"
    schedule_dir="$(absolute_path "$schedule_dir")"
    if [ "$schedule_once" = true ]; then
      scheduled_backup "$schedule_dir" "$schedule_keep"
    else
      cron_env="PATH=$(shell_quote "$PATH")${DOCKER_HOST:+ DOCKER_HOST=$(shell_quote "$DOCKER_HOST")}"
      cron_command="$(shell_quote "$PWD/install.sh") --schedule-backup $(shell_quote "$schedule_dir") --once --keep $schedule_keep${passphrase_file:+ --passphrase-file $(shell_quote "$passphrase_file")}"
      case "$cron_env$cron_command" in
        *%*) echo "Cron treats % as a line break, so a path or PATH containing it cannot go in a crontab line." >&2; exit 2 ;;
      esac
      # Cron opens the log before install.sh runs, so the folder has to exist already.
      (umask 077 && mkdir -p "$schedule_dir")
      echo "Add this line with crontab -e to back up every night at 03:30 and keep the newest $schedule_keep:"
      echo "30 3 * * * $cron_env $cron_command >> $(shell_quote "$schedule_dir/schedule.log") 2>&1"
    fi
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
