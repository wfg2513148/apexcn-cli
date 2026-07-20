# Collection qualification corpus

`real-topics.jsonl` is a sanitized readonly snapshot of the unique topic IDs cited by the frozen `M030-LIVE-ZH-2` retrieval evaluation. It keeps only public topic content and provenance fields. `oracle.jsonl` is derived from the same pre-existing answerable query set.

The 10,000-document benchmark deterministically combines those real records with unique synthetic records. The exact ratio, source hashes, scorer, environment hash, and integrity rules are recorded in `corpus-source.json`. Synthetic records are unique and are never repeated to inflate the corpus size.

Refresh the frozen inputs only as an explicit qualification action:

```bash
npm run build
node scripts/freeze-collection-corpus.mjs
```
