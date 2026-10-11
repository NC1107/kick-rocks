# Agent model benchmark: llama3.2:3b

Run from 2026-10-08T19:04:13.824Z to 2026-10-08T19:06:09.113Z.
Endpoint http://127.0.0.1:11434/v1, 3 run(s) per scenario, at most 40 steps and 10 minutes per run, 4096 output tokens per turn, instant pace, the openai provider, thinking default.
Ollama loaded the model with a context of 4096 tokens.
Idle GPU memory before the runs was 667 MiB.

## Reply classification

Accuracy 70.8% over 3 run(s) of 96 replies.
Invalid JSON rate 0.0%.
Mean latency 377 ms.
Latency of the first run: median 363 ms, 95th percentile 450 ms, max 483 ms.
Answers outside the schema: 0. Requests that failed or timed out: 0.
Requested fields named exactly on verification replies: 16.7%.

| Class | Correct | Cases |
|---|---|---|
| bounce | 8 | 10 |
| auto_ack | 6 | 10 |
| confirmation_link | 9 | 11 |
| verification_required | 9 | 12 |
| completed | 11 | 11 |
| no_record | 7 | 8 |
| rejected | 2 | 10 |
| needs_form | 0 | 8 |
| unrelated | 8 | 8 |
| unknown | 8 | 8 |

| Style | Correct | Cases |
|---|---|---|
| plain | 40 | 52 |
| html-text | 4 | 7 |
| quoted-thread | 6 | 8 |
| legal | 4 | 7 |
| autoresponder | 0 | 2 |
| ticket | 4 | 6 |
| odd-link | 3 | 5 |
| id-request | 1 | 1 |
| other-people | 3 | 4 |
| partial | 2 | 2 |
| no-sale-denial | 1 | 2 |

Answers that were wrong in the first run:
- ack-2: answered unrelated, expected auto_ack.
- ack-4: answered unknown, expected auto_ack.
- verify-3: named fields [first_name, last_name, street, city, state, zip], expected [full_name, zip].
- verify-4: named fields [first_name, last_name, full_name, email, phone, city, state, zip, street, birth_year, date_of_birth], expected [].
- verify-5: answered unrelated, expected verification_required; named fields [], expected [birth_year, city, state].
- reject-1: answered unrelated, expected rejected.
- reject-3: answered unrelated, expected rejected.
- reject-4: answered unrelated, expected rejected.
- form-1: answered unrelated, expected needs_form.
- form-2: answered unrelated, expected needs_form.
- form-3: answered unrelated, expected needs_form.
- form-4: answered unrelated, expected needs_form.
- dev-bounce-2: answered unrelated, expected bounce because an NDR from the mail server says the recipient was not found.
- dev-bounce-5: answered unrelated, expected bounce because the message was blocked and not delivered.
- dev-ack-1: answered unrelated, expected auto_ack because an out-of-office reply with no decision on the request.
- dev-ack-4: answered unrelated, expected auto_ack because an unmonitored auto-reply that only says the message arrived.
- dev-link-1: answered unrelated, expected confirmation_link because the only ask is to tap a link to finalize the request.
- dev-link-5: answered unrelated, expected confirmation_link because asks to click Approve to authorize the request.
- dev-verify-1: named fields [first_name, last_name, full_name, email, phone, city, state, zip, street, birth_year, date_of_birth], expected [].
- dev-verify-2: named fields [first_name, last_name, zip], expected [full_name, zip].
- dev-verify-3: named fields [email, phone], expected [phone].
- dev-verify-4: answered unrelated, expected verification_required because asks for a street address and a city to find the right listing; named fields [], expected [street, city].
- dev-verify-5: answered unrelated, expected verification_required because several people match, and it asks for the street address to pick one; named fields [], expected [street].
- dev-verify-6: named fields [date_of_birth, street, city, state, zip, phone, email], expected [date_of_birth].
- dev-verify-7: named fields [full_name, email], expected [].
- dev-norec-2: answered unrelated, expected no_record because no account exists for the email address.
- dev-reject-1: answered unrelated, expected rejected because declines to act because it says it does not sell data.
- dev-reject-2: answered unrelated, expected rejected because explicitly denies the request to delete.
- dev-reject-3: answered unrelated, expected rejected because declines because of a retention duty.
- dev-reject-4: answered unrelated, expected rejected because closes the ticket and declines because of the person's state.
- dev-reject-6: answered unrelated, expected rejected because a plain refusal, with our request quoted.
- dev-form-1: answered unrelated, expected needs_form because says requests must go through the portal.
- dev-form-2: answered unrelated, expected needs_form because requires the webform and says email requests are not processed.
- dev-form-3: answered unrelated, expected needs_form because an automatic reply that sends requests to the form.
- dev-form-4: answered unrelated, expected needs_form because tells the person to visit the Data Rights Center to submit the request.

