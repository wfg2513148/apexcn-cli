# RAG Eval Baseline

This directory contains the first offline RAG evaluation baseline for `apexcn-cli`.

## Files

- `questions.zh.jsonl`: 30 Chinese evaluation questions.
- `expected-references.jsonl`: expected tag/reference metadata.
- `scripts/eval-rag.mjs`: validates the dataset and prints baseline metrics.

## Run

```bash
npm run eval:rag
```

The first version is intentionally offline. It validates dataset shape and reports coverage metrics that later online or collection-backed evaluators can extend.
