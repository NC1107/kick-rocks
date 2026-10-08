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

Reverse proxy, backups, and updates are in [docs/self-hosting.md](docs/self-hosting.md).

## Agents

Forms without a recipe become agent tasks.
Any mcp client can work through them with a token from settings, or you can run the agent worker with a local model through ollama or with an `ANTHROPIC_API_KEY`.
The agent worker masks your profile values, so its model only sees placeholders and the program types the real value.
An mcp client doesn't get that, it sees the fields the task needs and the pages it browses, and so does whoever hosts that client's model.
That is your name, depending on the task your email, city and state, and for some removal forms your street address, zip or birth year.
Setup is in [docs/agents.md](docs/agents.md), and which local model to run for your GPU is in [docs/agent-models.md](docs/agent-models.md).

## Where your data goes

This is everything that leaves your machine, as far as I know, and there is no telemetry.

| Who | What they see | How to avoid it |
|---|---|---|
| Your mail provider | Every request you send, every reply, and the app password login. Kick rocks reads the folder you set for replies (the inbox by default) and keeps what it finds there, unrelated mail included. | Use a mailbox just for this, or point the reply folder at a label. |
| Brokers and companies, by email | Your name and your email address, plus city and state for a site that has to find a record. Emails citing a state's law also say you live there. Plus anything you approve sending when a broker replies asking for more to verify you. | Nothing, that is the request. A blind request to a broker that never had you still tells them your name and email. Decline a verification in review. |
| Broker sites, in the browser | Your home ip and a chrome profile that keeps its cookies for each person. The name, city and state the worker types into searches, and on removal forms the fields the site asks for. For a few sites that includes street address, zip or birth year, and it can go to a form provider the site embeds. | A proxy, set in settings or on the worker, which moves the traffic and doesn't make it anonymous. |
| Company sites, for confirmation links | A plain request from the server with no user agent, for the confirmation link of a company request that isn't a deletion. Broker links open in the browser instead. | Route that site through a proxy and the browser opens the link instead. |
| The agent worker's model | Page text from the broker site, with your profile values masked. | Run a local model through ollama. A hosted one sees the page, including your listing and anything it shows about relatives. |
| An mcp client and its model | The fields the task needs: your name, depending on the task your email, city and state, and for some removal forms street address, zip or birth year. Every page the client browses too. | Use the agent worker with a local model instead. |
| The reply classifier endpoint | The subject and up to 4000 characters of a reply, without the quoted text, only when the rules score it under 0.6. | Leave it unset and those replies wait in review, or use a model on your own machine. |
| ntfy or telegram | How many things need you and a link to your kick rocks address, never a name or a broker. | Leave notifications off. |

## Limits

This is not legal advice.
A privacy law may not apply to a given business, and a request doesn't guarantee that anything gets deleted.
A broker can add you back after it removes you, or get your details again from somewhere else, which is why it rescans.
A request to a broker that never had you can create a new link between your name and your email on its side.
Many states have no privacy law, so there the email rests on the company's own privacy policy, and a broker may not have one.

## Your data

Everything lives in one sqlcipher-encrypted sqlite file.
`./install.sh --backup` writes an archive that includes the key, so keep it somewhere private.

## Developing

Node 22 and pnpm 10, then `pnpm install`, `pnpm data:build`, `pnpm build`, and `pnpm dev`.
Checks and architecture are in [docs/development.md](docs/development.md).

## License

The code is PolyForm Noncommercial 1.0.0, so use it and change it, just don't sell it.
The broker dataset is CC BY-NC-SA 4.0 because it includes the [big ass data broker opt-out list](https://github.com/yaelwrites/Big-Ass-Data-Broker-Opt-Out-List) by Yael Grauer, sources are in [NOTICE](NOTICE) and [packages/brokers/data/NOTICE.md](packages/brokers/data/NOTICE.md).
