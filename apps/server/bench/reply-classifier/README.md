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
- `pnpm bench:replies -- --candidates rules,b-label-scoring` runs only those.
- `--model name` picks the Ollama model for candidates a and b.
- `--sources tuning` or `--sources intake` limits the data.
- `--split dev` leaves held-out unread, which is the mode for tuning.
- `pnpm bench:replies:python` creates the uv environment under `python/.venv` that candidates c and d need.
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
  The trained model is cached under `python/.cache/`, keyed by the training items.
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
