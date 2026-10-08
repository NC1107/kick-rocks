# Worker

The worker runs Chrome on the machine it is installed on and does the browser work the server queues.
It claims `scan`, `form`, `confirm`, and `canary` tasks over the worker API, runs them, and reports the outcome.
It never touches the database, and it never claims `agent` tasks, which belong to an MCP client.

## What it does with a task

- `scan` and `form` run the task's recipe with `runRecipe` from `@kickrocks/recipes`.
  A scan completes with candidates, and a form completes with one of the four form outcomes.
- `canary` loads the recipe's canary page and reports which selectors are missing, without submitting anything.
- `confirm` opens the emailed link, which must be an https link on the broker's domain, and reports whether the page took it.
  The reported address drops the query, because the query holds the one-time token.
- A CAPTCHA, a bot check, or a human check a recipe names (phone, ID, login) blocks the task with a screenshot and the page the person should open.
- A recipe that no longer matches the page fails with kind `recipe`, which the server never retries.
  A site error or a dropped connection fails as retryable, and a bug on our side fails as `internal`.
- A browser that will not start releases the task without costing it an attempt, and the worker backs off.

## One task at a time

The loop claims a task, extends its lease every third of the lease time (at most every 30 seconds), runs it, and reports.
If the server stops honoring the lease, because it expired or the request was cancelled, the run is stopped and nothing is reported.
Reports are tried again when the server or the network fails.
On SIGTERM or SIGINT an idle worker leaves at once.
A worker in the middle of a task asks the run to stop, closes the browser if it has not stopped after 20 seconds, and releases the task so another worker can take it.
A second signal exits immediately.

## Configuration

Everything comes from environment variables.
An empty value counts as unset.

| Variable | Default | Meaning |
|---|---|---|
| `KICKROCKS_WORKER_TOKEN` | required | Bearer token, at least 16 characters, the same as the server's. |
| `KICKROCKS_SERVER_URL` | `http://127.0.0.1:8420` | The server's address. |
| `KICKROCKS_WORKER_ID` | host name | Names this worker in leases and the audit trail. |
| `KICKROCKS_WORKER_POLL_MS` | `5000` | Wait between claims when there is nothing to do. |
| `KICKROCKS_WORKER_LEASE_MS` | `300000` | Lease length asked for on every claim and heartbeat. |
| `KICKROCKS_CHROME_PROFILE` | `./.chrome-profile` | Persistent Chrome profile, so cookies and logins survive restarts. |
| `KICKROCKS_CHROME_EXECUTABLE` | unset | A specific Chrome or Chromium binary. |
| `KICKROCKS_WORKER_HEADLESS` | `false` | Run without a window. Real runs are headed, under Xvfb in the container. |
| `KICKROCKS_WORKER_PROXY` | none | An http proxy URL that all of Chrome's traffic goes through, so a filtering proxy can keep the browser off private networks. The worker's own calls to the server do not use it. |
| `KICKROCKS_WORKER_NO_SANDBOX` | `false` | Pass `--no-sandbox`. The image sets it, because the container is the sandbox. |
| `KICKROCKS_WORKER_PACE` | `human` | `instant` skips the human typing rhythm, for a fixture site. |
| `KICKROCKS_WORKER_ALLOW_HTTP` | `false` | Allow record and confirmation links on plain http, for a fixture site on this machine. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`. |

The browser is the Chrome installed on the machine when there is one, because bot checks treat it as an ordinary visitor far more often than Chromium.
Otherwise it is Playwright's Chromium.
Run one worker per profile: a second Chrome on the same profile is refused.
A lock left behind by a container that was recreated is cleared at startup.

## The image

`apps/worker/Dockerfile` builds from the repository root.
It installs Chrome on amd64 and Chromium elsewhere, runs the worker as the `node` user, and starts it headed under Xvfb through `docker-entrypoint.sh`.
The compose file mounts the Chrome profile at `/profile` and gives the container 1 GB of shared memory.

## Logs

Logs carry ids, kinds, and outcomes, never the fields of a task, which hold the person's details.
Error messages from a run have those values replaced by the name of the field.

## Politeness

The server decides when a task may start, so the worker never paces itself against a site on its own.
What the worker adds is observation and manners.
See `docs/scanning.md` for the rules and the defaults.

- Every report carries what the run saw of the site: a 429, 403, or 503 with its Retry-After, a Cloudflare challenge, a CAPTCHA, or an access-denied page.
- Every page the main frame loads is checked, not only the first, so a 429 that answers the search submit stops the run instead of reading as no results.
- Chrome starts with `--disable-blink-features=AutomationControlled`, so `navigator.webdriver` is false.
- The worker never fetches robots.txt, because that request would not look like the browser beside it.
- A run dwells on a freshly opened page and scrolls a little before acting, and it never blocks images, scripts, or fonts.
- A canary loads only the recipe entry page and checks its `entrySelectors`.
- When the person routes a site through a proxy in Settings, the task names it and the worker restarts that profile browser with it between tasks.
  Each route has its own browser folder, and WebRTC is kept from sending UDP outside the proxy.
  A proxy set with `KICKROCKS_WORKER_PROXY` always wins, because it is the operator safety filter.
  A task whose site is routed through a different proxy fails with that explanation instead of silently using the worker's route.
