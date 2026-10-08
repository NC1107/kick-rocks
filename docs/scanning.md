# Polite scanning

Kick Rocks drives a real browser from the person's home connection.
If a broker flags that address, every later visit gets harder, and so does the person's own browsing.
So the goal is simple: Kick Rocks must never get a residential IP flagged or banned while it scans, checks recipes, or runs forms.

## Where the rules live

The server owns the task queue, so the server owns the rules.
The built-in worker, the agent worker, and MCP clients all claim tasks through the same queue code, and a claim only succeeds when the per-site gate allows it.
A worker cannot skip the gate by being a different kind of client, and a pushback is never answered by sending the task to another worker or to the agent path to try again sooner.

## What the research says

- Cloudflare rate limiting counts requests per client (by default per IP) in a window, and once the threshold is crossed it blocks that client for a set mitigation timeout, with the 429 or error 1015 page ([rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/), [error 1015 explained](https://proxidize.com/blog/cloudflare-error-1015/)).
- A 429 should be answered by honoring Retry-After when it is present, and by exponential backoff with jitter when it is not ([429 and challenge loops](https://stackharbor.com/en/knowledge-base/cffix-cloudflare-429-too-many-requests/)).
- A challenge page is a different signal from a rate limit: Cloudflare marks every challenge page with the `cf-mitigated: challenge` header ([detecting a challenge](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/challenge-pages/detect-response/)).
  Retrying one immediately usually makes it worse, so Kick Rocks treats it as pushback and waits.
- Retry-After is defined as either a number of seconds or an HTTP date ([RFC 9110, section 10.2.3](https://www.rfc-editor.org/rfc/rfc9110#field.retry-after)).
- Mitigation timeouts on the rule side range from seconds to a day, so a cooldown measured in hours is long enough to outlast one.
- Challenge and VPN reputation: common bot-management practice scores datacenter and VPN ranges are scored as riskier than residential ones, which is why a proxy is optional and warned about in Settings.

These sources describe what sites do, and they are the reason for the defaults below.
Kick Rocks does not try to get past a challenge: it detects it and leaves the site alone.

## The gate

A browser task (scan, form, confirm, canary, or agent) is only leased when all of these hold for the site it targets.
A task that fails a check stays queued with `runAfter` set to when the check next passes.
It is never failed, and the review queue says it is waiting for a site.

- **One at a time per site.** At most one browser task is leased on a site owner at once.
- **A spaced start.** After a task starts, the next start on that site waits the minimum gap plus a random extra of up to the jitter share.
- **A daily cap per site.** A site gets at most a fixed number of task starts in a rolling 24 hours.
- **An hourly cap overall.** All sites together get at most a fixed number of starts in a rolling hour.
- **No active cooldown or breaker.** See the next section.

A confirmation link is a single page load that expires, so it is counted but never held back by a cap.
It still obeys the one-at-a-time rule, the gap, the cooldown, and the breaker.

### What counts as one site

The key is the site owner, not the host name.
`www.spokeo.com` and `api.spokeo.com` are one site.
Sister sites that one company runs behind the same defences share a key: the PeopleConnect family (Intelius, TruthFinder, Instant Checkmate, US Search, Zabasearch, Classmates), the BeenVerified family, and Whitepages with 411.
A broker whose dataset entry lists confirmation-mail domains that belong to another platform is grouped with that platform as well.

## Defaults and why

| Setting | Default | Reasoning |
|---|---|---|
| Gap between starts on one site | 20 minutes | A person looks up themselves a few times a day at most, so a visit every twenty minutes is slower than any rate rule a people-search site sets for a single address. |
| Jitter | up to 50 percent extra | Visits that land on an exact clock are a bot tell, and the spread keeps several sites from lining up. |
| Daily cap per site | 6 starts | A scan, a removal, and a confirmation fit in one day with room to spare, and a runaway retry loop stops at six. |
| Hourly cap overall | 12 starts | With the gap this means a large campaign trickles out across days instead of bursting from one address. |
| Reuse window | 24 hours | A repeat search for the same person on the same site inside a day would return the same page, so it is not worth a visit. |
| First cooldown | 6 hours | Longer than the usual rate-limit mitigation windows, so the block has cleared before the next visit. |
| Backoff | doubles each time, to 7 days | Repeated pushback means the site has decided against this address, and the cost of waiting is only time. |
| Breaker threshold | 3 in a row | Three pushbacks mean the pattern is not a fluke, so the site is paused entirely. |
| Retry-After | honored, up to 7 days | The site's own number beats ours when it is longer, and a hostile value cannot park a site forever. |

All of these are settings, and the defaults are meant to be left alone.

## Pushback and backoff

Workers report what they saw with every result, block, or failure.

- A 429, 403, or 503 on the main document, with Retry-After when the site sent one.
- A Cloudflare challenge: the `cf-mitigated` header, or an interstitial page such as "Just a moment".
- A CAPTCHA widget on a page that otherwise loaded.
- An access-denied page, even when it answers 200.

A client that parks a task for a CAPTCHA or bot check without sending an observation is treated the same way, so an MCP agent that only calls `block_task` still triggers the cooldown.

On pushback the server records the time and kind, counts it, and sets a cooldown of the longer of the site's Retry-After and the backoff.
A failure that carries pushback is deferred, not retried: the task goes back in the queue until the cooldown ends, the attempt is refunded, and nothing is handed to an agent.
A removal that may already have been submitted is held for a person instead, as always.

### The circuit breaker

After the threshold of pushbacks in a row the breaker opens and the site is paused outright.
When the cooldown passes the breaker is half open, which lets exactly one task start as a cautious probe.
If the probe finishes with no pushback the breaker closes and the count resets.
If it is pushed back, the breaker opens again for the next, longer cooldown.
A probe that ends without telling anything about the site leaves the breaker half open.

## Fewer requests

- **Reuse.** A queued scan for the same person on the same site, finished by an earlier scan inside the reuse window, is completed from that result with no visit and no slot at the gate.
  This works across profiles in one household when the identity fields the recipe searches with are the same.
  A reused result never counts as a fresh search, so reuse cannot extend itself.
- **Staggered rescans.** A rescan becomes due somewhere in the last quarter of the rescan window, at a position set by a hash of the profile and the site.
  The position is stable, so a restart does not move it, and a first campaign does not rescan everything on one afternoon.
- **Canaries.** A canary loads only the recipe's entry page.
  It never fills a form or searches, it checks only the recipe's `entrySelectors`, and without any it checks that the page loads and is not a bot check.
  It is rate limited like everything else and stays off until site checks are turned on in Settings.

## Looking like one consistent person

- One persistent real Chrome profile per Kick Rocks profile, so a site sees the same cookies and history from the same person each time.
- No rotation of user agents or fingerprints, and no stealth plugins.
- Human pacing in both workers: typing rhythm with hesitations, a pause before each action, a dwell of about one to three seconds on a freshly opened page, and a small scroll as a reader would make.
- Pages load normally: no blocking of images, scripts, or fonts, which looks automated.
- A scan reads the site's robots.txt once a day, and when it sets a Crawl-delay for everyone, the run leaves that long between page loads and the server uses it as a floor for the gap between visits.

## Optional egress proxy

A proxy the person controls can carry all visits or only those to chosen sites, for example the HTTP port of a gluetun container.
It is off by default and set in Settings.
The address must be `http://` with no user name or password.
Listing a site covers its sister sites too.

Many VPN and datacenter addresses are challenged more than a home connection, not less, so a proxy is for keeping one site's traffic apart, not for hiding.
A worker that was started with its own proxy keeps it, because that one is the operator's safety filter.
Changing the route restarts that profile's browser between tasks.

## What the person sees

- **Settings, Pace and route:** the defaults above, editable, with the proxy and the VPN warning.
- **Settings, Sites cooling down:** each site being left alone, why, and until when.
- **Sidebar:** a small chip appears while any site is cooling down.
- **Target page:** visits today against the cap, the last pushback, and any cooldown.
- **Review:** a notice lists tasks waiting on a site, with the reason and the next try, so they do not look lost or failed.

An MCP client that claims a waiting task by id gets a `site_waiting` error that says when to ask again.
