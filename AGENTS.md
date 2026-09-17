# Agent Instructions

## Versioning Policy

- The product maturity threshold was explicitly redefined on 2026-07-21; `1.0.0` is the first formal release line.
- Backward-compatible routine iterations use `1.x` patch or minor releases according to semantic versioning.
- Do not use `2.0.0` or higher unless the user explicitly authorizes a breaking major release.

## Scope and source of truth

- Work on the requested change; preserve unrelated changes and keep CLI/server
  ownership separate. The CLI uses ORDS APIs, never a database/admin bypass.
- For code changes, use the relevant local checks and actual runtime evidence.
  Do not announce a release, validation pass or server capability without evidence.
- Read `roadmap.json` / `issues.json` when changing their state or executing a
  milestone. Ordinary local edits do not activate a milestone or imply a release.
- For roadmap milestones, formal release closure or capability extensions, read
  [docs/agent-roadmap-workflow.md](docs/agent-roadmap-workflow.md). It owns the
  detailed phase, version, independent validation and release protocol.
- Read [docs/validation-routing.md](docs/validation-routing.md) before assigning
  independent validation. Resolve and check the current project; never create a
  round in a missing historical directory or use the implementation task as its validator.
- Write-back acceptance requires backend/API evidence plus real Chrome inspection
  of the same record. Reuse the existing dedicated test account, retain first
  failures, and clean only created test data. Database-only checks are insufficient.
- Source secrets from the approved secure store. Do not print, commit or embed
  keys/credentials in arguments, logs, drafts or validation evidence; DEV test
  credentials do not authorize production community writes.
