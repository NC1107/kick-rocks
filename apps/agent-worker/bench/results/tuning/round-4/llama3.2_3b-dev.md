# Agent model benchmark: llama3.2:3b

Run from 2026-10-09T08:18:37.372Z to 2026-10-09T08:20:14.178Z.
Endpoint http://127.0.0.1:11434/v1, 3 run(s) per scenario, at most 40 steps and 10 minutes per run, 4096 output tokens per turn, instant pace, the openai provider, thinking default.
Ollama loaded the model with a context of 4096 tokens.
Idle GPU memory before the runs was 697 MiB.

## Reply classification

Accuracy 79.2% over 3 run(s) of 96 replies.
Invalid JSON rate 0.0%.
Mean latency 315 ms.
Latency of the first run: median 310 ms, 95th percentile 362 ms, max 499 ms.
Answers outside the schema: 0. Requests that failed or timed out: 0.
Requested fields named exactly on verification replies: 50.0%.

| Class | Correct | Cases |
|---|---|---|
| bounce | 7 | 10 |
| auto_ack | 6 | 10 |
| confirmation_link | 10 | 11 |
| verification_required | 8 | 12 |
| completed | 11 | 11 |
| no_record | 8 | 8 |
| rejected | 9 | 10 |
| needs_form | 7 | 8 |
| unrelated | 2 | 8 |
| unknown | 8 | 8 |

| Style | Correct | Cases |
|---|---|---|
| plain | 42 | 52 |
| html-text | 6 | 7 |
| quoted-thread | 5 | 8 |
| legal | 6 | 7 |
| autoresponder | 1 | 2 |
| ticket | 6 | 6 |
| odd-link | 4 | 5 |
| id-request | 1 | 1 |
| other-people | 2 | 4 |
| partial | 2 | 2 |
| no-sale-denial | 1 | 2 |

Answers that were wrong in the first run:
- bounce-1: answered unknown, expected bounce.
- ack-2: answered unknown, expected auto_ack.
- ack-4: answered unknown, expected auto_ack.
- verify-2: answered unknown, expected verification_required; named fields [], expected [phone].
- verify-5: answered unknown, expected verification_required; named fields [], expected [birth_year, city, state].
- form-2: answered confirmation_link, expected needs_form.
- unrel-1: answered confirmation_link, expected unrelated.
- unrel-3: answered needs_form, expected unrelated.
- dev-bounce-4: answered unknown, expected bounce because an automatic delivery failure notice that quotes our request below it.
- dev-bounce-5: answered unknown, expected bounce because the message was blocked and not delivered.
- dev-ack-1: answered unknown, expected auto_ack because an out-of-office reply with no decision on the request.
- dev-ack-5: answered completed, expected auto_ack because an automatic response that only quotes our request back.
- dev-link-1: answered unknown, expected confirmation_link because the only ask is to tap a link to finalize the request.
- dev-verify-4: answered unknown, expected verification_required because asks for a street address and a city to find the right listing; named fields [], expected [street, city].
- dev-verify-5: answered needs_form, expected verification_required because several people match, and it asks for the street address to pick one; named fields [], expected [street].
- dev-verify-6: named fields [date_of_birth, street], expected [date_of_birth].
- dev-verify-7: named fields [last_name, full_name, email], expected [].
- dev-reject-1: answered no_record, expected rejected because declines to act because it says it does not sell data.
- dev-unrel-2: answered auto_ack, expected unrelated because an order shipment notice.
- dev-unrel-3: answered unknown, expected unrelated because a recruiter message.
- dev-unrel-4: answered needs_form, expected unrelated because social network notifications about people, not a privacy request.
- dev-unrel-5: answered unknown, expected unrelated because a document share invitation that mentions another person.

