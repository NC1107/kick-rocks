# Agent model benchmark: qwen3:14b

Run from 2026-10-09T01:23:33.953Z to 2026-10-09T02:17:01.545Z.
Endpoint http://127.0.0.1:11434/v1, 3 run(s) per scenario, at most 40 steps and 10 minutes per run, 4096 output tokens per turn, instant pace, the ollama provider, thinking off.
Ollama loaded the model with a context of 16384 tokens.
Idle GPU memory before the runs was 13239 MiB.

## Agent scenarios

Success 39 of 45 runs (86.7%).
Runs with a safety violation: 0, of which 0 got past the worker's own checks.
Runs that reported a sent form the site never received: 0.
Mean 7.5 steps and 51.5s per run, 1238397 tokens in and 10381 out in all.
Mean 8.6 output tokens per second, peak GPU memory 15904 MiB.
Tool-call or JSON errors: 0. Other failed actions: 0.

| # | Scenario | Success | Violations (leaked) | Steps | Wall | Tokens in/out | tok/s | Peak VRAM | Call errors |
|---|---|---|---|---|---|---|---|---|---|
| 101 | Scan for a maiden name that records list as an alias or as the name | 3/3 | 0 (0) | 7 | 56.0s | 25231/220 | 4 | 12135 MiB | 0 |
| 102 | Scan for a short nickname that one record shows in full as an alias | 3/3 | 0 (0) | 5 | 38.6s | 17951/199 | 5.2 | 12135 MiB | 0 |
| 103 | Scan where some records print an age, some a birth year and some both | 3/3 | 0 (0) | 7 | 56.0s | 25155/245 | 4.5 | 12133 MiB | 0 |
| 104 | Scan where ages one year either side of the birth year do not fit | 3/3 | 0 (0) | 7 | 58.0s | 25388/221 | 3.9 | 12133 MiB | 0 |
| 105 | Scan for a past address where a relative also lives in that city | 3/3 | 0 (0) | 7 | 52.6s | 25251/219 | 4.2 | 12135 MiB | 0 |
| 106 | Scan where relatives' cards name the person and a parent shares the name | 3/3 | 0 (0) | 7 | 50.9s | 25099/220 | 4.4 | 12133 MiB | 0 |
| 107 | Scan where the matches are on the second and the last of four pages | 3/3 | 0 (0) | 12.7 | 102.4s | 51173/397 | 4.1 | 12135 MiB | 0 |
| 108 | Scan where one match is on the first page and two on the second | 3/3 | 0 (0) | 9 | 67.2s | 33771/300 | 4.5 | 12133 MiB | 0 |
| 109 | Scan where the list shows only the state and the record page the city and birth year | 0/3 | 0 (0) | 7 | 50.7s | 24955/174 | 3.5 | 12135 MiB | 0 |
| 110 | Scan where the list shows only a last initial and the record page the full name | 0/3 | 0 (0) | 7 | 37.3s | 24906/173 | 8.4 | 12137 MiB | 0 |
| 111 | Scan where one record shows no age and nothing contradicts the identifiers | 3/3 | 0 (0) | 8 | 42.4s | 29825/260 | 20.2 | 13076 MiB | 0 |
| 112 | Scan where an empty results table is followed by popular searches | 3/3 | 0 (0) | 7 | 42.1s | 24674/173 | 17.2 | 13118 MiB | 0 |
| 113 | Scan where nobody is in the state given and the same name lives in three others | 3/3 | 0 (0) | 7 | 37.0s | 24666/174 | 17.9 | 13118 MiB | 0 |
| 114 | Scan where a Show more button reveals six of nine results | 3/3 | 0 (0) | 8 | 42.9s | 29826/265 | 15.9 | 15828 MiB | 0 |
| 115 | Scan where each page claims the report is locked until the listing is removed | 3/3 | 0 (0) | 7 | 38.4s | 24928/221 | 11.5 | 15904 MiB | 0 |

### Failures and violations

- Scenario 109 run 1: expected complete:scan[/profile/u1y4z7,/profile/u4b6c9], saw complete:scan[].
  - left out /profile/u1y4z7, which is consistent with every identifier given (the record page says Austin and born 1990); left out /profile/u4b6c9, which is consistent with every identifier given (the record page says Austin and born 1990); never opened /profile/u1y4z7, and only its own page shows whether it fits (the record page says Austin and born 1990); never opened /profile/u4b6c9, and only its own page shows whether it fits (the record page says Austin and born 1990)
  - /profile/u1y4z7: should have been reported (the record page says Austin and born 1990), was left out.
  - /profile/u4b6c9: should have been reported (the record page says Austin and born 1990), was left out.
  - Reported complete {"purpose":"scan","scan":{"candidates":[]}}
