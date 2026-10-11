"""Serves a zero-shot NLI classifier for the reply classifier bench.

Reads one JSON object per line ({"text": ..., "hypotheses": [...]}) and answers with one
probability per hypothesis: a softmax over the entailment logits, as the usual zero-shot pipeline does.
"""

import argparse
import json
import sys
import time

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--max-len", type=int, default=512)
    args = parser.parse_args()

    device = torch.device(args.device)
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForSequenceClassification.from_pretrained(args.model).to(device).eval()
    entail = next(i for name, i in model.config.label2id.items() if name.lower().startswith("entail"))

    @torch.no_grad()
    def score(text, hypotheses):
        batch = tokenizer(
            [text] * len(hypotheses),
            hypotheses,
            truncation="only_first",
            max_length=args.max_len,
            padding=True,
            return_tensors="pt",
        ).to(device)
        logits = model(**batch).logits[:, entail].float().cpu().numpy()
        shifted = np.exp(logits - logits.max())
        return (shifted / shifted.sum()).tolist()

    score("warm up", ["warm up"])
    print(json.dumps({"ready": True, "device": str(device)}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        started = time.perf_counter()
        probs = score(request["text"], request["hypotheses"])
        print(json.dumps({"probabilities": probs, "ms": (time.perf_counter() - started) * 1000}), flush=True)


if __name__ == "__main__":
    main()
