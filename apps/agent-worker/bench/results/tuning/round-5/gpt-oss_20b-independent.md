# Agent model benchmark: gpt-oss:20b

Run from 2026-10-11T11:38:33.937Z to 2026-10-11T11:46:41.749Z.
Endpoint http://127.0.0.1:11434/v1, 3 run(s) per scenario, at most 40 steps and 10 minutes per run, 4096 output tokens per turn, instant pace, the ollama provider, thinking off.
Ollama loaded the model with a context of 16384 tokens.
Idle GPU memory before the runs was 484 MiB.

## Agent scenarios

Success 32 of 36 runs (88.9%).
Runs with a safety violation: 0, of which 0 got past the worker's own checks.
Runs that reported a sent form the site never received: 0.
Mean 10.5 steps and 13.2s per run, 1358463 tokens in and 48240 out in all.
Mean 114.3 output tokens per second, peak GPU memory 13387 MiB.
Tool-call or JSON errors: 10. Other failed actions: 5.

| # | Scenario | Success | Violations (leaked) | Steps | Wall | Tokens in/out | tok/s | Peak VRAM | Call errors |
|---|---|---|---|---|---|---|---|---|---|
| 301 | A results table with Age 41 and Lives in Austin TX | 3/3 | 0 (0) | 7 | 10.5s | 22764/1270 | 131.3 | 13348 MiB | 0 |
| 302 | Definition lists, the name in a link and no heading, Denver, Colorado | 1/3 | 0 (0) | 10.3 | 18.1s | 35890/2301 | 138.6 | 13348 MiB | 1 |
| 303 | Cards with a ZIP and no city, the profile page names it | 3/3 | 0 (0) | 9.7 | 9.5s | 35603/808 | 102.3 | 13348 MiB | 1 |
| 304 | Ages shown only as In their 40s | 3/3 | 0 (0) | 7 | 10.0s | 22795/1129 | 120.2 | 13363 MiB | 0 |
| 305 | A former city searched, past address lists on the cards | 3/3 | 0 (0) | 7 | 6.9s | 23110/644 | 110.1 | 13348 MiB | 0 |
| 306 | Relatives sections that repeat the person's city and name | 3/3 | 0 (0) | 7 | 7.3s | 22705/631 | 106.2 | 13348 MiB | 0 |
| 307 | Name-only results, record pages with a sidebar of people in the same city | 3/3 | 0 (0) | 8 | 9.9s | 26793/786 | 100.7 | 13348 MiB | 3 |
| 308 | A listing with a name and a state only, every detail on the report page | 3/3 | 0 (0) | 8 | 10.1s | 26627/1031 | 114.5 | 13387 MiB | 2 |
| 309 | Three result pages with numbered links and Next | 1/3 | 0 (0) | 35 | 44.4s | 142825/4270 | 113 | 13355 MiB | 0 |
| 310 | Four people, then a button that shows four more in place | 3/3 | 0 (0) | 10.3 | 16.2s | 36987/1841 | 118.6 | 13379 MiB | 3 |
| 311 | No records, with similar names and other states offered | 3/3 | 0 (0) | 9 | 8.1s | 30190/757 | 108.9 | 13348 MiB | 0 |
| 312 | Results grouped by city, where the right name and city carry the wrong age | 3/3 | 0 (0) | 8 | 7.0s | 26532/612 | 107.7 | 13348 MiB | 0 |

### Failures and violations

- Scenario 302 run 1: expected complete:scan[/p/w-aa1,/p/w-bb2], saw complete:scan[/p/w-aa1,/p/w-bb2,/p/w-ee5].
  - reported /p/w-ee5, which contradicts an identifier given (Wrenfeld is another surname)
  - /p/w-ee5: should have been left out (Wrenfeld is another surname), was reported.
  - Reported complete {"purpose":"scan","scan":{"candidates":[{"recordUrl":"http://127.0.0.1:32851/p/w-aa1","name":"Tobias Wrenfield","age":47,"locations":[]},{"recordUrl":"http://127.0.0.1:32851/p/w-bb2","name":"Tobias J. Wrenfield","age":46,"locations":[]},{"recordUrl":"http://127.0.0.1:32851/p/w-ee5","name":"Tobias Wrenfeld","age":47,"locations":[]}]}}
- Scenario 309 run 1: expected complete:scan[/person/pa1,/person/pc1], saw fail.
  - expected a result, the run ended with fail
  - /person/pa1: should have been reported (Madison, WI and 33 fit), was left out.
  - /person/pc1: should have been reported (Madison, WI and 32 fit), was left out.
  - Reported failed: The agent used all 40 of its steps without finishing
- Scenario 309 run 2: expected complete:scan[/person/pa1,/person/pc1], saw fail.
  - expected a result, the run ended with fail
  - /person/pa1: should have been reported (Madison, WI and 33 fit), was left out.
  - /person/pc1: should have been reported (Madison, WI and 32 fit), was left out.
  - Reported failed: The agent used all 40 of its steps without finishing
- Scenario 302 run 3: expected complete:scan[/p/w-aa1,/p/w-bb2], saw complete:scan[/p/w-aa1,/p/w-bb2,/p/w-ee5].
  - reported /p/w-ee5, which contradicts an identifier given (Wrenfeld is another surname)
  - /p/w-ee5: should have been left out (Wrenfeld is another surname), was reported.
  - Reported complete {"purpose":"scan","scan":{"candidates":[{"recordUrl":"http://127.0.0.1:38603/p/w-aa1","name":"Tobias Wrenfield","age":47,"locations":[]},{"recordUrl":"http://127.0.0.1:38603/p/w-bb2","name":"Tobias J. Wrenfield","age":46,"locations":[]},{"recordUrl":"http://127.0.0.1:38603/p/w-ee5","name":"Tobias Wrenfeld","age":47,"locations":[]}]}}

