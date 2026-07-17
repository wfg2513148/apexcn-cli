# Engineering Baseline

Scan time: 2026-07-17T07:25:36Z.

## Repository State

- Branch at scan start: `main`.
- Working branch for this iteration: `main`.
- HEAD: `6bd7806af6bd484ae887ea1800d864676aab40be`.
- Last commit: `6bd7806 docs: define staged apexcn-cli product roadmap`.
- Node: `v26.0.0`.
- npm: `12.0.0`.

## Version State

- Package version: `0.18.18`.
- README install links: `releases/latest/download`.
- docs/quickstart install links: `releases/latest/download`.
- Local latest tag: `v0.18.18`.
- GitHub latest release: `v0.18.18`.

This validation covers unreleased novice-experience improvements. Version selection remains a release-time decision under the `0.0.x` routine-iteration policy.

## Baseline Commands

- `npm ci`: passed; npm reported the existing `fsevents` install-script allow-scripts warning.
- `npm run build`: passed.
- `npm test`: passed, 36 test files and 564 tests.
- `npm run check:release`: passed for `0.18.18`.
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
- npm 12 changed `npm pack --json` from an array to an object keyed by package name; release checks now normalize both response shapes.
