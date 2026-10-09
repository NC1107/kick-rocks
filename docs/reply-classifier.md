# Classifying broker replies

This page says how Kick Rocks should classify the mail brokers send back, and why.
Every number comes from the bench in `apps/server/bench/reply-classifier`, and the reports are in its `results/` folder.
The bench has 332 dev replies and 224 held-out replies, all synthetic.
The machine was a Ryzen 9 9950X3D with 30 GiB RAM and an RTX 5080 with 16 GiB.

## The short answer

- Keep the rules first, with their current 0.6 threshold for their own answers.
- Fix the rules for the "Thank you for contacting us" reply that says to use a web form or phone, because no model ever sees it.
- For the replies the rules leave under 0.6, use the fine-tuned ModernBERT-base encoder (candidate c).
- Apply an encoder answer on its own only at confidence 0.96 or above, the threshold chosen on dev.
- Send every encoder answer below 0.96 to Review, with the encoder's label shown as a suggestion.
- Run the encoder on the CPU by default, with or without a GPU.
- Do not use a local LLM for replies once the encoder is in place.
- Do not wire in Jev or another hosted provider now.
  Run the bench against it first, which sends only synthetic text.

| Setup | Pipeline | Auto-apply | Review |
|---|---|---|---|
| No GPU | rules, then encoder on CPU | rules at 0.6 or above, encoder at 0.96 or above | everything else |
| GPU | the same, on CPU or GPU | the same | the same |
| Hosted provider | not recommended | n/a | n/a |

## Why the encoder

On held-out the encoder pipeline is the most accurate, at 70.1% accuracy and 80.8% macro F1.
The best LLM pipeline on held-out is granite4.1:8b label scoring at 68.8%, and the shipped LLM step reaches 63.8% to 67.4% across the six models run.
The rules alone get 50.0%.

The encoder is also the only candidate whose 95% precision threshold held from dev to held-out while covering a useful share of replies.
At 0.961 it kept 95.8% accuracy on 71 dev replies and 95.7% on 47 held-out replies.
The shipped LLM step never reaches 95% precision at any threshold, with any of the six models.
The NLI models and label scoring on llama3.2:3b and granite4.1:3b held 100%, but on 10 or fewer held-out replies.

On the CPU the encoder model call took 29 ms at p50 and 45 ms at p95, and on the GPU 5 ms and 6 ms.
Its answers were the same on both.
Mail is polled, so that difference does not matter, and a GPU buys nothing for this job.

On the reply-only part of held-out (the 66 tuning replies, without the mixed-inbox mail), granite4.1:8b label scoring got 83.3% and the encoder 78.8%.
That is 55 against 52 replies, which is within the noise of a set this small.
The granite4.1:8b runs were also slowed by another bench on the GPU, at a 9.9 s p95, so they say little about its speed.

## Why the threshold is 0.96 and not 0.6

Today the server applies any answer at 0.6 or above, and caps an LLM answer at 0.9.
The bench shows no LLM answer can be trusted at 95% precision at any confidence, so the 0.6 threshold on model answers applies labels with no measured precision.
The encoder's 0.96 is the only threshold here with evidence behind it.

Its evidence is thin.
45 right out of 47 gives a 95% confidence interval of about 86% to 99% for the precision.
So 0.96 is a reasonable starting point, not a proven 95%.
Each answer a person gives in Review is a label, and the threshold should be checked again once there are a few hundred real ones.

The 47 held-out replies at or above 0.961 include rules bounces at 0.97.
The rules predicted 9 bounces on held-out, so between 38 and 47 of the 62 replies the rules left unsure got an encoder answer above the threshold.
The report does not split them, so the exact share is not known.

Using the encoder means the server needs a separate threshold for model answers, without the 0.9 cap the LLM step has.

## Why the rules come first and what limits every model

The rules decide about 72% of held-out replies before any model sees them.
Of those 162, they got 102 right.
A model that was right about every reply the rules left under 0.6 would reach 73.2% on held-out and 72.0% on dev.
The encoder already reaches 70.1% and 69.9%.
So under rules first, any model, local or hosted, can add at most 7 held-out replies over the encoder.

The main error in every pipeline is mixed-inbox mail with no request behind it that the rules call `auto_ack` at 0.7 (43 of 224 held-out replies).
Production drops most of that mail before it is classified, because it matches no request, so the real error rate there is lower than the bench shows.
How much lower was not measured.

The rules also call 3 of the 5 "Thank you for contacting us" form-or-phone replies `auto_ack` at 0.85 or more.
That is the shape of the live `needs_form` case, and the model never sees those replies.
That fix belongs in the rules, made against dev and checked once against held-out.

## Signs of fitting

- Rules: 50.6% on dev and 50.0% on held-out.
- Encoder: 69.9% on dev, out of fold, and 70.1% on held-out, with the 0.961 threshold at 95.8% and 95.7%.
  On the reply-only part it got 79.8% and 78.8%.
  Nothing here suggests fitting.
