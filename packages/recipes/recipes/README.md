# Recipes

Each file here is one recipe for one broker and one purpose.
The server loads every `*.json` file in this folder at startup, and again from the folder named by `KICKROCKS_EXTRA_RECIPES`.
A recipe in the extra folder replaces a bundled recipe with the same id.

## File naming

Name the file after the recipe id, which is `<brokerId>.<purpose>.v<version>`.
For example `spokeo.scan.v1.json` and `spokeo.remove.v2.json`.
The broker id is the id of the target in the broker dataset.
The purpose is `scan` to find a person's record or `remove` to opt out.
A new version is a new file, so an older recipe keeps working until the new one is approved.
A file whose name does not match its id is rejected.

## Schema

The schema is `Recipe` in `packages/shared/src/recipe.ts`.
The loader validates every file against it and reports the ones that fail.

A recipe has these top level fields.

- `id`, `brokerId`, `version`, and `purpose`, which must agree with each other and with the file name, and optionally `alsoFor`.
- `entryUrl`, the first page a run opens.
- `fields`, the profile fields the recipe may use, such as `first_name`, `email`, or `record_url`.
  A step that uses a field the recipe does not declare is rejected.
- `steps`, the ordered list of actions.
- `canary`, a page and the selectors that must exist on it, used by the health check.
  A canary loads the page and checks selectors and never submits anything.
- `notes`, `verifiedAt`, and `liveStatus`, which record what an author checked against the live site, when, and whether bot protection blocked the check.
  `liveStatus` is `verified`, `blocked_by_bot_protection`, or `unverified`.
  `verified` means the author saw the whole flow through to the site accepting the request, with real wording to match.
  A page that was only read is `unverified`, and a page that bot protection hid is `blocked_by_bot_protection`.
  A bundled recipe that is not `verified` is loaded as `pending_review`, so a person approves it before the app runs it.

## Steps

Every step has a `kind`.
A step is strict: a key it does not have makes the recipe invalid, so a typo such as `optionl` is reported instead of silently ignored.

- `goto` opens a URL.
  The URL may contain templates such as `{{first_name|slug}}`.
  A remove recipe may also use a URL that is exactly `{{record_url}}` to open the record the person confirmed.
  The runner renders it and refuses to navigate unless the result is `https` and its host is the target's domain or one of its subdomains, so a bad record URL can never send the browser elsewhere.
- `fill` types into a field, from a profile `field` or from a `value` template such as `{{first_name}} {{last_name}}`.
- `select` picks an option, from a profile `field` or a `value` template.
  `by` is `label` (the default, the text a person sees) or `value` (the option's value attribute).
  Many dropdowns show the full state name, so use `{{state|state_name}}` as the value.
- `click` clicks an element.
- `check` ticks a checkbox, or clears it with `checked: false`.
- `press` presses a key, optionally on a target.
- `pause` waits a random time between `minMs` and `maxMs`.
- `wait_for` waits for an element.
  `state` is `visible` (the default), `hidden`, `attached`, or `detached`, so a recipe can wait for a spinner to go.
- `expect_text` and `expect_url` fail the run when the page does not show the text or match the pattern.
- `extract_candidates` reads search results into candidates, with a CSS rule for each field: `recordUrl`, `name`, and optionally `age`, `locations`, `relatives`, `phones`, and `emails`.
- `extract_text` reads a confirmation message or a record URL.
- `select_record` finds the result whose link is the record the person confirmed and clicks or checks it, for sites where removal means searching and then choosing a result.
  `item` selects each result, `link` says where to read its URL, and the match is made on `normalizeRecordUrl` of both sides.
  When results exist but none matches, the run stops for a person, because the list may be partial or may link in a different shape than the scan read.
  Set `exhaustive: true` only when the list was seen to hold every match in the same URL shape a scan produces, and the run then ends as completed with the form outcome `not_found`.
  A page with no results at all fails the run as a recipe failure, so a stale selector cannot close a request as `no_record`.
  Handle a site's "no results" wording with `outcome_when` before this step.
  The recipe must declare `record_url` in `fields`.
- `outcome_when` ends the run with the outcome of the first condition that matches the page.
  A condition has `text`, `selector`, or `urlPattern` (at least one) and an `outcome`: `not_found`, `already_removed`, `submitted`, `awaiting_email_confirmation`, or `blocked` with a `reason`.
  Use it for pages that say "no records found" or "this listing was already removed", and for human checks that need no step to fail, such as a phone verification wall.
  A scan may only end a run as `blocked`.
- `captcha_checkpoint` stops the run for a human when a challenge is on the page.
- `email_confirmation` marks a form that finishes through a link in an email.
  A run that passes it completes as `awaiting_email_confirmation` once its proof step has matched.

A remove recipe must prove that the site took the request.
After its last `click`, `press`, or clicking `select_record` it needs an `expect_text`, an `expect_url`, or an `outcome_when` with a `submitted` or `awaiting_email_confirmation` condition.
A run that reaches its last step without that proof having held fails as a recipe failure, so a form the site rejected is never recorded as sent.
Put `email_confirmation` before the click when the proof is an `outcome_when`, because a matching `outcome_when` ends the run.

`click`, `check`, `press`, `fill`, `select`, and `wait_for` accept `optional: true`.
An optional step is skipped when its target does not appear within a short timeout, which is how a recipe handles a cookie banner or an interstitial that only shows up sometimes.

Steps that take a selector accept `frame`, the selector of an iframe, for a form that is embedded in one.

Selectors are tried in this order: role and label, test id, CSS, then visible text.
Template filters are `slug`, `lower`, `urlencode`, and `state_name`.
Filters chain left to right, so `{{state|state_name|slug}}` renders "TX" as "texas" for a state scoped URL.
A template that names an unknown field or filter is rejected when the recipe is loaded, and one that cannot be rendered fails the run instead of sending a half-filled value.

## Canary

A canary loads a page and checks that selectors still exist.
It should list the selectors the steps use on that page, and no others from a page the steps never fill.
A page that answers 401 or 403 is reported as blocked, never as unhealthy.
A scan recipe's canary may also have `steps` to reach selectors that only appear after a search: `goto` a literal URL, `fill` a literal generic value such as `John Smith`, `click`, and `wait_for`.
Canary steps never use profile fields, so a health check discloses nobody, and a remove recipe may not have them, because a click there could submit a removal.

## Sister sites

`alsoFor` lists the ids of other brokers whose domains the recipe's pages may be on, for a suppression center that covers sister sites.
It only widens which pages the recipe may visit.
The recipe still runs for `brokerId` alone, so a sister broker is handled automatically only if it has a recipe of its own.
Every id must be a broker in the dataset, as must `brokerId`.

## Failures

A run that cannot finish says why with a kind.
`recipe` means the page no longer matches the script and is always reported as not retryable, so the server hands the task to an agent and counts it against the recipe's health.
`site` and `network` failures may be retried, and `internal` is a bug on our side.
Only `recipe` failures count towards marking a recipe broken.

## Safety

Recipes never solve or bypass a CAPTCHA.
Author a recipe by reading the live page without submitting anything.
Use fixtures under `example.com`, `example.org`, or `.test` in tests, and never real personal data.
