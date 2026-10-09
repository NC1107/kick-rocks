# Reply classifier bench

Measures how well each way of reading a broker reply picks a `ReplyClassification`.
All data is synthetic, on reserved or invented domains.

## Data

- `data/tuning/` holds the labeled replies written for tuning the agent worker, copied from `kr3/agent-tuning`.
  Its dev and held-out sets stay as that branch split them.
- `apps/server/fixtures/mail-intake/` is the mixed-inbox corpus, copied from `loop/mail-intake` at df13aa6.
  Mail with no classification in its labels counts as `unrelated`.
- `data/live-shape.ts` adds replies in the shape of one seen live: a privacy mailbox that opens with "Thank you for contacting us" and then says requests must go through a web form or by phone.
  They must be `needs_form`.
  Three are in dev and two in held-out.

Every item is treated as a reply to one known request that the sender may answer.
That measures the reading of the text, not routing or sender trust.
Mixed-inbox mail with no classification is mail the inbox poll would drop before classifying, so it makes the `unrelated` class harder here than in production.
The report gives accuracy per source for that reason.

## Running

- `pnpm bench:replies` runs every candidate that can run and writes a Markdown and a JSON report to `results/`.
- `pnpm bench:replies --candidates rules,b-label-scoring` runs only those.
- `--model name` picks the Ollama model for candidates a and b.
- `--sources tuning` or `--sources intake` limits the data.
- `--split dev` leaves held-out unread, which is the mode for tuning.
- `pnpm bench:replies:python` creates the uv environment under `python/.venv` that candidate d needs.
- Candidates c use the reply model recipe in `apps/server/reply-model`, so they need its environment: `pnpm --filter @kickrocks/server reply-model:env`.
  It is gitignored, and nothing is installed system-wide.

The GPU is shared.
Before loading a model a candidate waits until `ollama ps` lists nothing and enough memory is free.
Candidates run one after another, and each unloads its model when it is done.

## Candidates

- `rules`: the rules alone, as a floor.
- `a-rules-llm`: the classifier as shipped, with `askLlm` pointed at Ollama.
- `b-label-scoring`: rules, then one forward pass per reply on a local model.
  Each class is a letter, one token is generated, and the class probabilities come from that token's logprobs, normalized over the label set.
  It skips itself when Ollama returns no logprobs for the model.
- `c-encoder-gpu` and `c-encoder-cpu`: rules, then an encoder (ModernBERT-base by default, `REPLY_ENCODER` to change) fine-tuned on the dev split only.
  Temperature is fit on out-of-fold dev logits, and the dev figures are the out-of-fold answers.
  The trained model is cached under `python/.cache/`, keyed by the training items and the recipe.
  Training and serving are the server's own `reply-model/model.py`, and the input text is the server's `encoderText`.
- `c-encoder-node`: the same pipeline with the shipped model, an ONNX release run by the server's own host in its child process.
  Dev answers are the release's out-of-fold answers from `dev-oof.json`, and held-out goes through the runtime.
  It reads the release from `REPLY_MODEL_RELEASE_DIR` (default `apps/server/reply-model/dist`) and is skipped when there is none.
- `d-nli-gpu` and `d-nli-cpu`: rules, then a zero-shot NLI model (`REPLY_NLI_MODEL`; deberta-v3-large-zeroshot-v2.0 on the GPU and deberta-v3-base-zeroshot-v2.0 on the CPU by default) that treats each class as a hypothesis.
- `e-jev`: rules, then Jev from TypeSafe over `POST https://api.typesafe.ai/v1/systemone` with one Choice question.
  It runs only when `TYPESAFE_API_KEY` is set and is reported as skipped otherwise.
  Its class probabilities are used as the confidence, like every other candidate.

Rules come first in every pipeline variant, and the model sees only what the rules leave under the confidence threshold.

## What is reported

Per candidate, on held-out:

- per-class precision and recall, accuracy, macro F1;
- expected calibration error over ten bins, and the reliability table;
- the confidence threshold on dev that keeps 95 percent precision, applied to held-out, with accuracy there and how many replies fall below it;
- p50 and p95 latency per reply and for the model call alone;
- the hardware.

## First run

`results/2026-10-09T01-12-20-279Z.md` has the full report: 332 dev and 224 held-out replies, granite4.1:8b for candidates a and b, ModernBERT-base for c, deberta-v3 zero-shot for d.
Jev was skipped because `TYPESAFE_API_KEY` was not set.

