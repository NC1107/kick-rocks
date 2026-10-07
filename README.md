# Kick Rocks

Self-hosted tool that tells data brokers and companies to kick rocks.
It sends opt-out and deletion requests from your own mailbox, drives the broker opt-out forms that need a browser, tracks every reply, and keeps doing it on a schedule.

Status: early development.
The whole flow runs end to end against a local test stack (see "End-to-end tests"), but nothing has been tried against a real mail provider yet.
Nine people-search scan recipes (Spokeo, Intelius, MyLife, PeopleFinders, CheckPeople, FastPeopleSearch, TruePeopleSearch, USPhoneBook, and SmartBackgroundChecks) were run against the live sites by their authors and are marked verified, but no removal form has been seen through to a real removal.

## How it works

So the basic idea is you run Kick Rocks in docker on a machine at home, a server container and a browser worker container, you connect your own email account with an app password, and you fill in a profile.
From there you pick which brokers and companies to hit and click send.
Requests go out from your address, so they carry full weight as the data subject and nobody's shared domain gets banned.
Replies land back in your mailbox, the tool reads them over imap, figures out what each broker said, and moves the request along.

People-search sites are the annoying part. Most of them want you to find your own record and then fill out a form, sometimes with a captcha.
For those there are per-site recipes that drive a real chrome on your machine, and when a recipe doesn't exist or breaks, the task goes into a queue that claude code or another agent can pick up over mcp.
Captchas and id checks never get solved automatically, they just wait in a review list for you.

Most bundled recipes were read against the live site but never seen through to a real removal, so they start out switched off.
Settings has a Recipes tab that lists each one with what its author did and did not check.
You approve the ones you are happy to run on your details and reject the rest, and until you decide, that site goes to an agent or to you by hand.
A rejection sticks across restarts, and only a newer version of that recipe asks again.
Recipes an agent proposes are reviewed separately, on the Agents tab.

It runs at home on purpose. Datacenter ips get blocked by the bot checks on these sites pretty much immediately, a residential connection with a real browser mostly doesn't.

## Running it

You need docker and a residential internet connection.
Plan for roughly 4 GB of disk: the server image is about 0.5 GB and the browser worker image about 1.9 GB, plus the Chrome profile and your data.
The optional agent worker adds another 2.1 GB.
The first start downloads and builds the images, which takes about 5 to 15 minutes depending on your connection, and later starts take seconds.

```sh
git clone https://github.com/NC1107/kick-rocks.git
cd kick-rocks
./install.sh
```

The script writes `.env` with a random `KICKROCKS_WORKER_TOKEN` (it never replaces one that exists) and `COMPOSE_PROFILES=worker`, builds the images, starts the server and the browser worker, and waits until the server answers.
Then open http://127.0.0.1:8420, set a password, and create a profile.
The server has a health check and the worker waits for it, so the worker does not start before the server is listening.

`COMPOSE_PROFILES=worker` in `.env` is what makes every `docker compose` command see the worker, so `docker compose stop` and `docker compose down` reach it too.
Add `agent` to that line (`COMPOSE_PROFILES=worker,agent`) to include the optional agent worker.

### Stop, start, and uninstall

```sh
./install.sh --stop        # stops every container, keeps all your data
./install.sh --start       # starts them again
./install.sh --uninstall   # asks you to type "delete", then removes the containers, volumes, and images
```

These are shortcuts for `docker compose stop`, `docker compose up -d --wait`, and `docker compose --profile worker --profile agent down --volumes --rmi all`.
Uninstall deletes the database and its key for good, so back up first if you might want your data again.
It leaves the folder and `.env` alone, so delete the folder when you are done.

### What runs by itself

Nothing visits a broker site until you say so.
On a fresh install the worker only waits for tasks, and no browser task runs before you have set a password.
Even then, Settings has a Site checks switch that is off by default.
Turned on, it lets the worker open the entry page of each recipe you approved once a week, on your connection, to see whether the broker's form changed.
A site check looks for the form fields the recipe expects, types nothing, submits nothing, and sends none of your details, but the broker does see a visit from your home address.
The Scan and Removal badges on Targets show the result: None (no approved recipe), Not checked, Healthy, or Broken.
Scans and removals you start yourself run whether or not site checks are on.

