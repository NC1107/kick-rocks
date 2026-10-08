# Kick Rocks

Self-hosted tool that tells data brokers and companies to kick rocks.
It sends opt-out and deletion requests from your own mailbox, fills out the broker forms that need a browser, and keeps track of the replies.

Status: early.
It works end to end on a test stack and on my own server, but it hasn't seen many real brokers yet.

## How it works

You run it at home with docker, connect your email with an app password, and make a profile with your name, email, and state.
Requests go out from your own address, and your state decides which privacy law they cite.

Replies come back to your mailbox and kick rocks reads them over imap.
A reply only closes a request when its dkim signature checks out and it quotes that request, anything else waits in review.

People-search sites mostly want a web form, so a browser worker runs chrome on your home connection with a recipe per site.
It searches, shows you what it found, and only removes the listings you confirm.
Captchas, phone calls, and id uploads always wait for you.

## Running it

You need docker on a machine at home, datacenter ips get blocked by most of these sites.

```sh
git clone https://github.com/NC1107/kick-rocks.git
cd kick-rocks
./install.sh
```

Open the address it prints and set a password right away, the first person to open it sets it.
Then make a profile, connect your mailbox, and start a campaign.
Outlook.com doesn't work yet since microsoft turned off app passwords for it.

It's on port 8420 unless you set `KICKROCKS_HOST_PORT` in `.env`.
Reverse proxy, backups, and updates are in [docs/self-hosting.md](docs/self-hosting.md).

## Agents

Forms without a recipe become agent tasks.
Any mcp client can work through them with a token from settings, or you can run the agent worker with a local model through ollama or with an `ANTHROPIC_API_KEY`.
The model only sees your profile values as placeholders.
Setup is in [docs/agents.md](docs/agents.md), and which local model to run for your GPU is in [docs/agent-models.md](docs/agent-models.md).

## Your data

Everything lives in one sqlcipher-encrypted sqlite file.
`./install.sh --backup` writes an archive that includes the key, so keep it somewhere private.

## Developing

Node 22 and pnpm 10, then `pnpm install`, `pnpm data:build`, `pnpm build`, and `pnpm dev`.
Checks and architecture are in [docs/development.md](docs/development.md).

## License

The code is PolyForm Noncommercial 1.0.0, so use it and change it, just don't sell it.
The broker dataset is CC BY-NC-SA 4.0 because it includes the [big ass data broker opt-out list](https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List) by Yael Grauer, sources are in [packages/brokers/data/NOTICE.md](packages/brokers/data/NOTICE.md).
