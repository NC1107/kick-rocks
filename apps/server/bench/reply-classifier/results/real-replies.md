# Reply classifier on real replies

Run 2026-10-11T18:55:05.383Z on AMD Ryzen 9 9950X3D 16-Core Processor (32 threads), 30 GiB RAM, NVIDIA GeForce RTX 5080 16 GiB.
161 labeled replies (verification_required 12, auto_ack 11, completed 28, rejected 29, needs_form 35, no_record 28, confirmation_link 3, unknown 15); ambiguous ones are left out.

- Models: gpt-oss:20b, qwen3:8b; thinking off.
- rules: The rules alone, with the name gate as on this branch.
- rules + encoder: Rules, then the published reply-model-v1 release (ModernBERT-base, ONNX, threshold 0.621, applied at the 0.9 floor) through the server's own runtime.
- rules + current prompt, gpt-oss:20b: Rules, then the language model step as this branch ships it.
- rules + current prompt, qwen3:8b: Rules, then the language model step as this branch ships it.
- rules + tuned prompt, gpt-oss:20b: Rules, then the language model step with the system prompt of kr3/agent-tuning.
- rules + tuned prompt, qwen3:8b: Rules, then the language model step with the system prompt of kr3/agent-tuning.

Recall cells are hits over support. Applied is what the server would act on without a person, Applied wrong how many of those disagree with the label, and Review everything else.

## The request carries the company name

Each reply comes from the company's own domain with no thread headers, so only the sender ties it to the open request.

| Approach | Accuracy | Macro F1 | needs_form | confirmation_link | verification_required | completed | auto_ack | Applied | Applied wrong | Review |
|---|---|---|---|---|---|---|---|---|---|---|
| rules | 41.6% | 37.6% | 12/35 | 0/3 | 5/12 | 12/28 | 3/11 | 77 | 25 | 84 |
| rules + encoder | 46.6% | 37.9% | 16/35 | 0/3 | 7/12 | 16/28 | 4/11 | 97 | 32 | 64 |
| rules + current prompt, gpt-oss:20b | 62.7% | 53.8% | 24/35 | 0/3 | 7/12 | 21/28 | 9/11 | 77 | 25 | 84 |
| rules + current prompt, qwen3:8b | 60.2% | 50.9% | 21/35 | 0/3 | 6/12 | 19/28 | 4/11 | 77 | 25 | 84 |
| rules + tuned prompt, gpt-oss:20b | 64.6% | 55.8% | 22/35 | 0/3 | 8/12 | 21/28 | 8/11 | 77 | 25 | 84 |
| rules + tuned prompt, qwen3:8b | 60.9% | 51.5% | 18/35 | 0/3 | 6/12 | 20/28 | 4/11 | 77 | 25 | 84 |

## The request does not carry the company name

The same replies, tied to the request by their sender alone, but the request is for a different company. The name gate holds any reply that does not name the request's target.

| Approach | Accuracy | Macro F1 | needs_form | confirmation_link | verification_required | completed | auto_ack | Applied | Applied wrong | Review |
|---|---|---|---|---|---|---|---|---|---|---|
| rules | 41.6% | 37.6% | 12/35 | 0/3 | 5/12 | 12/28 | 3/11 | 0 | 0 | 161 |
| rules + encoder | 35.4% | 29.7% | 13/35 | 0/3 | 9/12 | 9/28 | 2/11 | 0 | 0 | 161 |
| rules + current prompt, gpt-oss:20b | 69.6% | 60.1% | 29/35 | 0/3 | 10/12 | 26/28 | 8/11 | 0 | 0 | 161 |
| rules + current prompt, qwen3:8b | 65.2% | 55.0% | 24/35 | 0/3 | 7/12 | 23/28 | 3/11 | 0 | 0 | 161 |
| rules + tuned prompt, gpt-oss:20b | 68.3% | 60.2% | 24/35 | 0/3 | 12/12 | 26/28 | 7/11 | 0 | 0 | 161 |
| rules + tuned prompt, qwen3:8b | 66.5% | 57.0% | 21/35 | 0/3 | 7/12 | 24/28 | 4/11 | 0 | 0 | 161 |

## Reading the table

- The language model never applies anything, so its Applied, Applied wrong and Review columns are the rules'.
  Its accuracy is that of the label a person sees: the rules' answer where they applied it, otherwise the model's suggestion.
- gpt-oss:20b ignores `reasoning_effort: none` on Ollama and keeps a short reasoning pass, so its thinking is lowered, not off.
  qwen3:8b has thinking off.
- The encoder row added 20 applications over the rules (97 against 77), 7 of them wrong.