- Shipped LLM step: dev and held-out stay within about one point of each other for every model.
- Label scoring: accuracy holds, but its thresholds do not.
  granite4.1:8b went from 97.3% on 37 dev replies to 90.6% on 32 held-out.
  qwen3:8b ran three times with the same dev result of 96.4% on 55, and held-out gave 95.6%, 93.5% and 91.5%.
  Its thresholds sit above 0.99999, where tiny run-to-run changes in the logprobs decide which replies pass.
  That is the threshold fitting dev, not the model.
- NLI: its 100% thresholds rest on 12 and 4 dev replies, too few to mean anything.

Two things weaken the held-out check for the encoder in particular.
14 held-out replies repeat a dev reply word for word, and the encoder was trained on dev, so it may have memorised them.
If all 14 were among the 47 above the threshold and all were right, the other 33 would be at 93.9%.
Whether they are was not recorded.
Held-out also comes from the same synthetic sources as dev, so it shows the encoder did not memorise dev, not that it handles real broker mail.

## The local LLM options

Across six local models, the shipped LLM step got 63.8% to 67.4% on held-out, and none reached a 95% threshold.
granite4.1:3b was the best of them at 67.4%, with a 386 ms p50 model call.
gpt-oss:20b got 65.2%, below the 3b models.
qwen3:8b got 67.0%, but its latency was inflated by another bench on the GPU, and its idle latency was not measured.

Label scoring answers in one token, in 74 to 139 ms on the 3b and 8b models.
It also found more `confirmation_link` replies, 94.1% recall against 58.8% for the shipped step.
Part of that gain may not survive production.
The bench applies a label-scoring answer as given, while the server turns a model's `confirmation_link` into `unknown` when the reply has no link on the request's own site.
Label scoring falls apart on qwen3:4b (58.9%) and gpt-oss:20b (46.0%, and never `unrelated`).

So a GPU gives no measured reason to use an LLM for replies over the encoder.
If someone keeps the LLM step anyway, its answers should go to Review rather than be applied at 0.6.

This differs from [agent-models.md](agent-models.md), which calls reply classification reasonable to run unattended with any reply model in its table.
That page used 40 replies, and this bench used 556 and measured precision by confidence, so its reply advice should be revisited.

## A hosted provider such as Jev

Jev was not measured, because `TYPESAFE_API_KEY` was not set.
Only its request shape is covered, by tests.

Here is what the bench and TypeSafe's launch post say.

- The most Jev could add under rules first is 7 held-out replies over the encoder, as shown above.
- TypeSafe claims Jev is calibrated ("higher confidence means higher accuracy"), but the post gives no calibration figure and no accuracy figure.
- The post claims 70 to 500 ms end to end, measured from the US West Coast, and input costs $0.042 per million tokens.
  At about 500 tokens a reply, the whole bench is under 300,000 tokens, about a cent.
- The post says nothing about how long request data is kept or what it is used for, and links a privacy policy instead.
  Jev is in early access, and there are no open weights and no self-hosting.
- A reply sent to Jev would carry the broker's text, which usually names the person and their email address, and often more.
  Kick Rocks is self-hosted so that this data stays with the person.

So Jev is not worth wiring in now.
The bench is the safe way to find out more, because its data is synthetic.
Run `TYPESAFE_API_KEY=... pnpm bench:replies --candidates rules,e-jev` and compare it with the encoder.
Jev would be worth reconsidering only if all of these hold:

- Its dev-chosen 95% threshold holds on held-out, as the encoder's did, and covers clearly more replies.
- TypeSafe states in writing that it does not keep or train on request data.
- It is off by default and opt-in per profile, with a plain warning that reply text leaves the machine.
- It only sees the replies the rules and the encoder leave under their thresholds.
- The person's name, email and address are removed from the text before it is sent.
  That removal does not exist yet, and how much it would cost in accuracy was not measured.

## What was not measured

- Jev, or any other hosted model.
- Real broker mail.
  All of it is synthetic, and some classes are small on held-out (10 `needs_form`, 9 `rejected`, 17 `confirmation_link`).
- The production checks the bench skips: routing a reply to its request, sender trust caps, and the link check on `confirmation_link` for candidates b, c and d.
- Accuracy by confidence for the reply-only part, since the reports only split accuracy by source.
- The encoder inside the server.
  The bench runs it from Python with PyTorch, so a Node runtime for it, its memory use and its cold start were not measured.
- Encoder latency on a smaller CPU, such as a NAS or a mini PC.
- How much the encoder's results vary between training runs, since every run reused one cached model.
- Training the encoder on more data, or on dev and held-out together.
  Doing that would leave no held-out set, so a new one would be needed first.
- The model judging replies the rules already decided, and any mix of the encoder and an LLM.
- Idle-GPU latency for qwen3:8b and gpt-oss:20b, and larger models such as qwen3:14b, which were not run on this bench.
