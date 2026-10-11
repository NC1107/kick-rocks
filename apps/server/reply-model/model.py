"""Trains, exports and serves the reply encoder.

train:  cross-validated out-of-fold logits on the dev replies fit one temperature, then a model is
        trained on all of dev. Nothing outside the dev items is read.
export: turns a trained model into the ONNX file the server runs and checks it against PyTorch.
logits: PyTorch logits for a list of texts, for comparing with another runtime.
serve:  answers one JSON line at a time with calibrated probabilities, for the bench.

Every setting that decides the result is in recipe.json. The default is fp32 on the CPU with a
fixed seed and thread count, which is what a release is built with. Results still differ a little
between CPUs, so a release is pinned by the digest of its files, not by being rebuilt.
"""

import argparse
import json
import math
import os
import platform
import random
import sys
import time
from pathlib import Path

import numpy as np
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

HERE = Path(__file__).resolve().parent
RECIPE = json.loads((HERE / "recipe.json").read_text())
BASE_ID = RECIPE["baseModel"]["id"]
BASE_REVISION = RECIPE["baseModel"]["revision"]


def configure(device_name: str, bf16: bool) -> torch.device:
    if device_name == "cuda" and not torch.cuda.is_available():
        raise SystemExit("CUDA is not available to this PyTorch build")
    torch.set_num_threads(RECIPE["threads"])
    torch.set_num_interop_threads(1)
    if device_name == "cuda":
        os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")
    torch.use_deterministic_algorithms(True, warn_only=device_name == "cuda")
    return torch.device(device_name)


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def encode(tokenizer, texts, max_len, device):
    batch = tokenizer(texts, truncation=True, max_length=max_len, padding=True, return_tensors="pt")
    return {key: value.to(device) for key, value in batch.items()}


def load(source, label_count=None, **kwargs):
    revision = {"revision": BASE_REVISION} if source == BASE_ID else {}
    tokenizer = AutoTokenizer.from_pretrained(source, **revision)
    extra = {"num_labels": label_count} if label_count else {}
    model = AutoModelForSequenceClassification.from_pretrained(source, **revision, **extra, **kwargs)
    return tokenizer, model


def train_model(texts, labels, label_count, args, device, seed):
    seed_everything(seed)
    tokenizer, model = load(BASE_ID, label_count)
    model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=RECIPE["learningRate"], weight_decay=0.01)
    steps = math.ceil(len(texts) / RECIPE["batchSize"]) * RECIPE["epochs"]
    scheduler = get_linear_schedule_with_warmup(optimizer, int(0.1 * steps), steps)
    order = list(range(len(texts)))
    model.train()
    for _ in range(RECIPE["epochs"]):
        random.shuffle(order)
        for start in range(0, len(order), RECIPE["batchSize"]):
            chosen = order[start : start + RECIPE["batchSize"]]
            batch = encode(tokenizer, [texts[i] for i in chosen], RECIPE["maxLen"], device)
            target = torch.tensor([labels[i] for i in chosen], device=device)
            with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=args.bf16):
                logits = model(**batch).logits
            loss = torch.nn.functional.cross_entropy(logits.float(), target)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()
    return tokenizer, model


@torch.no_grad()
def logits_for(tokenizer, model, texts, device, bf16=False, batch_size=16):
    model.eval()
    out = []
    for start in range(0, len(texts), batch_size):
        batch = encode(tokenizer, texts[start : start + batch_size], RECIPE["maxLen"], device)
        with torch.autocast(device_type=device.type, dtype=torch.bfloat16, enabled=bf16):
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


def library_versions():
    import onnx
    import onnxruntime
    import transformers

    return {
        "python": platform.python_version(),
        "torch": torch.__version__,
        "transformers": transformers.__version__,
        "numpy": np.__version__,
        "onnx": onnx.__version__,
        "onnxruntime": onnxruntime.__version__,
    }


def train(args):
    data = json.load(open(args.train))
    label_names = data["labels"]
    items = data["items"]
    if args.smoke:
        # Enough to exercise every step end to end; the result is not a usable model.
        RECIPE.update(folds=2, epochs=1)
        items = items[:24]
    texts = [item["text"] for item in items]
    labels = [label_names.index(item["label"]) for item in items]
    device = configure(args.device, args.bf16)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    folds = [list(range(i, len(texts), RECIPE["folds"])) for i in range(RECIPE["folds"])]
    oof = np.zeros((len(texts), len(label_names)), dtype=np.float32)
    for index, held in enumerate(folds):
        held_set = set(held)
        kept = [i for i in range(len(texts)) if i not in held_set]
        tokenizer, model = train_model(
            [texts[i] for i in kept], [labels[i] for i in kept], len(label_names), args, device, RECIPE["seed"] + index
        )
        oof[held] = logits_for(tokenizer, model, [texts[i] for i in held], device, args.bf16)
        print(f"fold {index + 1}/{RECIPE['folds']} done", file=sys.stderr, flush=True)
        del model
        if device.type == "cuda":
            torch.cuda.empty_cache()

    temperature = fit_temperature(oof, labels)
    oof_accuracy = float((oof.argmax(axis=1) == np.array(labels)).mean())
    tokenizer, model = train_model(texts, labels, len(label_names), args, device, RECIPE["seed"] + RECIPE["folds"])
    checkpoint = out / "checkpoint"
    model.save_pretrained(checkpoint)
    tokenizer.save_pretrained(checkpoint)
    json.dump(
        {
            "model": BASE_ID,
            "revision": BASE_REVISION,
            "labels": label_names,
            "temperature": temperature,
            "max_len": RECIPE["maxLen"],
            "libraries": library_versions(),
            "out_of_fold": {"accuracy": oof_accuracy, "logits": oof.tolist(), "truth": labels},
        },
        open(out / "calibration.json", "w"),
    )
    json.dump(json.load(open(out / "calibration.json")), open(checkpoint / "calibration.json", "w"))
    print(f"temperature {temperature:.3f}, out-of-fold accuracy {oof_accuracy:.3f}", file=sys.stderr)


