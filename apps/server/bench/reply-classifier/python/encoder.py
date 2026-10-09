"""Fine-tunes a small encoder on the dev replies and serves it for the reply classifier bench.

train: cross-validated out-of-fold logits on the dev split fit one temperature, then a model is
trained on all of dev and saved with that temperature. Nothing outside the dev items is read.
serve: reads one JSON object per line ({"text": ...}) and answers with calibrated probabilities.
"""

import argparse
import json
import math
import random
import sys
import time

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

SEED = 13


def pick_device(name: str) -> torch.device:
    if name == "cuda" and not torch.cuda.is_available():
        raise SystemExit("CUDA is not available to this PyTorch build")
    return torch.device(name)


def seed_everything() -> None:
    random.seed(SEED)
    np.random.seed(SEED)
    torch.manual_seed(SEED)
    torch.cuda.manual_seed_all(SEED)


def encode(tokenizer, texts, max_len, device):
    batch = tokenizer(texts, truncation=True, max_length=max_len, padding=True, return_tensors="pt")
    return {key: value.to(device) for key, value in batch.items()}


def train_model(model_name, texts, labels, label_count, args, device):
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModelForSequenceClassification.from_pretrained(model_name, num_labels=label_count)
    model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    steps = math.ceil(len(texts) / args.batch_size) * args.epochs
    scheduler = get_linear_schedule_with_warmup(optimizer, int(0.1 * steps), steps)
    order = list(range(len(texts)))
    model.train()
    for _ in range(args.epochs):
        random.shuffle(order)
        for start in range(0, len(order), args.batch_size):
            chosen = order[start : start + args.batch_size]
            batch = encode(tokenizer, [texts[i] for i in chosen], args.max_len, device)
            target = torch.tensor([labels[i] for i in chosen], device=device)
            with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=device.type == "cuda"):
                logits = model(**batch).logits
            loss = torch.nn.functional.cross_entropy(logits.float(), target)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()
    return tokenizer, model


@torch.no_grad()
def logits_for(tokenizer, model, texts, max_len, device, batch_size=16):
    model.eval()
    out = []
    for start in range(0, len(texts), batch_size):
        batch = encode(tokenizer, texts[start : start + batch_size], max_len, device)
        with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=device.type == "cuda"):
            out.append(model(**batch).logits.float().cpu())
    return torch.cat(out).numpy()


def fit_temperature(logits, labels):
    """The single scalar that minimises the negative log likelihood of the held-back logits."""
    tensor = torch.tensor(logits)
    target = torch.tensor(labels)
    log_t = torch.zeros(1, requires_grad=True)
    optimizer = torch.optim.LBFGS([log_t], lr=0.1, max_iter=200)

    def closure():
        optimizer.zero_grad()
        loss = torch.nn.functional.cross_entropy(tensor / log_t.exp(), target)
        loss.backward()
        return loss

    optimizer.step(closure)
    return float(log_t.exp().item())


def train(args):
    data = json.load(open(args.train))
    label_names = data["labels"]
    texts = [item["text"] for item in data["items"]]
    labels = [label_names.index(item["label"]) for item in data["items"]]
    device = pick_device(args.device)
    seed_everything()

    folds = [list(range(i, len(texts), args.folds)) for i in range(args.folds)]
    oof = np.zeros((len(texts), len(label_names)), dtype=np.float32)
    for index, held in enumerate(folds):
        kept = [i for i in range(len(texts)) if i not in set(held)]
        tokenizer, model = train_model(args.model, [texts[i] for i in kept], [labels[i] for i in kept], len(label_names), args, device)
        oof[held] = logits_for(tokenizer, model, [texts[i] for i in held], args.max_len, device)
        print(f"fold {index + 1}/{args.folds} done", file=sys.stderr, flush=True)
        del model
        torch.cuda.empty_cache()

    temperature = fit_temperature(oof, labels)
    oof_accuracy = float((oof.argmax(axis=1) == np.array(labels)).mean())
    tokenizer, model = train_model(args.model, texts, labels, len(label_names), args, device)
    model.save_pretrained(args.out)
    tokenizer.save_pretrained(args.out)
    json.dump(
        {
            "model": args.model,
            "labels": label_names,
            "temperature": temperature,
            "max_len": args.max_len,
            "out_of_fold": {
                "accuracy": oof_accuracy,
                "logits": oof.tolist(),
                "truth": labels,
            },
        },
        open(f"{args.out}/calibration.json", "w"),
    )
    print(f"temperature {temperature:.3f}, out-of-fold accuracy {oof_accuracy:.3f}", file=sys.stderr)


def serve(args):
    device = pick_device(args.device)
    calibration = json.load(open(f"{args.model_dir}/calibration.json"))
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir)
    model = AutoModelForSequenceClassification.from_pretrained(args.model_dir).to(device).eval()
    temperature = calibration["temperature"]
    max_len = calibration["max_len"]

    def probabilities(text):
        logits = logits_for(tokenizer, model, [text], max_len, device)[0] / temperature
        shifted = np.exp(logits - logits.max())
        return (shifted / shifted.sum()).tolist()

    probabilities("warm up")
    print(json.dumps({"ready": True, "labels": calibration["labels"], "device": str(device)}), flush=True)
    for line in sys.stdin:
        request = json.loads(line)
        started = time.perf_counter()
        probs = probabilities(request["text"])
        print(json.dumps({"probabilities": probs, "ms": (time.perf_counter() - started) * 1000}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    t = sub.add_parser("train")
    t.add_argument("--model", required=True)
    t.add_argument("--train", required=True)
    t.add_argument("--out", required=True)
    t.add_argument("--device", default="cuda")
    t.add_argument("--epochs", type=int, default=6)
    t.add_argument("--folds", type=int, default=5)
    t.add_argument("--batch-size", type=int, default=8)
    t.add_argument("--max-len", type=int, default=384)
    t.add_argument("--lr", type=float, default=3e-5)
    s = sub.add_parser("serve")
    s.add_argument("--model-dir", required=True)
    s.add_argument("--device", default="cpu")
    args = parser.parse_args()
    train(args) if args.command == "train" else serve(args)


if __name__ == "__main__":
    main()
