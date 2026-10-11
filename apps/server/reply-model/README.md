# Reply model

This folder holds the recipe that makes the reply model, and the checks that tie a release to the code that reads it.
The server runs the model after the rules, on replies the rules leave under 0.6.
The design and the numbers behind it are in `docs/reply-classifier.md`.

## What a release is

A release is one tar with four files:

- `model.onnx`, a ModernBERT-base fine-tuned on the dev replies, in fp32.
- `tokenizer.json` and `tokenizer_config.json`.
- `manifest.json`, which names the labels, the temperature, the input format, the threshold, the training inputs, the metrics and the sha256 of every other file.

The image bakes the tar in at `/app/reply-model`.
The server checks the manifest on every start and hashes each file before it loads the model.
A release is pinned by the sha256 of the tar in `release.json`, and the Dockerfile refuses a download that does not match.

## Why the result is not bit-identical

Everything that decides the result is pinned: the base model revision, the Python packages by hash, the seed, the thread count, fp32 on the CPU, and deterministic algorithms.
Results still differ between CPUs, so running the recipe again gives a model that passes the same checks, not the same bytes.
That is why a release is pinned by digest and not by being rebuilt.

## Files

- `recipe.json` holds every setting.
- `requirements.in` and `requirements.lock` are the Python packages and their hashes.
- `model.py` trains, exports, and serves the model.
- `build.ts` runs the steps below.
- `data.ts` reads the dev and held-out replies from the bench corpus and runs the rules over them.
- `threshold.ts` picks the threshold.
- `release.ts` writes the manifest and the archive.
- `verify.ts` runs a release through the server's runtime and compares it with `golden.json`.
- `check-data.ts` fails when the dev replies are no longer the ones the pinned model was trained on.
- `golden-texts.json` holds the synthetic texts the golden fixture is made from.
- `release.json` pins the published release.

## Making a release

Create the Python environment once.
It lives in `.venv` next to this file and is not committed.

```
pnpm --filter @kickrocks/server reply-model:env
pnpm --filter @kickrocks/server reply-model:build --version v2
```

The build does these steps in order:

1. Writes the dev replies with the text the server would give the model and the rules' answer for each.
2. Trains 5 folds and records the out-of-fold logits.
3. Fits one temperature on those logits.
4. Trains the final model on all of dev.
5. Picks the threshold from out-of-fold answers, counting only replies the rules leave under 0.6.
   It is the lowest confidence where the answers at or above it keep 95% precision, with at least 30 answers.
6. Exports to ONNX and checks it against PyTorch to within 1e-4 on dev and held-out.
7. Reads held-out once and writes the numbers into the manifest.
   The build fails only if held-out precision at the threshold is under 90%.
   That is a sanity check and never a tuning signal.
8. Writes the golden fixture from PyTorch's answers.
9. Writes the manifest and the archive.

The `reply-model` workflow does the same on a CPU runner, attaches build provenance, and publishes the archive.
Expect 1.5 to 2.5 hours there.
Afterwards copy the version, url, `tarSha256`, `dataSha256` and threshold it prints into `release.json`, and commit the `golden.json` it attaches.

## Checking a release

```
pnpm --filter @kickrocks/server reply-model:verify --dir <folder with manifest.json>
pnpm --filter @kickrocks/server reply-model:check-data
```

`verify` answers each golden text through the same host the server uses and requires the same label and every probability within 1e-4.
`check-data` recomputes the digest of the dev replies and compares it with `release.json`.

## When the input changes

The text the model reads is made by `encoderText` in `src/mail/reply-model/input.ts`.
The server, the bench and training all import it.
Change it only together with `INPUT_FORMAT_VERSION`, and train a new release, because the server refuses a model trained on another format.

## Memory and speed

Measured on a Ryzen 9 9950X3D with `session.disable_prepacking=1` and 4 threads:

| Measure | Value |
|---|---|
| Memory after load | about 780 MiB |
| Peak | about 850 MiB |
| Per reply, p50 | 25 ms |
| Per reply, p95 | 37 ms |
| Load from a warm disk | 0.5 to 0.6 s |

The server starts the child on the first reply that needs it, stops it after 3 minutes idle, and skips the model for a poll when less than 1.2 GiB is free.
