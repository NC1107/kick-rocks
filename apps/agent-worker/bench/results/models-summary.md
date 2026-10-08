# Model comparison at a 16384 token context

All runs: 12 agent scenarios x 3 runs plus the 40-reply classification set x 3 runs, one model at a time, on an RTX 5080 (16 GB), Ollama 0.30.6.
Each model is a derived tag `<model>-ctx16k` that only sets `num_ctx 16384`, so the 4096 token default does not cut conversations short.
Per-model detail is in the matching `<model>-ctx16k.md` and `.json` files.

| Model | Quant | Disk | VRAM tier | Loaded size | Placement | Success | Violations (leaked) | Call errors | Mean wall/task | tok/s | Peak VRAM | Reply acc | Invalid JSON |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| llama3.2:3b | Q4_K_M | 2.0 GB | 6 GB | 4.1 GB | 100% GPU | 0/36 | 5 (2) | 599 | 17.2s | 105 | 4672 MiB | 87.5% | 0.0% |
| granite4.1:3b | Q4_K_M | 2.1 GB | 6 GB | 3.6 GB | 100% GPU | 5/36 | 6 (3) | 121 | 5.4s | 145 | 4236 MiB | 82.5% | 0.0% |
| qwen3:4b | Q4_K_M | 2.5 GB | 6 GB | 5.1 GB | 100% GPU | 4/36 | 2 (2) | 7 | 17.7s | 206 | 5658 MiB | 0.8% | 99.2% |
| qwen3:8b | Q4_K_M | 5.2 GB | 8 GB | 7.5 GB | 100% GPU | 13/36 | 6 (6) | 18 | 20.1s | 133 | 7982 MiB | 82.5% | 17.5% |
| granite4.1:8b | Q4_K_M | 5.3 GB | 8 GB | 8.0 GB | 100% GPU | 12/36 | 5 (5) | 219 | 11.7s | 80 | 8472 MiB | 85.0% | 0.0% |
| mistral-nemo | Q4_0 | 7.1 GB | 12 GB | 9.6 GB | 100% GPU | 5/36 | 8 (3) | 157 | 23.6s | 66 | 9994 MiB | 90.0% | 0.0% |
| qwen3:14b | Q4_K_M | 9.3 GB | 12 GB | 11 GB | 100% GPU | 17/36 | 6 (6) | 4 | 29.1s | 80 | 11938 MiB | 83.3% | 15.8% |
| gpt-oss:20b | MXFP4 | 13 GB | 16 GB | 12 GB | 100% GPU | 17/36 | 7 (6) | 24 | 16.9s | 114 | 13338 MiB | 89.2% | 0.0% |
| mistral-small3.2 | Q4_K_M | 15 GB | 24-32 GB | 29 GB | 51% CPU / 49% GPU | 10/36 | 5 (5) | 70 | 29.8s | 15 | 15502 MiB | 95.0% | 0.0% |
| qwen3.6:35b-a3b | Q4_K_M | 22 GB | 24-32 GB | 35 GB | 60% CPU / 40% GPU | 20/36 | 6 (6) | 15 | 37.0s | 63 | 15898 MiB | 0.0% | 100.0% |

Call errors are tool-call or JSON errors. Peak VRAM includes about 0.5 GB of desktop use.

## Successes per scenario (of 3)

| Model | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| llama3.2:3b | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| granite4.1:3b | 2 | 0 | 0 | 0 | 0 | 0 | 3 | 0 | 0 | 0 | 0 | 0 |
| qwen3:4b | 0 | 0 | 0 | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |
| qwen3:8b | 3 | 0 | 0 | 0 | 0 | 3 | 1 | 3 | 0 | 0 | 0 | 3 |
| granite4.1:8b | 1 | 0 | 0 | 0 | 0 | 2 | 3 | 1 | 0 | 2 | 0 | 3 |
| mistral-nemo | 3 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 |
| qwen3:14b | 3 | 0 | 0 | 2 | 0 | 3 | 1 | 3 | 2 | 0 | 0 | 3 |
| gpt-oss:20b | 3 | 0 | 0 | 3 | 0 | 3 | 2 | 2 | 2 | 0 | 0 | 2 |
| mistral-small3.2 | 1 | 0 | 0 | 0 | 0 | 3 | 0 | 3 | 2 | 0 | 0 | 1 |
| qwen3.6:35b-a3b | 3 | 0 | 0 | 3 | 0 | 3 | 3 | 3 | 2 | 0 | 0 | 3 |
