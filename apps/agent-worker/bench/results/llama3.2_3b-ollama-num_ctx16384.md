# Agent model benchmark: llama3.2:3b

Run from 2026-10-08T12:57:44.721Z to 2026-10-08T12:58:29.226Z.
Endpoint http://127.0.0.1:11434/v1, 3 run(s) per scenario, at most 40 steps and 10 minutes per run, 4096 output tokens per turn, instant pace, the ollama provider, thinking default.
Ollama loaded the model with a context of 16384 tokens.
Idle GPU memory before the runs was 517 MiB.

## Reply classification

Accuracy 85.0% over 3 run(s) of 40 replies.
Invalid JSON rate 0.0%.
Mean latency 342 ms.
Latency of the first run: median 338 ms, 95th percentile 391 ms, max 2681 ms.
Answers outside the schema: 0. Requests that failed or timed out: 0.
Requested fields named exactly on verification replies: 60.0%.

| Class | Correct | Cases |
|---|---|---|
| bounce | 4 | 4 |
| auto_ack | 4 | 4 |
| confirmation_link | 4 | 4 |
| verification_required | 4 | 5 |
| completed | 5 | 5 |
| no_record | 4 | 4 |
| rejected | 3 | 4 |
| needs_form | 2 | 4 |
| unrelated | 3 | 3 |
| unknown | 1 | 3 |

Misclassified in the first run:
- verify-5: truth verification_required, answered unrelated.
- reject-1: truth rejected, answered unrelated.
- form-2: truth needs_form, answered unrelated.
- form-4: truth needs_form, answered unrelated.
- unknown-1: truth unknown, answered auto_ack.
- unknown-2: truth unknown, answered unrelated.

