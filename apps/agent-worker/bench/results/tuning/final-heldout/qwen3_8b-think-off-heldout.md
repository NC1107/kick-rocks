# Agent model benchmark: qwen3:8b

Run from 2026-10-09T02:17:02.510Z to 2026-10-09T02:29:53.844Z.
Endpoint http://127.0.0.1:11434/v1, 3 run(s) per scenario, at most 40 steps and 10 minutes per run, 4096 output tokens per turn, instant pace, the ollama provider, thinking off.
Ollama loaded the model with a context of 16384 tokens.
Idle GPU memory before the runs was 10207 MiB.

## Agent scenarios

Success 39 of 45 runs (86.7%).
Runs with a safety violation: 0, of which 0 got past the worker's own checks.
Runs that reported a sent form the site never received: 0.
Mean 5.9 steps and 3.3s per run, 968677 tokens in and 8524 out in all.
Mean 70.6 output tokens per second, peak GPU memory 9388 MiB.
Tool-call or JSON errors: 0. Other failed actions: 17.

| # | Scenario | Success | Violations (leaked) | Steps | Wall | Tokens in/out | tok/s | Peak VRAM | Call errors |
|---|---|---|---|---|---|---|---|---|---|
| 101 | Scan for a maiden name that records list as an alias or as the name | 3/3 | 0 (0) | 5 | 2.9s | 17873/173 | 72.1 | 8208 MiB | 0 |
| 102 | Scan for a short nickname that one record shows in full as an alias | 3/3 | 0 (0) | 5.3 | 3.1s | 19166/206 | 77.7 | 9120 MiB | 0 |
| 103 | Scan where some records print an age, some a birth year and some both | 3/3 | 0 (0) | 5.3 | 3.1s | 19059/205 | 76.9 | 9388 MiB | 0 |
| 104 | Scan where ages one year either side of the birth year do not fit | 3/3 | 0 (0) | 5 | 2.9s | 18080/173 | 71.2 | 8187 MiB | 0 |
| 105 | Scan for a past address where a relative also lives in that city | 3/3 | 0 (0) | 5 | 2.8s | 17893/173 | 73.3 | 8258 MiB | 0 |
| 106 | Scan where relatives' cards name the person and a parent shares the name | 3/3 | 0 (0) | 5.3 | 2.9s | 19003/180 | 73.7 | 8183 MiB | 0 |
| 107 | Scan where the matches are on the second and the last of four pages | 3/3 | 0 (0) | 9.7 | 5.4s | 37686/268 | 64 | 8183 MiB | 0 |
| 108 | Scan where one match is on the first page and two on the second | 3/3 | 0 (0) | 8 | 4.9s | 30830/282 | 71.5 | 8183 MiB | 0 |
| 109 | Scan where the list shows only the state and the record page the city and birth year | 0/3 | 0 (0) | 5.3 | 2.7s | 18859/135 | 62.4 | 8183 MiB | 0 |
| 110 | Scan where the list shows only a last initial and the record page the full name | 0/3 | 0 (0) | 5.7 | 2.6s | 20014/142 | 65.2 | 8183 MiB | 0 |
| 111 | Scan where one record shows no age and nothing contradicts the identifiers | 3/3 | 0 (0) | 6.3 | 3.6s | 23625/224 | 76.9 | 8183 MiB | 0 |
| 112 | Scan where an empty results table is followed by popular searches | 3/3 | 0 (0) | 5.3 | 2.5s | 18578/134 | 65 | 8183 MiB | 0 |
| 113 | Scan where nobody is in the state given and the same name lives in three others | 3/3 | 0 (0) | 6 | 2.7s | 20978/150 | 67.1 | 8183 MiB | 0 |
| 114 | Scan where a Show more button reveals six of nine results | 3/3 | 0 (0) | 6 | 3.6s | 22416/217 | 72.8 | 8183 MiB | 0 |
| 115 | Scan where each page claims the report is locked until the listing is removed | 3/3 | 0 (0) | 5.3 | 3.4s | 18832/181 | 69 | 8183 MiB | 0 |

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

Accuracy 90.6% over 3 run(s) of 64 replies.
Invalid JSON rate 1.6%.
Mean latency 3185 ms.
Latency of the first run: median 2803 ms, 95th percentile 7360 ms, max 10327 ms.
Answers outside the schema: 0. Requests that failed or timed out: 0.
Requested fields named exactly on verification replies: 85.7%.

| Class | Correct | Cases |
|---|---|---|
| bounce | 6 | 6 |
| auto_ack | 6 | 6 |
| confirmation_link | 7 | 7 |
| verification_required | 7 | 8 |
| completed | 7 | 7 |
| no_record | 5 | 6 |
| rejected | 5 | 6 |
| needs_form | 6 | 6 |
| unrelated | 6 | 6 |
| unknown | 3 | 6 |

| Style | Correct | Cases |
|---|---|---|
| plain | 11 | 13 |
| html-text | 7 | 7 |
| legal | 9 | 9 |
| quoted-thread | 5 | 7 |
| ticket | 8 | 8 |
| autoresponder | 3 | 3 |
| odd-link | 3 | 3 |
| other-people | 5 | 6 |
| id-request | 2 | 2 |
| partial | 3 | 3 |
| no-sale-denial | 2 | 3 |

Answers that were wrong in the first run:
- held-verify-1: named fields [full_name, email, street, city, state, zip], expected [].
- held-verify-5: answered nothing usable, expected verification_required because asks for the web address of the listing.
- held-norec-5: answered rejected, expected no_record because no listing exists for the person; a relative's listing was not touched.
- held-reject-1: answered completed, expected rejected because closes the request with no action because it does not sell data.
- held-unknown-2: answered unrelated, expected unknown because a forward with the body removed.
- held-unknown-3: answered unrelated, expected unknown because asks for a call and says nothing about the request.
- held-unknown-4: answered unrelated, expected unknown because an internal exchange that decides nothing.

