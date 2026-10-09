# Mail intake corpus

A synthetic mixed inbox for measuring what the inbox poll lets into the app.
Every message is invented, on reserved or made-up domains, for the made-up person Jordan Example.
Nothing here comes from a real mailbox.

## Layout

- `dev/` holds 60 percent of the messages.
  Look at these freely while changing the classifier.
- `held-out/` holds the other 40 percent, split by category the same way.
  Run it with `--held-out` only to check a finished change, never to tune one.
- Categories written after the first measurements go to `dev/` only, so `held-out/` stays the set frozen before any tuning.
- Each folder has numbered `.eml` files, oldest first, and a `labels.json` with what should happen to each.

## Labels

Each label has an `outcome`, the `request` it belongs to, and its `classification`.

- `ignore`: nothing to act on, so it should leave no trace.
  Storing its subject or body, attaching it to a request, classifying it, or showing it in Review all count against the poll.
- `auto`: the message belongs to `request` and is applied without a person, with `classification`.
- `review`: a person should see it in Review.
  It may stay unattached, but when it is attached it must be to `request` and carry `classification`.

A reply that would change a request is expected in Review unless a DKIM signature of the broker's domain covers the quoted request or reference.
A reply that changes nothing, such as an acknowledgement, is applied either way.

## Running

- `pnpm loop:mail-intake` measures the dev set and prints four numbers plus a table per category.
- `pnpm loop:mail-intake -- --verbose` lists every message that counted against a number.
- `pnpm loop:mail-intake -- --held-out` measures the held-out set.
- `pnpm --filter @kickrocks/server loop:mail-intake:generate` rewrites the corpus.
  The generator is deterministic, and a test fails when the committed files differ from its output.

## Measures

- `falsePositives`: ignore mail that was attached to a request, classified as something other than unrelated, or shown in Review.
- `falseNegatives`: mail about a request that was not stored, or that should wait in Review and does not.
- `storedIgnored`: ignore mail whose subject or body was kept.
- `misrouted`: mail attached to the wrong request, given the wrong class, or left unattached when it should have been applied.
