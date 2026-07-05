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

### P2

- Core service extraction should continue gradually without weakening CLI-first behavior.
- CredentialStore keychain support remains future optional work because native dependencies are out of scope.
- Upgrade/uninstall installer paths need dedicated user-facing tests.