To start only the server, without the browser worker, run `docker compose up -d server`.
Email requests work without the worker, but scans and web forms need it.
`.env.example` lists the settings compose passes on, and the server settings for `pnpm dev` that it does not.

First steps in the app:

1. Create a profile with your name, email, and state of residence.
   The state is required because it decides which privacy law the requests cite.
   Addresses and other details are optional, and a scan of a people-search site asks for what it needs.
2. Open the profile's mailbox page, pick your provider, and paste an app password.
   The page links to where each provider creates one.
3. Click New campaign on the dashboard, pick a preset, read the preview email, and send.
4. Watch replies arrive under Requests, and clear anything that needs you under Review.

To let Claude Code or another agent take over tasks the worker cannot do, turn on MCP in Settings.
`docs/agents.md` explains how to connect.

You can also let a model take those tasks without Claude Code.
The optional agent worker drives its own Chrome and asks a local model (Ollama or any OpenAI-compatible endpoint) or the Anthropic API what to do next.
Set `KICKROCKS_AGENT_MODEL` in `.env` and add `agent` to `COMPOSE_PROFILES`, then run `docker compose up -d --build`.
The model does not see your details: it names a profile field and the program types the value, and what the model reads is masked so a field's value shows as a placeholder such as `{{first_name}}`.
The program types only on the broker's own domains and pages, and a CAPTCHA stops the task for you.
See "Running a model as the agent" in `docs/agents.md`.

## Reaching it from another device

The UI is published on `127.0.0.1` only, so a headless home server, NAS, or Pi is not reachable from your laptop by default.
That is on purpose: the first-run setup page is open to anyone who can reach it until a password is set.
Set a password first, then pick one of these.

- An SSH tunnel keeps it on loopback: `ssh -L 8420:127.0.0.1:8420 user@host`, then open http://127.0.0.1:8420 on your laptop.
- To listen on your LAN, set `KICKROCKS_BIND_ADDRESS` in `.env` to the host's LAN address (or `0.0.0.0`) and run `docker compose up -d`.
  Set `KICKROCKS_PUBLIC_URL` to the address you use, so the links in the UI and the MCP setup show it.
  Only do this on a network you trust, or behind your own VPN.
- The server answers only to loopback names, IP addresses, and the host of `KICKROCKS_PUBLIC_URL`.
  Reach it by an IP address and it works as is.
  Reach it by a name such as `kickrocks.lan` or `nas.local` and it replies `421 Misdirected Request`, which stops a web page on another site from reaching it by DNS rebinding.
  Put every other name you use, comma separated, in `KICKROCKS_ALLOWED_HOSTS` in `.env`, or set `KICKROCKS_PUBLIC_URL` to that name.

Behind a reverse proxy such as Caddy, nginx, or Traefik, keep the published port on loopback and let the proxy forward to it.
Three settings in `.env` make that work.

- `KICKROCKS_PUBLIC_URL` is the address in the browser, such as `https://kickrocks.example.org`.
  Its host is accepted in the Host and Origin headers, and the sign-in cookie is marked Secure when it is `https`.
- `KICKROCKS_ALLOWED_HOSTS` lists any further names the proxy serves, since a name that is neither in it nor the public URL gets the `421` above.
- `KICKROCKS_TRUST_PROXY` is the number of proxies in front of the server, such as `1`, or a comma separated list of their addresses.
  With it unset the server ignores `X-Forwarded-For` and `X-Forwarded-Proto`, so every client looks like the proxy and shares one sign-in throttle.
  Set it only when a proxy you control is the sole way in, because a client could otherwise write those headers itself.
  A bare `on` is refused.

The proxy must pass the original `Host` header through, which most do by default, and keep the connection to the server on a network only it can reach.

## Notifications and the digest

Settings has a Notifications tab so you do not have to keep the app open.

- Push goes to ntfy (ntfy.sh or your own server and a topic) or Telegram (a bot token and a chat id).
  It is sent when a task is blocked for you, a broker asks you to approve identifiers, a listing needs your decision, a mailbox fails, or a recipe breaks.
  Each item is announced once while it stays open, items that arrive together share one message, and at most six pushes go out per hour unless you change that.
- A push carries counts and one link to this app, such as "2 tasks are blocked. Open https://kickrocks.example.org/review".
  It never names a broker, a person, or an address, because it passes through a server you may not run.
  Set `KICKROCKS_PUBLIC_URL` so the link opens from your phone.
