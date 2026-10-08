# Agent model benchmark: mistral-small3.2

Run from 2026-10-08T12:58:30.228Z to 2026-10-08T13:01:43.893Z.
Endpoint http://127.0.0.1:11434/v1, 3 run(s) per scenario, at most 40 steps and 10 minutes per run, 4096 output tokens per turn, instant pace, the ollama provider, thinking default.
Ollama loaded the model with a context of 16384 tokens.
Idle GPU memory before the runs was 517 MiB.

## Reply classification

Accuracy 95.0% over 3 run(s) of 40 replies.
Invalid JSON rate 0.0%.
Mean latency 1541 ms.
Latency of the first run: median 1428 ms, 95th percentile 1900 ms, max 5785 ms.
Answers outside the schema: 0. Requests that failed or timed out: 0.
Requested fields named exactly on verification replies: 80.0%.

| Class | Correct | Cases |
|---|---|---|
| bounce | 4 | 4 |
| auto_ack | 4 | 4 |
| confirmation_link | 4 | 4 |
| verification_required | 5 | 5 |
| completed | 5 | 5 |
| no_record | 4 | 4 |
| rejected | 4 | 4 |
| needs_form | 4 | 4 |
| unrelated | 3 | 3 |
| unknown | 1 | 3 |

Misclassified in the first run:
- unknown-1: truth unknown, answered auto_ack.
- unknown-2: truth unknown, answered verification_required.

