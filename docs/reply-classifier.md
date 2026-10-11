# Classifying broker replies

This page says how Kick Rocks should classify the mail brokers send back, and why.
Every number comes from the bench in `apps/server/bench/reply-classifier`, and the reports are in its `results/` folder.
The bench has 332 dev replies and 224 held-out replies, all synthetic.
The machine was a Ryzen 9 9950X3D with 30 GiB RAM and an RTX 5080 with 16 GiB.

## What real replies changed

Everything below this section was measured on synthetic replies.
Real replies were then scored with `pnpm bench:replies --corpus <dir>`, on 161 labeled replies from public sources.
95 of them come from one requester's log, and many are excerpts, so the set is small and uneven.
Some labels are debatable, so the counts below show direction more than exact rates.

The synthetic numbers did not transfer.

- The rules applied 77 of the 161 replies without a person, and 25 of those were wrong.
  That is 67.5% precision, with a 95% lower bound of 56.5%.
  The other 84 went to Review.
- The encoder (the published reply-model-v1 release, applied at the 0.9 floor) applied 97 and got 32 wrong.
  Its 20 extra applications over the rules were 13 right and 7 wrong.
  Its 95.7% on synthetic held-out did not hold on real mail.
- The acknowledgement rule was the worst.
  It applied 14 replies and got 11 wrong, and its "thank you for" part was right on 1 of 24.
  An applied acknowledgement is filed as noise, so those mistakes were also hidden from the person.
- No rule had enough applications to prove 95% precision.
  Only three rules were right every time they decided: the one for email not being accepted (4 of 4), the one for requests that must go through another channel (4 of 4), and the one for "has been removed" wording (4 of 4), counting the replies that name the request's company.
  Together that is 12 of 12, with a 95% lower bound of about 76%.
  Alone, their lower bounds are about 51%, 57% and 57%.

So the server now follows these rules.

- A rule's answer is applied without a person only when the rule is in `PROVEN_RULES` in `apps/server/src/mail/reply-rules.ts`.
  The list is empty.
  Three rules were right every time they decided on the real replies, but on 4 of 4 each, which gives 95% lower bounds of 51% to 57%, and 12 of 12 pooled is about 76%.
  All 12 came from one source folder, and several alternatives inside those rules never fired on real mail.
  That is not support for a 95% claim, so every wording rule suggests until fresh inbox mail gives about 60 correct decisions per rule.
- Every wording rule answer is therefore a suggestion.
  The reply goes to Review with the rules' label preselected, and nothing moves the request.
- Every model answer, from the encoder or the language model, is a suggestion too.
  No threshold was ever measured to give a model the precision that moving a request needs.
  The settings card shows "Suggestions only", and the model threshold, spot check and pause settings are gone because nothing is applied.
- The rules also hold their own answer for Review when two different decisions fire in one reply.
- The name gate and the trust caps are unchanged.
  A reading that moves a request still needs a signature that vouches for it.
- Two readings come from message headers and still apply behind those trust caps: a delivery status report, and an automatic reply that a mail server marked as machine-sent (an out-of-office notice with `Auto-Submitted`, or a delay notice inside a delivery report).
  They are listed in `STRUCTURAL_READINGS`.
  An out-of-office subject without a machine header, and a delay notice recognized only by its subject, are wording and go to Review.
- A confirmation link is applied only for a request that is waiting for one, which the form flow sets when it submits a form that promised a confirmation email.
  Its wording was never measured on real mail, because the real replies carry no links.
  For any other request the same reading is a suggestion.
  It is listed in `WAITING_READINGS`.
- The reply encoder stays off by default.
  The release pin in `apps/server/reply-model/release.json` is empty, so the image does not bundle a model, and a model that is installed only suggests.

The rest of the rules were rewritten against the misreads in the real set.

- The acknowledgement rule no longer reads "thank you for", "within N days" or the start of "email address".
- The identity rule asks for a document or for the person to verify their identity, with a negation check.
  It no longer reads a description of a portal or of other people.
- Conditions are read across a sentence, so "if you submit a copy of your ID" and "if you do not fall into these cases, your request is complete" no longer count.
- A request or a route outranks a missing or refused record that comes with it.
  A finished request outranks a missing one.
