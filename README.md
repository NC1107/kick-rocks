# Kick Rocks

Self-hosted tool that tells data brokers and companies to kick rocks.
It sends opt-out and deletion requests from your own mailbox, drives the broker opt-out forms that need a browser, tracks every reply, and keeps doing it on a schedule.

Status: early development.
The whole flow runs end to end against a local test stack (see "End-to-end tests"), but nothing has been tried against a real mail provider or a real broker site yet.

## How it works

So the basic idea is you run one docker container on a machine at home, you connect your own email account with an app password, and you fill in a profile.
From there you pick which brokers and companies to hit and click send.
Requests go out from your address, so they carry full weight as the data subject and nobody's shared domain gets banned.
Replies land back in your mailbox, the tool reads them over imap, figures out what each broker said, and moves the request along.

People-search sites are the annoying part. Most of them want you to find your own record and then fill out a form, sometimes with a captcha.
For those there are per-site recipes that drive a real chrome on your machine, and when a recipe doesn't exist or breaks, the task goes into a queue that claude code or another agent can pick up over mcp.
Captchas and id checks never get solved automatically, they just wait in a review list for you.

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
`.env.example` lists every setting.

First steps in the app:

1. Create a profile with your name, email, and address.
2. Open the profile's mailbox page, pick your provider, and paste an app password.
   The page links to where each provider creates one.
3. Open Campaigns, pick a preset, read the preview email, and send.
4. Watch replies arrive under Requests, and clear anything that needs you under Review.

To let Claude Code or another agent take over tasks the worker cannot do, turn on MCP in Settings.
`docs/agents.md` explains how to connect.

The database and its key live in a docker volume called `kickrocks-data`.
The key gets generated on first start and the database is useless without it, so back up the volume as a unit, something like:

```sh
docker run --rm -v kick-rocks_kickrocks-data:/data -v "$PWD":/backup alpine tar czf /backup/kickrocks-backup.tgz -C /data .
```

If you'd rather have a plain folder on disk, swap the volume for a bind mount in `docker-compose.yml` and chown that folder to uid 1000 first, the container runs as an unprivileged user.

## Developing

Node 22 and pnpm 10.

```sh
pnpm install
pnpm data:build      # builds packages/brokers/data/generated/brokers.json from the upstream lists
pnpm dev             # server on 8420, web on 5173 with a proxy to the api
pnpm test
pnpm lint
pnpm e2e             # the full flow against a local docker stack, see below
```

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
It covers setup and login, a profile, the mailbox, a campaign with sends, a broker reply of every class, polling by hand and by the scheduler, a verification reply, a scan and a confirmed match, a removal by the worker with an emailed confirmation, a CAPTCHA that blocks and is resumed from the review queue, and an agent task claimed and completed over MCP.

`KICKROCKS_E2E_KEEP=1 pnpm e2e` leaves the stack running afterwards, so you can open http://127.0.0.1:8520 and look around, with the password `correct horse battery staple`.
`KICKROCKS_E2E_NO_BUILD=1 pnpm e2e` reuses the images from the last run.
The stack sets `KICKROCKS_SEND_GAP_MS=0` and `KICKROCKS_PLAINTEXT_MAIL_HOSTS=greenmail`, which a real install must not.

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