- Ollama 0.30.6 returns logprobs on `/api/chat` with `logprobs` and `top_logprobs`, so candidate b runs without llama.cpp.
- Held-out accuracy: rules 50.0%, a 67.0%, b 68.8%, c 70.1%, d 62.9% on GPU and 65.2% on CPU.
- Only the encoder reaches 95 percent precision at a usable coverage: threshold 0.961 chosen on out-of-fold dev gives 95.7% on the 47 held-out replies at or above it, with 177 of 224 below it.
- The biggest error in every pipeline is mixed-inbox mail with no request behind it that the rules call `auto_ack` or `unknown`.
  Production drops that mail before classifying, so the absolute numbers are harsher than production, and `--sources tuning` shows the reply-only picture.
- The rules misread three of the five "Thank you for contacting us" replies that need a form as `auto_ack` at 0.85 or more, so the rules answer stands and no model sees them.
- The GPU was shared with another bench during the run, so GPU latencies for a and b include contention and model swaps.
  Encoder and NLI latencies are one reply at a time with the model resident.

## Second run

The second run added five local models and ran every runnable candidate once more.
Jev was skipped again because `TYPESAFE_API_KEY` is not set.
Candidates a and b ran on qwen3:8b and qwen3:4b with reasoning off, gpt-oss:20b at its default effort because it cannot turn reasoning off, llama3.2:3b and granite4.1:3b.
Candidate a asks for reasoning off with `reasoning_effort: none` through `--no-reasoning`, and candidate b always sends `think: false`.
The encoder is trained on dev only.

Every run is kept in this folder, and each report names its model in the heading.
Where a model ran more than once, a row uses the run with the least GPU contention.
Every run read held-out once per candidate after it was done with dev, and nothing was tuned against it.

Latency is the model call alone.
Another agent's bench shared the GPU during every run, and it loaded large models in the middle of some.
The qwen3:8b figure for candidate a is badly inflated by that: the first run, before the model-call timer existed, had a p95 of 699 ms per reply across all replies.
Treat the GPU latencies of the 8b and 20b models as upper bounds.
The dev rows of the encoder have no latency because the out-of-fold answers are not timed one by one.

Recall is per class on the same split.
Coverage is the share of replies at or above the confidence that reached 95 percent precision on dev, with the accuracy there.
The dev rows use their own threshold, so they are optimistic.