- The digest is a daily or weekly email from your own mailbox to itself, listing status changes and what needs you.
  It is sent through the same mailbox as your requests, so it never touches another service, and it is skipped when nothing changed and nothing waits on you.
- Tokens are stored in the encrypted database and are never shown again after saving.
  The server reaches ntfy and Telegram over the network, so it needs outbound access to the ntfy address you enter and to `api.telegram.org`.

## Backup, restore, and the data volume

The database and its key live in a docker volume named `kickrocks-data`, which compose prefixes with the project name `kick-rocks`, so on disk it is `kick-rocks_kickrocks-data`.
The key gets generated on first start and the database is useless without it, so back up the volume as a unit.

```sh
./install.sh --backup                     # writes ~/kickrocks-backup-<date>.tgz
./install.sh --backup /path/to/file.tgz   # or somewhere you choose
```

The script stops everything, because a copy of a running database can be inconsistent, writes the archive, and starts everything again.
The archive is owned by you and readable only by you, and the script refuses to write it inside the repository.

The archive holds the database and the key that decrypts it, so whoever has the file has your data.
Keep it off shared folders and cloud storage, or encrypt it before it goes there.
`kickrocks-backup*` is in `.gitignore` as a second guard against committing one.

By hand, the same thing is:

```sh
docker compose stop
(umask 077 && docker run --rm -v kick-rocks_kickrocks-data:/data:ro alpine tar czf - -C /data . > ~/kickrocks-backup.tgz)
docker compose start
```

To restore, stop everything, put the archive back, and start it again:

```sh
docker compose stop
docker run --rm -i -v kick-rocks_kickrocks-data:/data alpine sh -c "rm -rf /data/* /data/.[!.]* && tar xzf - -C /data" < ~/kickrocks-backup.tgz
docker compose start
```

`docker compose down -v` and `./install.sh --uninstall` delete the volumes, and with them the database and its key, so never add `-v` unless you mean to start over.

If you forget the password, there is no email reset, because nothing here talks to an outside service.
Run this on the machine that hosts it:

```sh
docker compose exec server node /app/server/dist/main.js reset-password
```

It clears the password and every signed-in session, and the next visit to the app asks for a new password.
Your profiles, requests, and mailbox setup stay as they were.

If you'd rather have a plain folder on disk, swap the volume for a bind mount in `docker-compose.yml` and chown that folder to uid 1000 first, the container runs as an unprivileged user.

## Your data

Kick Rocks only keeps what it needs, and you can take it out or remove it from the web UI.

- **Export.** The profile page has "Export profile data", which saves one JSON file with the identities, requests and their timelines, reply details, scans, and matches.
  It leaves out the mailbox password and the text of replies.
- **Delete a profile.** The profile page removes the profile and everything about it: identities, mailbox connection, requests, replies, scans, matches, and screenshots.
  Running tasks are cancelled first, so a worker that still holds one finds nothing to report against.
  The database file is then compacted with `VACUUM`, so the freed pages do not keep the old bytes.
- **Retention.** Settings has one window for screenshots (30 days by default) and one for the text of replies you have dealt with (kept by default).
  The sender, subject, and outcome of a reply always stay, so a request keeps its history.
  Saving a shorter window applies it at once, and the scheduler applies it every hour after that.
- **Delete all data.** Settings can wipe every profile and the instance settings after you type a confirmation phrase.
  It keeps your sign-in password, the broker list, and the recipes.

Requests that were already sent cannot be recalled, and nothing here reaches into your mailbox: delete the replies there yourself if you want them gone.

## Updating and logs

To update, pull and rebuild the images.
`COMPOSE_PROFILES` in `.env` makes compose rebuild the worker, and the agent worker if you listed it, next to the server:

```sh
git pull
docker compose up -d --build
```

`docker compose logs -f server` and `docker compose logs -f worker` show what each container is doing, and `docker compose logs -f agent-worker` shows the agent worker.
The lines are JSON, one object per line.

## Developing

Node 22 and pnpm 10.

```sh
pnpm install
pnpm data:build      # builds packages/brokers/data/generated/brokers.json from the upstream lists
pnpm build           # every package exports its built output, so the server needs this first
pnpm dev             # server on 8420, web on 5173 with a proxy to the api
pnpm test
pnpm lint
pnpm e2e             # the full flow against a local docker stack, see below
```

