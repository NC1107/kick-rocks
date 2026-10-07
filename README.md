# Kick Rocks

Self-hosted tool that tells data brokers and companies to kick rocks.
It sends opt-out and deletion requests from your own mailbox, drives the broker opt-out forms that need a browser, tracks every reply, and keeps doing it on a schedule.

Status: early development. The scaffold, the encrypted database, and the broker dataset build work. Nothing sends mail yet.

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
docker compose up -d
```

Then open http://127.0.0.1:8420.
The database is encrypted with a key that gets generated into `./data/db.key` on first start, so back up that folder as a unit.

## Developing

Node 22 and pnpm 10.

```sh
pnpm install
pnpm data:build      # builds packages/brokers/data/generated/brokers.json from the upstream lists
pnpm dev             # server on 8420, web on 5173 with a proxy to the api
pnpm test
pnpm lint
```

The repo is a pnpm workspace.
`apps/server` is the fastify api, scheduler, mail handling, task queue, and mcp server.
`apps/web` is the react ui.
`packages/db` is the drizzle schema over an sqlcipher-encrypted sqlite file.
`packages/brokers` turns the upstream broker lists into one normalized dataset.
`packages/shared` is the zod schemas everything else agrees on.

See `docs/DESIGN.md` for the architecture, the decisions behind it, and the milestone plan.

## Data sources

Broker data is built from the mit-licensed list in [eraser](https://github.com/drumandbytes/eraser) and the public [california data broker registry](https://cppa.ca.gov/data_broker_registry/).
Every record carries its source and license.
The big ass data broker opt-out list and simple opt out are great references but their licenses don't allow bundling, so nothing is copied from them.

## License

PolyForm Noncommercial 1.0.0.
Use it, change it, host it for your friends, just don't sell it.
