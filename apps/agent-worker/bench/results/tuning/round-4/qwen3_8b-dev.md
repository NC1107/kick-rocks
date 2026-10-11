# Agent model benchmark: qwen3:8b

Run from 2026-10-09T08:03:45.282Z to 2026-10-09T08:17:29.718Z.
Endpoint http://127.0.0.1:11434/v1, 3 run(s) per scenario, at most 40 steps and 10 minutes per run, 4096 output tokens per turn, instant pace, the openai provider, thinking default.
Ollama loaded the model with a context of 4096 tokens.
Idle GPU memory before the runs was 948 MiB.

## Reply classification

Accuracy 99.0% over 3 run(s) of 96 replies.
Invalid JSON rate 0.0%.
Mean latency 2843 ms.
Latency of the first run: median 2730 ms, 95th percentile 4163 ms, max 6603 ms.
Answers outside the schema: 0. Requests that failed or timed out: 0.
Requested fields named exactly on verification replies: 100.0%.

| Class | Correct | Cases |
|---|---|---|
| bounce | 10 | 10 |
| auto_ack | 9 | 10 |
| confirmation_link | 11 | 11 |
| verification_required | 12 | 12 |
| completed | 11 | 11 |
| no_record | 8 | 8 |
| rejected | 10 | 10 |
| needs_form | 8 | 8 |
| unrelated | 8 | 8 |
| unknown | 8 | 8 |

| Style | Correct | Cases |
|---|---|---|
| plain | 51 | 52 |
| html-text | 7 | 7 |
| quoted-thread | 8 | 8 |
| legal | 7 | 7 |
| autoresponder | 2 | 2 |
| ticket | 6 | 6 |
| odd-link | 5 | 5 |
| id-request | 1 | 1 |
| other-people | 4 | 4 |
| partial | 2 | 2 |
| no-sale-denial | 2 | 2 |

Answers that were wrong in the first run:
- ack-2: answered unknown, expected auto_ack.

