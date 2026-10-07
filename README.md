# Kick Rocks

Self-hosted tool that tells data brokers and companies to kick rocks.
It sends opt-out and deletion requests from your own mailbox, drives the broker opt-out forms that need a browser, tracks every reply, and keeps doing it on a schedule.

Status: early development.
The whole flow runs end to end against a local test stack (see "End-to-end tests"), but nothing has been tried against a real mail provider or a real broker site yet.

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

```sh
git clone https://github.com/NC1107/kick-rocks.git
cd kick-rocks
./install.sh
```

The script writes `.env` with a random `KICKROCKS_WORKER_TOKEN` (it never replaces one that exists), builds the images, and starts the server and the browser worker.
Then open http://127.0.0.1:8420, set a password, and create a profile.
The first start builds a Chrome image for the worker, so it takes a few minutes.

To start only the server, without the browser worker, run `docker compose up -d`.
Email requests work without the worker, but scans and web forms need it.
`.env.example` lists the settings compose passes on, and the server settings for `pnpm dev` that it does not.

First steps in the app:

1. Create a profile with your name, email, and address.
2. Open the profile's mailbox page, pick your provider, and paste an app password.
   The page links to where each provider creates one.
3. Click New campaign on the dashboard, pick a preset, read the preview email, and send.
4. Watch replies arrive under Requests, and clear anything that needs you under Review.

To let Claude Code or another agent take over tasks the worker cannot do, turn on MCP in Settings.
`docs/agents.md` explains how to connect.

## Reaching it from another device

The UI is published on `127.0.0.1` only, so a headless home server, NAS, or Pi is not reachable from your laptop by default.
That is on purpose: the first-run setup page is open to anyone who can reach it until a password is set.
Set a password first, then pick one of these.

- An SSH tunnel keeps it on loopback: `ssh -L 8420:127.0.0.1:8420 user@host`, then open http://127.0.0.1:8420 on your laptop.
- To listen on your LAN, set `KICKROCKS_BIND_ADDRESS` in `.env` to the host's LAN address (or `0.0.0.0`) and run `docker compose --profile worker up -d`.
  Set `KICKROCKS_PUBLIC_URL` to the address you use, so the links in the UI and the MCP setup show it.
  Only do this on a network you trust, or behind your own VPN.

## Backup, restore, and the data volume

The database and its key live in a docker volume named `kickrocks-data`, which compose prefixes with the project name `kick-rocks`, so on disk it is `kick-rocks_kickrocks-data`.
The key gets generated on first start and the database is useless without it, so back up the volume as a unit.
Stop the server first, because a copy of a running database can be inconsistent:

```sh
docker compose stop server
docker run --rm -v kick-rocks_kickrocks-data:/data -v "$PWD":/backup alpine tar czf /backup/kickrocks-backup.tgz -C /data .
docker compose start server
```

To restore, stop the server, put the archive back, and start it again:

```sh
docker compose stop server
docker run --rm -v kick-rocks_kickrocks-data:/data -v "$PWD":/backup alpine sh -c "rm -rf /data/* /data/.[!.]* && tar xzf /backup/kickrocks-backup.tgz -C /data"
docker compose start server
```

`docker compose down -v` deletes the volumes, and with them the database and its key, so never add `-v` unless you mean to start over.

If you forget the password, there is no email reset, because nothing here talks to an outside service.
Run this on the machine that hosts it:

```sh
docker compose exec server node /app/server/dist/main.js reset-password
```

It clears the password and every signed-in session, and the next visit to the app asks for a new password.
Your profiles, requests, and mailbox setup stay as they were.

If you'd rather have a plain folder on disk, swap the volume for a bind mount in `docker-compose.yml` and chown that folder to uid 1000 first, the container runs as an unprivileged user.

## Updating and logs

To update, pull and rebuild both images, and keep the profile flag so the worker is rebuilt next to the server:

```sh
git pull
docker compose --profile worker up -d --build
```

`docker compose logs -f server` and `docker compose logs -f worker` show what each container is doing.
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
The stack sets `KICKROCKS_SEND_GAP_MS=0`, `KICKROCKS_PLAINTEXT_MAIL_HOSTS=greenmail`, and `KICKROCKS_MAIL_AUTHSERV_IDS=mx.test`, which a real install must not.

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
