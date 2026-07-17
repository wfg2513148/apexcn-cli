# Live Readonly Retrieval Evaluation

This dataset is the milestone 0.3 live retrieval gate. It contains:

- 50 answerable Chinese community-knowledge questions.
- 10 deliberately unanswerable or unsafe questions.
- Every answerable question is derived from a real community topic and records its expected topic id.
- Top-5 retrieval passes only when the expected topic id is returned.
- Ask and research citation coverage separately requires user-visible source titles, snippets, tags, body text, or match evidence to contain the configured expected terms; a valid but unrelated URL does not pass.
- A declared `ask` or `research` path for each answerable question.

The runner never uses the default CLI profile. Supply an isolated dev config explicitly:

```bash
node scripts/eval-retrieval.mjs \
  --config /path/to/dev-config.json \
  --environment dev@oci \
  --report \
  --output reports/retrieval-eval.json
```

Use `--strict` only for milestone acceptance. It applies the thresholds documented in
`docs/rag-quality.md` and exits non-zero when any threshold fails.

The runner invokes only public readonly CLI commands: `auth audit`, `search`, `ask`, and
`research`. It removes inherited `APEXCN_API_KEY` from child processes and does not call
topic, reply, favorite, subscription, or workflow write operations.
