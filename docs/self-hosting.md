# Self-hosting

This page covers running kick rocks on a machine you own.
The short version is in the [README](../README.md).
Agent setup is in [agents.md](agents.md), and building from source is in [development.md](development.md).

## What you need

- docker with compose v2, on a machine at home.
  Broker sites block datacenter addresses, so a cloud server mostly doesn't work for the browser part.
- Roughly 4 GB of disk.
  The server image is about 0.5 GB and the browser worker image about 1.9 GB, plus the chrome profile and your data.
  The optional agent worker adds another 2.1 GB.
- The first start builds the images, which takes about 5 to 15 minutes depending on your connection.
  Later starts take seconds.

## install.sh

```sh
git clone https://github.com/NC1107/kick-rocks.git
cd kick-rocks
./install.sh
```

With no flag the script writes `.env`, builds the images, starts the server and the browser worker, and waits until the server answers.
It writes a random `KICKROCKS_WORKER_TOKEN` and never replaces one that is already there.
It also makes sure `COMPOSE_PROFILES` in `.env` lists `worker`, so every `docker compose` command sees the worker and `stop` and `down` reach it too.
It is safe to run again.

Then open the address it prints and set a password right away.
The first person to open the app sets it, and until then the setup page is open to anyone who can reach the port.

| Flag | What it does |
|---|---|
| none | Writes `.env`, builds, starts, waits until the server is healthy. |
| `--start` | Starts the stopped containers again and checks `COMPOSE_PROFILES`. |
| `--stop` | Stops every container, including the agent worker, and keeps all data. |
| `--backup [FILE]` | Writes the data volume to `FILE`, or to `~/kickrocks-backup-<date>.tgz`, or `.tgz.enc` with a passphrase. See [Backups](#backups-and-restore). |
| `--restore FILE` | Replaces the data volume with a backup, after checking the archive and that its database opens with its key. See [Backups](#backups-and-restore). |
| `--passphrase-file PATH` | With `--backup`, encrypts the archive with the passphrase in `PATH`. With `--restore`, opens an encrypted one. |
| `--schedule-backup DIR [--once] [--keep N]` | With `--once`, takes one backup into `DIR` and keeps the newest `N` (7 by default) of the `kickrocks-scheduled-*` files there. Without it, prints a crontab line that does this every night. |
| `--uninstall` | Asks you to type `delete`, then removes the containers, volumes, and images. |
| `--url` | Prints the address of the UI and exits. |

`--stop` and `--start` are shortcuts for `docker compose stop` and `docker compose up -d --wait`.
`--uninstall` is `docker compose --profile worker --profile agent down --volumes --rmi all --remove-orphans`.
The images are tagged with the compose project name, so it only reaches the ones this checkout built.
It deletes the database and its key for good, so back up first if you might want your data again.
It leaves the folder and `.env` alone, so delete the folder when you are done.

To start only the server, without the browser worker, run `docker compose up -d server`.
Email requests work without the worker, but scans and web forms need it.

## Settings

Compose reads `.env` from the repo folder, and `install.sh` writes it.
`.env.example` lists every setting compose passes on.
These are the only ones that do anything in a docker install.

| Setting | Default | What it does |
|---|---|---|
| `COMPOSE_PROFILES` | `worker` | Which optional services every compose command includes. Add `agent` for the agent worker, as `worker,agent`. |
| `KICKROCKS_WORKER_TOKEN` | generated | Turns the worker api on. At least 16 characters, and the workers use the same value. Empty keeps the worker api off. |
| `KICKROCKS_PUBLIC_URL` | `http://localhost:8420` | The address you use in the browser, for links in the UI, the mcp setup, and push notifications. |
| `KICKROCKS_ALLOWED_HOSTS` | empty | Extra host names the server answers to. See [Allowed hosts](#allowed-hosts). |
| `KICKROCKS_TRUST_PROXY` | `off` | How many proxies sit in front of the server, or their addresses. See [Reverse proxy](#reverse-proxy-and-trusted-proxies). |
| `KICKROCKS_BIND_ADDRESS` | `127.0.0.1` | The host address the UI port is published on. |
| `KICKROCKS_HOST_PORT` | `8420` | The host port the UI is published on. |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent` for the server. The workers take `debug`, `info`, `warn`, or `error`. |

The agent worker has its own settings, listed in [agents.md](agents.md#settings).

The server reads more settings that compose does not pass on.
They are for `pnpm dev` and bare metal runs, where you export them in the shell that starts the server.
The compose file sets the container's own values for the data directory, host, and port.

| Setting | Default | What it does |
|---|---|---|
| `KICKROCKS_DATA_DIR` | `./data` | Where the encrypted database and its key file live. |
| `KICKROCKS_HOST` | `127.0.0.1` | The address the server listens on. |
| `KICKROCKS_PORT` | `8420` | The port the server listens on. |
| `KICKROCKS_WEB_DIST` | unset | A built web app for the server to serve. Set in the image. |
| `KICKROCKS_SCHEDULER` | `on` | `off` stops the scheduler. Tests use it. |
| `KICKROCKS_EXTRA_TARGETS` | unset | A JSON file of extra brokers and companies. |
| `KICKROCKS_EXTRA_RECIPES` | unset | A directory of extra recipe files. |
| `KICKROCKS_SEND_GAP_MS` | `20000-60000` | The pause between two sends from one mailbox, as `<ms>` or `<min>-<max>`. Leave it unset for real mail. |
| `KICKROCKS_PLAINTEXT_MAIL_HOSTS` | empty | Host names the mailbox may reach without TLS, besides this machine. Leave it empty. |
| `KICKROCKS_ALLOW_PRIVATE_LINK_HOSTS` | empty | Host names the confirmation link follower may reach even though they resolve to a private address. For a local fixture site only. |
| `KICKROCKS_DKIM_TEST_KEYS` | unset | Test only. A JSON file of dkim keys the server believes in place of DNS. Ignored when `NODE_ENV` is `production`. |
| `NODE_ENV` | `development` | The image sets `production`. |

The last three are test settings.
A real install must not set them, because a key listed in `KICKROCKS_DKIM_TEST_KEYS` lets whoever holds it pass for that domain.

## Reaching it from another device

The UI is published on `127.0.0.1` only, so a headless home server, nas, or pi is not reachable from your laptop by default.
That is on purpose, because the first-run setup page is open until a password is set.
Set a password first, then pick one of these.

- An ssh tunnel keeps it on loopback: `ssh -L 8420:127.0.0.1:8420 user@host`, then open http://127.0.0.1:8420 on your laptop.
- To listen on your LAN, set `KICKROCKS_BIND_ADDRESS` in `.env` to the host's LAN address (or `0.0.0.0`) and run `docker compose up -d`.
  Set `KICKROCKS_PUBLIC_URL` to the address you use.
  Only do this on a network you trust, or behind your own vpn.
- Behind a reverse proxy, keep the port on loopback and see the next sections.

### Allowed hosts

The server answers only to loopback names, ip addresses, and the host of `KICKROCKS_PUBLIC_URL`.
Reach it by an ip address and it works as is.
Reach it by a name such as `kickrocks.lan` or `nas.local` and it replies `421 Misdirected Request`, which stops a web page on another site from reaching it by DNS rebinding.
Put every other name you use, comma separated, in `KICKROCKS_ALLOWED_HOSTS`, or set `KICKROCKS_PUBLIC_URL` to that name.

### Reverse proxy and trusted proxies

Behind caddy, nginx, or traefik, keep the published port on loopback and let the proxy forward to it.
Three settings in `.env` make that work.

- `KICKROCKS_PUBLIC_URL` is the address in the browser, such as `https://kickrocks.example.org`.
  Its host is accepted in the `Host` and `Origin` headers, and the sign-in cookie is marked `Secure` when it is `https`.
- `KICKROCKS_ALLOWED_HOSTS` lists any further names the proxy serves.
- `KICKROCKS_TRUST_PROXY` is the number of proxies in front of the server, such as `1`, or a comma separated list of their addresses.
  With it unset the server ignores `X-Forwarded-For` and `X-Forwarded-Proto`, so every client looks like the proxy and shares one sign-in throttle.
  Set it only when a proxy you control is the sole way in, because a client could otherwise write those headers itself.
  A bare `on` is refused, and so is anything that is not `off`, a number, or a list of addresses.

The proxy must pass the original `Host` header through, which most do by default.
Keep the connection between the proxy and the server on a network only they can reach.

## The browser worker

The worker runs a headed chrome under xvfb on your home connection.
It claims scan, form, confirm, and canary tasks over the worker api with `KICKROCKS_WORKER_TOKEN`, and it never touches the database.
Its chrome profile lives in the `kickrocks-chrome` volume, with one folder per kick rocks profile, so cookies and logins survive restarts and brokers can't link two people.
The container drops every capability, because the browser opens pages from broker sites and links from email.
Chrome runs with its own sandbox turned off (`--no-sandbox`), because docker's default seccomp profile blocks the user namespaces the sandbox needs.
So the container is the only sandbox, which is why it runs as an unprivileged user with no capabilities and `no-new-privileges`.
The agent worker is set up the same way.
On shutdown it gets 30 seconds to finish or release its task before docker kills it.

`apps/worker/README.md` lists every worker setting.
In the compose file only the token, the server address, and the chrome profile path are set.

### Egress proxy

`KICKROCKS_WORKER_PROXY` is an http proxy url that all of the worker's chrome traffic goes through, so a filtering proxy can keep the browser off private networks.
The worker's own calls to the server don't use it.
Compose does not pass this setting on, so for a docker install add it to the worker service in a `docker-compose.override.yml` next to the compose file.

```yaml
services:
  worker:
    environment:
      KICKROCKS_WORKER_PROXY: http://egress:3128
```

## What runs by itself

Nothing visits a broker site until you say so.
On a fresh install the worker only waits for tasks, and no browser task runs before you have set a password.
Even then, Settings has a Site checks switch that is off by default.
Turned on, it lets the worker load the page of each recipe you approved once a week, on your connection, to see whether the broker's form changed.
A site check never uses your details and never submits a removal, but the broker does see a visit from your home address.
Scans and removals you start yourself run whether or not site checks are on.

Once you have run a first scan or campaign, a few things run on a schedule, and the site checks switch does not gate them.
People-search sites you have scanned are scanned again every 60 days by default, other brokers are asked again after 90, and the intervals are in Settings.
Email requests get follow-ups when a broker has not answered, and failed sends are tried again.
The scheduler also applies the retention windows every hour.

### Notifications and the digest

Settings has a Notifications tab so you don't have to keep the app open.
Push goes to ntfy (ntfy.sh or your own server and a topic) or telegram (a bot token and a chat id).
A push carries counts and one link to this app, and never names a broker, a person, or an address, because it passes through a server you may not run.
Set `KICKROCKS_PUBLIC_URL` so the link opens from your phone.
The digest is a daily or weekly email from your own mailbox to itself.
Tokens are stored in the encrypted database and never shown again after saving.
The server reaches ntfy and telegram over the network, so it needs outbound access to the ntfy address you enter and to `api.telegram.org`.

## Backups and restore

The database and its key live in a docker volume named `kickrocks-data`.
Compose prefixes it with the project name `kick-rocks`, so on disk it is `kick-rocks_kickrocks-data`.
The key is generated on first start and the database is useless without it, so back up the volume as a unit.

```sh
./install.sh --backup                     # writes ~/kickrocks-backup-<date>.tgz
./install.sh --backup /path/to/file.tgz   # or somewhere you choose
```

The script stops everything, because a copy of a running database can be inconsistent, writes the archive, and starts back up whatever was running.
The archive is readable only by you, and the script refuses to write it inside the repository.
`kickrocks-backup*` and `kickrocks-scheduled*` are in `.gitignore` as a second guard.

The archive holds the database and the key that decrypts it, so whoever has the file has your data.
Keep it off shared folders and cloud storage, or encrypt it before it goes there.

To have the script encrypt it, add `--passphrase-file` with the path of a file that holds the passphrase.

```sh
./install.sh --backup --passphrase-file ~/kickrocks-passphrase.txt
```

The passphrase is the first line of that file, and a file whose first line is blank is refused.
The archive is then encrypted and authenticated with AES-256-GCM, with a key derived from the passphrase by scrypt, and the default name ends in `.tgz.enc`.
The cost of the key derivation is stored in the file, so it can change later without locking out old backups.
It runs inside the server image, which has node and nothing else that encrypts, so the host needs no tool installed.
A wrong passphrase is reported as a wrong passphrase, and a damaged or altered file as damaged.
A passphrase that is lost cannot be recovered, and neither can the backup.
Restoring needs the same file: `./install.sh --restore FILE --passphrase-file PATH`.
Backups that an older version encrypted with `openssl` still restore the same way, and that needs `openssl` on the host.
Keep the passphrase file apart from the backup: whoever has both has the database key.

A backup never includes the rollback copy of the database that a migration leaves beside it, because that copy is a second full database.
The server deletes that copy once a verified backup newer than the migration exists, or after 14 days.

### Scheduled backups

`./install.sh --schedule-backup ~/kickrocks-backups` prints a crontab line.
Add it with `crontab -e` and a backup is taken every night.
The line carries your current `PATH` (and `DOCKER_HOST` when set), because cron starts with almost none, and it appends output to `schedule.log` in the folder.
Only files named `kickrocks-scheduled-*` are rotated, so manual backups in the same folder are never deleted.
Plain `.tgz` and encrypted `.tgz.enc` backups are counted together, so adding or removing a passphrase never leaves old backups outside the rotation.
A path containing `%` is refused, because cron turns it into a line break.
Each run stops the stack for a moment, as a manual backup does.
A run that fails deletes nothing, so the older backups stay.

A restore keeps the live last-backup time rather than the one inside the archive.

Every backup that reads back whole also tells the app, and the About page shows how long ago that was.
It turns red when the last one is more than two days old, or when there has been none.

A backup is built next to its destination as a `.partial` file, and it only replaces the real file once it reads back whole.
So a run that fails halfway leaves the backup you already had alone.

By hand, the same thing is below.
It looks up the volume name first, because the prefix is the compose project name, which is `kick-rocks` unless you set `COMPOSE_PROJECT_NAME`.

```sh
volume="$(docker compose config | sed -n 's/^name: //p')_kickrocks-data"
docker compose stop
(umask 077 && docker run --rm -v "$volume":/data:ro alpine tar czf - -C /data . > ~/kickrocks-backup.tgz)
docker compose start
```

To restore, give the script the archive.

```sh
./install.sh --restore ~/kickrocks-backup-<date>.tgz
```

It checks that the file is a complete archive with the database and its key in it, and then asks you to type `restore`.
It stops everything and unpacks the archive into a scratch volume, so a file that unpacks badly is caught before your current data is touched.
It then opens the database there with the key from the archive, and refuses the restore if that fails.
That check runs in the server image, which the script builds first, in view, if the machine has none yet.
If the check cannot run at all, for example because docker is unhealthy, it says so instead of blaming the backup.
Only then does it copy the current data aside and swap the backup in, and it starts back up whatever was running.
If the swap fails it puts the previous data back.
If putting it back fails too, it keeps the copy, tells you its name and the command that restores it, and leaves everything stopped.
On a new machine there is no volume yet, and the script creates it.

A restore brings back the requests as they were when the backup was taken.
Mail sent after that is not in the restored database, so the request would be queued and mailed to the broker a second time.
The script therefore leaves a `restored-at` marker in the volume, and the server sends nothing while it is there.
It looks in the Sent folder of each mailbox with queued mail for the Message-ID that mail would carry, and records every match as sent.
When every mailbox has been checked it lifts the hold by itself.
If a mailbox cannot be reached or has no Sent folder, the hold stays and a banner says so, and sending resumes only after you confirm in the app.

`docker compose down -v` and `./install.sh --uninstall` delete the volumes, and with them the database and its key.
Never add `-v` unless you mean to start over.

If you'd rather have a plain folder on disk, swap the volume for a bind mount in `docker-compose.yml` and chown that folder to uid 1000 first, since the container runs as an unprivileged user.

### Forgot the password

There is no email reset, because the app has no way to send itself a reset link.
Run this on the machine that hosts it:

```sh
docker compose exec server node /app/server/dist/main.js reset-password
```

It clears the password and every signed-in session, and the next visit to the app asks for a new password.
Your profiles, requests, and mailbox setup stay as they were.

## If a broker asks for ID

Some brokers want proof of who you are before they delete anything, usually a copy of an id or a utility bill.
Kick Rocks never uploads either of those for you, and the agent worker is told to stop when it hits that step.
The task goes to the review queue with a screenshot, so you can see what they asked for.

Whether to send it is up to you.
I think the usual advice is to ask what they actually need first, since a lot of them accept less than they ask for, like a redacted id with only your name and address showing.
If you do send something, it's going to a company that sells people's data, so I'd give them as little as they'll take.
Nothing here is legal advice, and the rules differ by state and by broker.

## Your data

- The profile page has "Export profile data", which saves one JSON file with the identities, requests and their timelines, reply details, scans, and matches.
  It leaves out the mailbox password and the text of replies.
- Deleting a profile removes everything about it: identities, mailbox connection, requests, replies, scans, matches, and screenshots.
  Running tasks are cancelled first, and the workers delete their saved browser data for that profile the next time they check in.
  The database file is then compacted with `VACUUM`, so the freed pages don't keep the old bytes.
- Settings has one retention window for screenshots (30 days by default) and one for the text of replies you have dealt with (kept by default).
  The sender, subject, and outcome of a reply always stay.
- Settings can wipe every profile and the instance settings after you type a confirmation phrase.
  It keeps your sign-in password, the broker list, and the recipes.

Requests that were already sent can't be recalled, and nothing here reaches into your mailbox, so delete the replies there yourself if you want them gone.

## Testing against a local mail server

To try the mail path without a real provider, run greenmail on the compose network.
It accepts mail for every address and never relays it.

```sh
docker run -d --name greenmail --network kick-rocks_default \
  -e GREENMAIL_OPTS="-Dgreenmail.setup.test.smtp -Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.auth.disabled" \
  greenmail/standalone:2.1.5
```

Then put these in `.env` and run `docker compose up -d`.

```sh
KICKROCKS_PLAINTEXT_MAIL_HOSTS=greenmail
KICKROCKS_SEND_GAP_MS=0
```

The first lets the server reach a mailbox without TLS, and the second turns off the pause between sends.
In Settings, connect a mailbox with host `greenmail`, smtp port 3025 and imap port 3143, and any password.
The network is called `<project>_default`, so change `kick-rocks` if you set `COMPOSE_PROJECT_NAME`.
Take both lines out of `.env` again before you use a real mailbox, since a real provider should always be reached over TLS.

## Updating and logs

To update, pull and run the installer again.
It rebuilds the images and keeps your `.env`.

```sh
git pull && ./install.sh
```

The server applies database migrations itself when it starts, so an update that changes the database needs nothing from you.
Take a backup first if the data matters.

Installs made before the images lost their fixed names keep the old `kickrocks/server:dev`, `kickrocks/worker:dev` and `kickrocks/agent-worker:dev` images, and `./install.sh --uninstall` no longer removes them.
Delete them once with `docker image rm kickrocks/server:dev kickrocks/worker:dev kickrocks/agent-worker:dev`, unless you also run the development stack, which still uses the first two.

`docker compose logs -f server` and `docker compose logs -f worker` show what each container is doing, and `docker compose logs -f agent-worker` shows the agent worker.
The lines are JSON, one object per line.
Set `LOG_LEVEL=debug` in `.env` and run `docker compose up -d` for more detail.

## The agent worker

The agent worker is optional and off by default.
Add `agent` to `COMPOSE_PROFILES` in `.env`, set the model, and run `docker compose up -d --build`.
For a model served by ollama on the same machine, set `KICKROCKS_AGENT_PROVIDER=ollama` and `KICKROCKS_AGENT_BASE_URL=http://host.docker.internal:11434`.
The `ollama` provider asks ollama for a context of 16384 tokens on every request, because ollama's own default of 4096 cuts a long run short without any error.
`KICKROCKS_AGENT_NUM_CTX` changes it, and the `openai` provider remains for any other openai-compatible server.
It keeps its own chrome profile in the `kickrocks-agent-chrome` volume, because two browsers can't share one.
Setup, settings, and what the model can see are in [agents.md](agents.md).
