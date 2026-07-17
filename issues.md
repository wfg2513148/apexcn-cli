# Issues

## Active Backlog

### P0

- Release/tag/assets consistency checks must stay green for every `0.x` release.
- Installer checksum verification must remain mandatory unless users explicitly set `APEXCN_CLI_SKIP_CHECKSUM=1`.

### P1

- MCP stdio compatibility requires continued smoke coverage across readonly and preview-only modes.
- JSON schema and fixture contract coverage should expand as public JSON outputs grow.
- Workflow policy/diff/audit-log should continue moving from MVP checks toward full governance coverage.
- Collection BM25 query quality needs real corpus regression fixtures.
- RAG eval report artifacts should remain visible in CI.
- Add readonly API-backed commands when server support exists for station notifications/inbox, community rules, and privacy policy.
- Add a one-step favorites-to-collection flow after the API contract for favorite topic export is stable.
- Add curated novice views for learning path, version compatibility, and deployment checklist content; current fallback remains `search`/`research`.

### P2

- Core service extraction should continue gradually without weakening CLI-first behavior.
- CredentialStore keychain support remains future optional work because native dependencies are out of scope.
- Upgrade/uninstall installer paths need dedicated user-facing tests.
- Draft inventory management (`draft list` or `me drafts`) needs a local draft storage decision before implementation.

## Recently Closed

- Retry novice audit: `review topic` now accepts novice-friendly inline `--content` for local review.
- Retry novice audit: empty `search` output now includes fallback suggestions and related commands.
- Retry novice audit: `doctor --check-ask` timeout results now include retry and bounded `search`/`research` fallback guidance.
- Retry novice audit: `me --redact --json` provides privacy-safe account output for logs and audit reports.
- Retry novice audit: MCP execute-write refusal now states that real writes are intentionally unavailable through MCP and should use CLI workflow.
