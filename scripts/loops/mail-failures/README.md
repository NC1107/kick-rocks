# Mail and scheduler failure matrix

`pnpm build && pnpm loop:mail-failures` breaks one thing at a time in a running server and prints a JSON result.
The score is the number of failing checks, so lower is better.
The loop stops when two full runs in a row score zero.

Each scenario starts the built server on a scratch data directory and a port the OS picks.
Mail goes to a local SMTP and IMAP fake, so the real nodemailer and imapflow code is what fails.
Nothing reaches a real mail host or broker.
The disk-full scenario runs the same build in a container whose data directory is a size-limited tmpfs, never the host disk.

## Checks

A check is true when it holds, false when it fails, and absent when it does not apply to the scenario.

- `told`: the person sees the fault on the dashboard, or a push arrives, within 75 seconds.
- `delivery`: every Message-ID the mail server kept was kept once and is recorded as sent.
- `live_task`: no queued request is left without a queued, leased or blocked task.
- `scheduler_fresh`: the scheduler finished a pass less than 30 seconds ago while the fault was in effect.
- `poll_starts`: a requested mailbox poll dials the mail server within 12 seconds while the fault is in effect.
- Other names are specific to one scenario and say what must be true there.

Waiting out a lease or a retry backoff is done by moving the stored timestamps back, because the real wait is minutes.

## Running

- `--only name,name` runs some scenarios.
- `--concurrency N` runs N at once, 4 by default.
- `--keep-logs` keeps the server logs of the run.

A full run writes `.loop-runs/mail-failures/last.json`, which the next run reads to decide whether the stop target is met.
