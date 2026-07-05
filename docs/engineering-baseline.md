# Engineering Baseline

Scan time: 2026-07-05T09:19:24Z.

## Repository State

- Branch at scan start: `main`.
- Working branch for this iteration: `chore/release-quality-hardening`.
- HEAD: `24d9462bce772b5222b203db6d9e4fa5da965edb`.
- Last commit: `24d9462 feat: add mcp adapter and contract governance`.
- Node: `v26.0.0`.
- npm: `11.18.0`.

## Version State

- Package version: `0.17.0`.
- README release links: `v0.17.0`.
- docs/quickstart release links: `v0.17.0`.
- Local latest tag: `v0.17.0`.
- GitHub latest release observed via `gh release list`: `v0.17.0`.

Version decision for this iteration: use `0.18.0` because `0.17.0` already exists remotely and this iteration adds release checksums, schema export, BM25 collection search, workflow policy/diff/audit foundations, and CI/reporting hardening.

## Baseline Commands

- `npm ci`: passed; npm reported the existing `fsevents` install-script allow-scripts warning.
- `npm run build`: passed.
- `npm test`: passed, 22 test files and 482 tests.
- `npm run check:release`: passed for `0.17.0`.
- `npm run eval:rag`: passed in baseline mode with 30 questions and 30 expected references.
- `npm run test:e2e:readonly`: skipped safely because `APEXCN_API_KEY` is not set.

## Detected Capabilities

- `commands --json`: `schemaVersion: 1`, `manifestVersion: 2`, 54 commands.
- MCP commands detected: `mcp inspect`, `mcp serve`, `mcp tools`.
- Collection commands detected: `collection build`, `collection index`, `collection query`, `collection verify`.
- RAG eval files detected: `eval/rag/questions.zh.jsonl`, `eval/rag/expected-references.jsonl`, `eval/rag/README.md`, `scripts/eval-rag.mjs`.

## Known Failures / Risks

- No baseline command failed.
- `test:e2e:readonly` requires a real read-only API key and is intentionally skipped when `APEXCN_API_KEY` is absent.
- Release assets currently include digests in GitHub metadata, but the repo does not yet generate/upload a first-class `checksums.txt`.
- RAG eval baseline reports dataset shape and placeholder quality metrics; it is not yet a strict answer-quality gate.
- Collection query is currently term-frequency based and should be upgraded to BM25.