| Candidate | Split | Accuracy | Macro F1 | ECE | Coverage at 95% precision | Model-call p50 / p95 | Hardware | needs_form | confirmation_link | verification_required | completed | unrelated |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rules | dev | 50.6% | 62.1% | 0.170 | none | n/a | CPU | 70.6% | 57.7% | 75.0% | 92.1% | 0.0% |
| rules | held-out | 50.0% | 61.3% | 0.168 | none | n/a | CPU | 70.0% | 58.8% | 87.5% | 88.9% | 0.0% |
| c-encoder-gpu | dev | 69.9% | 80.0% | 0.178 | 21.4% (71/332), 95.8% acc | n/a | RTX 5080 | 76.5% | 80.8% | 79.2% | 92.1% | 34.4% |
| c-encoder-gpu | held-out | 70.1% | 80.8% | 0.161 | 21.0% (47/224), 95.7% acc | 5 ms / 6 ms | RTX 5080 | 70.0% | 82.4% | 87.5% | 96.3% | 34.9% |
| c-encoder-cpu | dev | 69.9% | 80.0% | 0.178 | 21.4% (71/332), 95.8% acc | n/a | Ryzen 9 9950X3D | 76.5% | 80.8% | 79.2% | 92.1% | 34.4% |
| c-encoder-cpu | held-out | 70.1% | 80.8% | 0.162 | 21.0% (47/224), 95.7% acc | 29 ms / 45 ms | Ryzen 9 9950X3D | 70.0% | 82.4% | 87.5% | 96.3% | 34.9% |
| d-nli-gpu | dev | 62.7% | 73.3% | 0.172 | 3.6% (12/332), 100.0% acc | 11 ms / 26 ms | RTX 5080 | 70.6% | 76.9% | 83.3% | 94.7% | 16.4% |
| d-nli-gpu | held-out | 62.9% | 73.7% | 0.187 | 2.2% (5/224), 100.0% acc | 11 ms / 22 ms | RTX 5080 | 70.0% | 82.4% | 87.5% | 92.6% | 19.3% |
| d-nli-cpu | dev | 63.0% | 70.9% | 0.175 | 1.2% (4/332), 100.0% acc | 829 ms / 2.1 s | Ryzen 9 9950X3D | 76.5% | 76.9% | 79.2% | 92.1% | 23.0% |
| d-nli-cpu | held-out | 65.2% | 75.6% | 0.188 | 0.4% (1/224), 100.0% acc | 824 ms / 2.0 s | Ryzen 9 9950X3D | 70.0% | 88.2% | 87.5% | 88.9% | 22.9% |
| a-rules-llm (qwen3:8b) | dev | 67.2% | 74.8% | 0.188 | none | 10.3 s / 14.2 s | RTX 5080 | 76.5% | 57.7% | 79.2% | 94.7% | 35.2% |
| a-rules-llm (qwen3:8b) | held-out | 67.0% | 75.0% | 0.193 | none | 10.5 s / 14.6 s | RTX 5080 | 80.0% | 58.8% | 87.5% | 92.6% | 36.1% |
| b-label-scoring (qwen3:8b) | dev | 65.4% | 70.9% | 0.221 | 16.6% (55/332), 96.4% acc | 114 ms / 121 ms | RTX 5080 | 76.5% | 80.8% | 79.2% | 94.7% | 32.0% |
| b-label-scoring (qwen3:8b) | held-out | 65.2% | 70.1% | 0.219 | 20.1% (45/224), 95.6% acc | 110 ms / 121 ms | RTX 5080 | 70.0% | 94.1% | 87.5% | 88.9% | 32.5% |
| a-rules-llm (qwen3:4b) | dev | 66.3% | 73.4% | 0.186 | none | 578 ms / 789 ms | RTX 5080 | 76.5% | 57.7% | 79.2% | 94.7% | 34.4% |
| a-rules-llm (qwen3:4b) | held-out | 66.5% | 74.0% | 0.188 | none | 555 ms / 672 ms | RTX 5080 | 80.0% | 58.8% | 87.5% | 96.3% | 34.9% |
| b-label-scoring (qwen3:4b) | dev | 59.6% | 63.6% | 0.285 | none | 103 ms / 109 ms | RTX 5080 | 70.6% | 57.7% | 75.0% | 92.1% | 36.1% |
| b-label-scoring (qwen3:4b) | held-out | 58.9% | 62.7% | 0.301 | none | 102 ms / 108 ms | RTX 5080 | 70.0% | 58.8% | 87.5% | 88.9% | 36.1% |
| a-rules-llm (gpt-oss:20b) | dev | 64.8% | 72.6% | 0.194 | none | 1.1 s / 3.3 s | RTX 5080 | 82.4% | 57.7% | 83.3% | 94.7% | 30.3% |
| a-rules-llm (gpt-oss:20b) | held-out | 65.2% | 73.3% | 0.189 | none | 1.0 s / 3.0 s | RTX 5080 | 80.0% | 58.8% | 87.5% | 96.3% | 31.3% |
| b-label-scoring (gpt-oss:20b) | dev | 47.6% | 56.3% | 0.392 | none | 220 ms / 229 ms | RTX 5080 | 70.6% | 57.7% | 83.3% | 92.1% | 0.0% |
| b-label-scoring (gpt-oss:20b) | held-out | 46.0% | 54.1% | 0.418 | none | 220 ms / 229 ms | RTX 5080 | 70.0% | 58.8% | 87.5% | 88.9% | 0.0% |
| a-rules-llm (llama3.2:3b) | dev | 64.8% | 72.2% | 0.193 | none | 714 ms / 835 ms | RTX 5080 | 70.6% | 57.7% | 79.2% | 94.7% | 33.6% |
| a-rules-llm (llama3.2:3b) | held-out | 63.8% | 72.2% | 0.197 | none | 716 ms / 827 ms | RTX 5080 | 70.0% | 58.8% | 87.5% | 88.9% | 34.9% |
| b-label-scoring (llama3.2:3b) | dev | 63.0% | 68.9% | 0.207 | 3.6% (12/332), 100.0% acc | 121 ms / 130 ms | RTX 5080 | 76.5% | 80.8% | 75.0% | 92.1% | 32.0% |
| b-label-scoring (llama3.2:3b) | held-out | 63.8% | 69.4% | 0.179 | 3.6% (8/224), 100.0% acc | 139 ms / 149 ms | RTX 5080 | 80.0% | 94.1% | 87.5% | 88.9% | 33.7% |
| a-rules-llm (granite4.1:3b) | dev | 66.6% | 75.2% | 0.212 | none | 384 ms / 472 ms | RTX 5080 | 76.5% | 57.7% | 83.3% | 94.7% | 30.3% |
| a-rules-llm (granite4.1:3b) | held-out | 67.4% | 76.4% | 0.206 | none | 386 ms / 439 ms | RTX 5080 | 80.0% | 58.8% | 87.5% | 92.6% | 33.7% |
| b-label-scoring (granite4.1:3b) | dev | 65.7% | 73.1% | 0.219 | 3.3% (11/332), 100.0% acc | 75 ms / 79 ms | RTX 5080 | 82.4% | 80.8% | 79.2% | 94.7% | 30.3% |
| b-label-scoring (granite4.1:3b) | held-out | 65.6% | 69.9% | 0.213 | 4.5% (10/224), 100.0% acc | 74 ms / 80 ms | RTX 5080 | 80.0% | 94.1% | 87.5% | 92.6% | 33.7% |

