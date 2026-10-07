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

- `id`, `brokerId`, `version`, and `purpose`, which must agree with each other and with the file name.
- `entryUrl`, the first page a run opens.
- `fields`, the profile fields the recipe may use, such as `first_name`, `email`, or `record_url`.
  A step that uses a field the recipe does not declare is rejected.
- `steps`, the ordered list of actions.
- `canary`, a page and the selectors that must exist on it, used by the health check.
  A canary loads the page and checks selectors and never submits anything.
- `notes`, `verifiedAt`, and `liveStatus`, which record what an author checked against the live site, when, and whether bot protection blocked the check.
  `liveStatus` is `verified`, `blocked_by_bot_protection`, or `unverified`.

## Steps

Every step has a `kind`.

- `goto` opens a URL.
  The URL may contain templates such as `{{first_name|slug}}`.
- `fill` types into a field, from a profile `field` or from a `value` template such as `{{first_name}} {{last_name}}`.
- `select` picks an option from a profile field.
- `click` clicks an element.
- `check` ticks a checkbox, or clears it with `checked: false`.
- `press` presses a key, optionally on a target.
- `pause` waits a random time between `minMs` and `maxMs`.
- `wait_for` waits for an element.
- `expect_text` and `expect_url` fail the run when the page does not show the text or match the pattern.
- `extract_candidates` reads search results into candidates, with a CSS rule for each field.
- `extract_text` reads a confirmation message or a record URL.
- `captcha_checkpoint` stops the run for a human when a challenge is on the page.
- `email_confirmation` marks a form that finishes through a link in an email.

Selectors are tried in this order: role and label, test id, CSS, then visible text.
Template filters are `slug`, `lower`, and `urlencode`.
A template that names an unknown field fails the run instead of sending a half-filled value.

## Safety

Recipes never solve or bypass a CAPTCHA.
Author a recipe by reading the live page without submitting anything.
Use fixtures under `example.com`, `example.org`, or `.test` in tests, and never real personal data.
