# Engineering Baseline

Scan time: 2026-07-05T10:48:45Z.

## Repository State

- Branch at scan start: `main`.
- Working branch for this iteration: `chore/post-018-hardening`.
- HEAD: `315bedcdc1e57abb1dea5fb6fd4833ebd6cdf032`.
- Last commit: `315bedc chore: harden v0.18 release quality gates`.
- Node: `v26.0.0`.
- npm: `11.18.0`.

## Version State

- Package version: `0.18.9`.
- README release links: `v0.18.9`.
- docs/quickstart release links: `v0.18.9`.
- Local latest tag: `v0.18.9`.
- GitHub latest release observed via `gh release view`: `v0.18.9`.

Version decision for this iteration: keep `0.18.9` because this is post-release hardening at the same `0.x` capability level, not a new feature release.

## Baseline Commands

- `npm ci`: passed; npm reported the existing `fsevents` install-script allow-scripts warning.
- `npm run build`: passed.
- `npm test`: passed, 31 test files and 528 tests.
- `npm run check:release`: passed for `0.18.9`.
- `npm run eval:rag`: passed in offline fixture mode with 30 questions and 30 expected references.
- `npm run test:e2e:readonly`: skipped safely because `APEXCN_API_KEY` is not set.

## Detected Capabilities

- `commands --json`: `schemaVersion: 1`, `manifestVersion: 2`.
- MCP commands detected: `mcp inspect`, `mcp serve`, `mcp tools`.
- Collection commands detected: `collection build`, `collection index`, `collection query`, `collection stats`, `collection verify`.
- RAG eval files detected: `eval/rag/questions.zh.jsonl`, `eval/rag/expected-references.jsonl`, `eval/rag/README.md`, `scripts/eval-rag.mjs`.

## Known Failures / Risks

- No baseline command failed.
- `test:e2e:readonly` requires a real read-only API key and is intentionally skipped when `APEXCN_API_KEY` is absent.
- Release assets include `checksums.txt`; post-release hardening uploads per-asset `.sha256` files as well.
- RAG eval is explicitly `offline-fixture`; it checks dataset/reference completeness and does not measure live answer correctness.
- Collection query uses BM25; post-release hardening verifies declared field weights are reflected in index term weights.