def softmax(logits, temperature):
    scaled = logits / temperature
    shifted = np.exp(scaled - scaled.max(axis=-1, keepdims=True))
    return shifted / shifted.sum(axis=-1, keepdims=True)


def export(args):
    """Writes model.onnx and the tokenizer files, then compares the ONNX model with PyTorch."""
    import onnxruntime

    checkpoint = Path(args.checkpoint)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    calibration = json.load(open(checkpoint / "calibration.json"))
    tokenizer, model = load(str(checkpoint), attn_implementation="eager")
    model.eval()
    sample = tokenizer(["Subject: hello\n\nThank you for contacting us."], return_tensors="pt")
    torch.onnx.export(
        model,
        (sample["input_ids"], sample["attention_mask"]),
        str(out / "model.onnx"),
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "b", 1: "s"},
            "attention_mask": {0: "b", 1: "s"},
            "logits": {0: "b"},
        },
        opset_version=18,
        dynamo=False,
    )
    tokenizer.save_pretrained(out)
    for extra in ["special_tokens_map.json", "chat_template.jinja"]:
        (out / extra).unlink(missing_ok=True)

    texts = json.load(open(args.check))
    session = onnxruntime.InferenceSession(str(out / "model.onnx"), providers=["CPUExecutionProvider"])
    temperature = calibration["temperature"]
    worst = 0.0
    changed = 0
    device = torch.device("cpu")
    for start in range(0, len(texts), 8):
        chunk = texts[start : start + 8]
        torch_probs = softmax(logits_for(tokenizer, model, chunk, device, batch_size=1), temperature)
        for text, expected in zip(chunk, torch_probs):
            batch = tokenizer([text], truncation=True, max_length=RECIPE["maxLen"], return_tensors="np")
            ort_logits = session.run(
                ["logits"],
                {"input_ids": batch["input_ids"].astype(np.int64), "attention_mask": batch["attention_mask"].astype(np.int64)},
            )[0][0]
            got = softmax(ort_logits, temperature)
            worst = max(worst, float(np.abs(got - expected).max()))
            changed += int(got.argmax() != expected.argmax())
    json.dump({"texts": len(texts), "maxProbabilityDifference": worst, "changedAnswers": changed}, open(out / "parity.json", "w"))
    print(f"parity over {len(texts)} texts: max difference {worst:.2e}, changed answers {changed}", file=sys.stderr)
    if worst > 1e-4 or changed:
        raise SystemExit("The ONNX model does not match PyTorch to within 1e-4")


def logits(args):
    device = torch.device("cpu")
    tokenizer, model = load(args.checkpoint)
    texts = json.load(open(args.texts))
    json.dump(logits_for(tokenizer, model.to(device), texts, device, batch_size=1).tolist(), open(args.out, "w"))


def serve(args):
    device = configure(args.device, False)
    calibration = json.load(open(f"{args.model_dir}/calibration.json"))
    tokenizer, model = load(args.model_dir)
    model.to(device).eval()
    temperature = calibration["temperature"]

    def probabilities(text):
        return softmax(logits_for(tokenizer, model, [text], device)[0], temperature).tolist()

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
    t.add_argument("--train", required=True)
    t.add_argument("--out", required=True)
    t.add_argument("--device", default=RECIPE["device"])
    t.add_argument("--bf16", action="store_true", help="Mixed precision on the GPU, for the bench only. A release never uses it.")
    t.add_argument("--smoke", action="store_true", help="Two folds, one epoch, 24 replies: a check that the steps run.")
    e = sub.add_parser("export")
    e.add_argument("--checkpoint", required=True)
    e.add_argument("--out", required=True)
    e.add_argument("--check", required=True, help="A JSON list of texts to compare PyTorch and ONNX on.")
    g = sub.add_parser("logits")
    g.add_argument("--checkpoint", required=True)
    g.add_argument("--texts", required=True)
    g.add_argument("--out", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--model-dir", required=True)
    s.add_argument("--device", default="cpu")
    args = parser.parse_args()
    {"train": train, "export": export, "logits": logits, "serve": serve}[args.command](args)


if __name__ == "__main__":
    main()