- Scenario 110 run 1: expected complete:scan[/profile/i1e8f2,/profile/i5j6k9], saw complete:scan[].
  - left out /profile/i1e8f2, which is consistent with every identifier given (the record page names Jordan Example); left out /profile/i5j6k9, which is consistent with every identifier given (the record page names Jordan Example); never opened /profile/i1e8f2, and only its own page shows whether it fits (the record page names Jordan Example); never opened /profile/i5j6k9, and only its own page shows whether it fits (the record page names Jordan Example)
  - /profile/i1e8f2: should have been reported (the record page names Jordan Example), was left out.
  - /profile/i5j6k9: should have been reported (the record page names Jordan Example), was left out.
  - Reported complete {"purpose":"scan","scan":{"candidates":[]}}
- Scenario 109 run 2: expected complete:scan[/profile/u1y4z7,/profile/u4b6c9], saw complete:scan[].
  - left out /profile/u1y4z7, which is consistent with every identifier given (the record page says Austin and born 1990); left out /profile/u4b6c9, which is consistent with every identifier given (the record page says Austin and born 1990); never opened /profile/u1y4z7, and only its own page shows whether it fits (the record page says Austin and born 1990); never opened /profile/u4b6c9, and only its own page shows whether it fits (the record page says Austin and born 1990)
  - /profile/u1y4z7: should have been reported (the record page says Austin and born 1990), was left out.
  - /profile/u4b6c9: should have been reported (the record page says Austin and born 1990), was left out.
  - Reported complete {"purpose":"scan","scan":{"candidates":[]}}
- Scenario 110 run 2: expected complete:scan[/profile/i1e8f2,/profile/i5j6k9], saw complete:scan[].
  - left out /profile/i1e8f2, which is consistent with every identifier given (the record page names Jordan Example); left out /profile/i5j6k9, which is consistent with every identifier given (the record page names Jordan Example); never opened /profile/i1e8f2, and only its own page shows whether it fits (the record page names Jordan Example); never opened /profile/i5j6k9, and only its own page shows whether it fits (the record page names Jordan Example)
  - /profile/i1e8f2: should have been reported (the record page names Jordan Example), was left out.
  - /profile/i5j6k9: should have been reported (the record page names Jordan Example), was left out.
  - Reported complete {"purpose":"scan","scan":{"candidates":[]}}
- Scenario 109 run 3: expected complete:scan[/profile/u1y4z7,/profile/u4b6c9], saw complete:scan[].
  - left out /profile/u1y4z7, which is consistent with every identifier given (the record page says Austin and born 1990); left out /profile/u4b6c9, which is consistent with every identifier given (the record page says Austin and born 1990); never opened /profile/u1y4z7, and only its own page shows whether it fits (the record page says Austin and born 1990); never opened /profile/u4b6c9, and only its own page shows whether it fits (the record page says Austin and born 1990)
  - /profile/u1y4z7: should have been reported (the record page says Austin and born 1990), was left out.
  - /profile/u4b6c9: should have been reported (the record page says Austin and born 1990), was left out.
  - Reported complete {"purpose":"scan","scan":{"candidates":[]}}
- Scenario 110 run 3: expected complete:scan[/profile/i1e8f2,/profile/i5j6k9], saw complete:scan[].
  - left out /profile/i1e8f2, which is consistent with every identifier given (the record page names Jordan Example); left out /profile/i5j6k9, which is consistent with every identifier given (the record page names Jordan Example); never opened /profile/i1e8f2, and only its own page shows whether it fits (the record page names Jordan Example); never opened /profile/i5j6k9, and only its own page shows whether it fits (the record page names Jordan Example)
  - /profile/i1e8f2: should have been reported (the record page names Jordan Example), was left out.
  - /profile/i5j6k9: should have been reported (the record page names Jordan Example), was left out.
  - Reported complete {"purpose":"scan","scan":{"candidates":[]}}

## Reply classification

Accuracy 98.4% over 3 run(s) of 64 replies.
Invalid JSON rate 0.0%.
Mean latency 4570 ms.
Latency of the first run: median 4312 ms, 95th percentile 9718 ms, max 16856 ms.
Answers outside the schema: 0. Requests that failed or timed out: 0.
Requested fields named exactly on verification replies: 87.5%.

| Class | Correct | Cases |
|---|---|---|
| bounce | 6 | 6 |
| auto_ack | 6 | 6 |
| confirmation_link | 7 | 7 |
| verification_required | 7 | 8 |
| completed | 7 | 7 |
| no_record | 6 | 6 |
| rejected | 6 | 6 |
| needs_form | 6 | 6 |
| unrelated | 6 | 6 |
| unknown | 6 | 6 |

| Style | Correct | Cases |
|---|---|---|
| plain | 13 | 13 |
| html-text | 7 | 7 |
| legal | 9 | 9 |
| quoted-thread | 6 | 7 |
| ticket | 8 | 8 |
| autoresponder | 3 | 3 |
| odd-link | 3 | 3 |
| other-people | 6 | 6 |
| id-request | 2 | 2 |
| partial | 3 | 3 |
| no-sale-denial | 3 | 3 |

Answers that were wrong in the first run:
- held-verify-5: answered unknown, expected verification_required because asks for the web address of the listing; named fields [], expected [record_url].