`pnpm dev` does not start the worker, and it does not rebuild `packages/*` when you edit them, so run `pnpm build` again after a change there.
To run the worker by hand, set `KICKROCKS_WORKER_TOKEN` (the server needs the same value) and run `pnpm dev:worker`, which opens a headed Chrome.
The server reads its settings from the environment, not from `.env`.

The repo is a pnpm workspace.
`apps/server` is the fastify api, scheduler, mail handling, task queue, and mcp server.
`apps/web` is the react ui.
`apps/worker` is the browser worker that runs recipes.
`apps/agent-worker` is the optional model-driven worker for tasks no recipe covers.
`packages/db` is the drizzle schema over an sqlcipher-encrypted sqlite file.
`packages/brokers` turns the upstream broker lists into one normalized dataset.
`packages/shared` is the zod schemas everything else agrees on.

## End-to-end tests

`pnpm e2e` starts the stack in `docker-compose.dev.yml`, runs the suite in `e2e/` against it, and stops the stack again.
It needs docker and builds the server and worker images on the first run, which takes a few minutes.
It uses ports 8520 (web and API), 3525 (SMTP), 3643 (IMAP), and 8530 (fixture site), so stop anything on those first.

The stack has the real server and worker, a GreenMail mail server, and a fixture site that imitates a people-search site, with test-only targets and recipes from `e2e/fixtures`.
Nothing in it can reach the internet or a real mail server: its containers sit on an internal docker network, and mail to any address, including real broker addresses, stays inside GreenMail.
The suite drives the HTTP API and an MCP client the way the web app and an agent do.
One step also opens every screen in Chrome, at desktop and phone width in light and dark, and fails on sideways scrolling, console errors, or failed requests, so it needs Chrome or a Playwright Chromium on the machine.
It covers setup and login, a profile, the mailbox, a campaign with sends, a broker reply of every class, polling by hand and by the scheduler, a verification reply, a scan and a confirmed match, a removal by the worker with an emailed confirmation, a CAPTCHA that blocks and is resumed from the review queue, and an agent task claimed and completed over MCP.

`KICKROCKS_E2E_KEEP=1 pnpm e2e` leaves the stack running afterwards, so you can open http://127.0.0.1:8520 and look around, with the password `correct horse battery staple`.
`KICKROCKS_E2E_NO_BUILD=1 pnpm e2e` reuses the images from the last run.
The stack sets `KICKROCKS_SEND_GAP_MS=0`, `KICKROCKS_PLAINTEXT_MAIL_HOSTS=greenmail`, `NODE_ENV=development`, and `KICKROCKS_DKIM_TEST_KEYS=/dkim/keys.json`, which a real install must not.
The stack has no internet, so `pnpm e2e` writes a throwaway DKIM key pair to `e2e/.dkim` before the stack starts, the server reads the public key from that file instead of DNS, and the suite signs its broker replies with the private key.
Starting the stack by hand with `docker compose -f docker-compose.dev.yml up` needs that folder to exist, so run `pnpm e2e` once first.

The server checks DKIM signatures itself when it reads mail and ignores every `Authentication-Results` header, because a provider can echo text a sender wrote into that header.
A reply counts as coming from the broker only when a DKIM signature that covers the whole body verifies and its domain shares an organizational domain with the broker's own domains.
Anything else from a sender who is only matched by address goes to review.
If DNS cannot be reached when a message is read, the message goes to review and the poll carries on.

See `docs/DESIGN.md` for the architecture, the decisions behind it, and the milestone plan.

## Data sources

Broker data is built from the mit-licensed list in [eraser](https://github.com/drumandbytes/eraser), the public [california data broker registry](https://cppa.ca.gov/data_broker_registry/), and the people-search section of the big ass data broker opt-out list (BADBOOL, CC BY-NC-SA 4.0, imported from a pinned and hash-checked copy with attribution).
Company contacts come from each company's own privacy page.
Every record carries its source and license.
`packages/brokers/data/NOTICE.md` has the per-source licenses and attribution, and says why other state registries are not imported.
Simple opt out is a great reference but its license doesn't allow bundling, so nothing is copied from it.

## License

PolyForm Noncommercial 1.0.0.
Use it, change it, host it for your friends, just don't sell it.
