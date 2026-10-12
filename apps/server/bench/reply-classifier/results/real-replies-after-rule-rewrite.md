# Reply classifier on real replies

Run 2026-10-11T20:00:06.666Z on AMD Ryzen 9 9950X3D 16-Core Processor (32 threads), 30 GiB RAM, NVIDIA GeForce RTX 5080 16 GiB.
161 labeled replies (verification_required 12, auto_ack 11, completed 28, rejected 29, needs_form 35, no_record 28, confirmation_link 3, unknown 15); ambiguous ones are left out.

- Models: none; thinking on.
- rules: The rules alone, with the name gate as on this branch.

Recall cells are hits over support. Applied is what the server would act on without a person, Applied wrong how many of those disagree with the label, and Review everything else.

## The request carries the company name

Each reply comes from the company's own domain with no thread headers, so only the sender ties it to the open request.

| Approach | Accuracy | Macro F1 | needs_form | confirmation_link | verification_required | completed | auto_ack | Applied | Applied wrong | Review |
|---|---|---|---|---|---|---|---|---|---|---|
| rules | 51.6% | 49.0% | 16/35 | 0/3 | 6/12 | 17/28 | 2/11 | 12 | 0 | 149 |

## The request does not carry the company name

The same replies, tied to the request by their sender alone, but the request is for a different company. The name gate holds any reply that does not name the request's target.

| Approach | Accuracy | Macro F1 | needs_form | confirmation_link | verification_required | completed | auto_ack | Applied | Applied wrong | Review |
|---|---|---|---|---|---|---|---|---|---|---|
| rules | 51.6% | 49.0% | 16/35 | 0/3 | 6/12 | 17/28 | 2/11 | 0 | 0 | 161 |