- A request that was "processed" is no longer read as done, because it means handled and not succeeded: "processed and denied" is a refusal, and the refusal wording now covers any state in "not a ... resident".
That cost one completed reply on the real set (17 to 16 of 28 right as the top label).
A redirect that ends at a bare preposition, keeps email as the channel, or points at a link that only explains an authorization is no longer read as a redirect.
The condition check also ignores "in case" followed by a ticket or case number.
The "has been removed" rule read only the clause for a negation before; it now uses the full sentence check like the other rules, so its wording handling changed after it was measured.
New wording is read for doing it yourself in your account, for a company that processed or complied with the request, for being unable to delete, to take action, or to act as a processor, and for a company that generally holds no personal data.

Those rewritten rules were 56 right out of 56 suggestions on the same replies before the last round of fixes.
That is fitted to the replies, so it does not count as proof, and it has not been re-counted since.
They stay suggestions until fresh mail measures them.

| Real replies, rules alone | Applied | Applied wrong | Review |
|---|---|---|---|
| Before | 77 | 25 | 84 |
| After | 0 | 0 | 161 |

With no rule on the proven list the rules apply 0 of the 161 real replies, so all 161 go to Review.
The intake loop (`pnpm loop:mail-intake`, dev corpus) stores 134 messages about a request, and Review shows 73 of them before and 112 after.
So 61 were handled without a person before, and 22 are now.
The loop still shows no false positives, false negatives, stored ignored mail or misrouted mail.
It counts 38 correct readings that now wait in Review, and 0 that waited for no reason.
The test pins that count at 38, so a change that sends more correctly read mail to Review has to change the test on purpose.

Growing the set from the product's own inbox, where headers and signatures are real, is how a rule gets onto the list.
A rule should show at least 95% precision on fresh mail, with about 60 correct applications in a row for a 95% lower bound, before it joins `PROVEN_RULES`.

## The short answer (synthetic bench)

This is what the synthetic bench said.
The real replies above overrule the parts about applying answers.

- Keep the rules first.
- Fix the rules for the "Thank you for contacting us" reply that says to use a web form or phone, because no model ever sees it.
- For the replies the rules leave under 0.6, use the fine-tuned ModernBERT-base encoder (candidate c).
- Send every encoder answer to Review, with the encoder's label shown as a suggestion.
  The synthetic bench chose 0.96 as the confidence to apply one on its own, and real mail did not support it.
- Run the encoder on the CPU by default, with or without a GPU.
- Do not use a local LLM for replies once the encoder is in place.
- Do not wire in Jev or another hosted provider now.
  Run the bench against it first, which sends only synthetic text.

| Setup | Pipeline | Auto-apply | Review |
|---|---|---|---|
| No GPU | rules, then encoder on CPU | proven rules only | everything else |
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

This section is the reasoning on the synthetic bench, and the server no longer applies model answers at all.
Before real replies, the server applied any answer at 0.6 or above, and caps an LLM answer at 0.9.
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
- Encoder latency on a smaller CPU, such as a NAS or a mini PC.
- How much the encoder's results vary between training runs, since every run reused one cached model.
- Training the encoder on more data, or on dev and held-out together.
  Doing that would leave no held-out set, so a new one would be needed first.
- The model judging replies the rules already decided, and any mix of the encoder and an LLM.
- Idle-GPU latency for qwen3:8b and gpt-oss:20b, and larger models such as qwen3:14b, which were not run on this bench.

## How it ships

The server runs the encoder as an ONNX model in fp32 through `onnxruntime-node`, in a child process that starts on the first reply that needs it and exits after three minutes idle.
Int8 was measured and changed 4 to 6% of the answers, so it would need its own threshold from its own out-of-fold answers before it could ship.
The recipe, the pinned inputs and the release steps are in `apps/server/reply-model/README.md`.

Measured through the server's host on a Ryzen 9 9950X3D with 4 threads:

- The child holds about 780 MiB after loading, with the runtime's prepacking off.
- The first answer takes about 1 second including the load, and later answers about 20 ms.
- The PyTorch and ONNX answers agree to within 2.2e-6 on 556 texts with no answer changed.

The runtime carries Microsoft's usage telemetry on Linux, so the child is started with `ORT_DISABLE_TELEMETRY=1` and the image sets it too.

Model answers, from the encoder or the language model, are never applied.
They reach Review as a suggestion with the label preselected.
The earlier rule, applying at the larger of 0.90, the manifest's threshold and the person's setting, was dropped after real replies.
