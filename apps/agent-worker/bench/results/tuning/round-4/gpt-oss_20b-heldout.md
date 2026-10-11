# Agent model benchmark: gpt-oss:20b

Run from 2026-10-09T06:19:12.190Z to 2026-10-09T06:24:29.481Z.
Endpoint http://127.0.0.1:11434/v1, 3 run(s) per scenario, at most 40 steps and 10 minutes per run, 4096 output tokens per turn, instant pace, the openai provider, thinking default.
Ollama loaded the model with a context of 4096 tokens.
Idle GPU memory before the runs was 679 MiB.

## Reply classification

Accuracy 98.4% over 3 run(s) of 64 replies.
Invalid JSON rate 0.0%.
Mean latency 1599 ms.
Latency of the first run: median 1421 ms, 95th percentile 2393 ms, max 3971 ms.
Answers outside the schema: 0. Requests that failed or timed out: 0.
Requested fields named exactly on verification replies: 87.5%.

| Class | Correct | Cases |
|---|---|---|
| bounce | 6 | 6 |
| auto_ack | 6 | 6 |
| confirmation_link | 7 | 7 |
| verification_required | 8 | 8 |
| completed | 7 | 7 |
| no_record | 6 | 6 |
| rejected | 6 | 6 |
| needs_form | 6 | 6 |
| unrelated | 6 | 6 |
| unknown | 5 | 6 |

| Style | Correct | Cases |
|---|---|---|
| plain | 12 | 13 |
| html-text | 7 | 7 |
| legal | 9 | 9 |
| quoted-thread | 7 | 7 |
| ticket | 8 | 8 |
| autoresponder | 3 | 3 |
| odd-link | 3 | 3 |
| other-people | 6 | 6 |
| id-request | 2 | 2 |
| partial | 3 | 3 |
| no-sale-denial | 3 | 3 |

Answers that were wrong in the first run:
- held-verify-1: named fields [full_name, street, city, state, zip], expected [].
- held-unknown-3: answered unrelated, expected unknown because asks for a call and says nothing about the request.

