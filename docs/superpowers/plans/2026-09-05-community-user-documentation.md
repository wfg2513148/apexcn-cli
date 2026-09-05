# Community User Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the community-user documentation accurate, approachable, and directly usable with the current CLI.

**Architecture:** Treat the built CLI help and command manifest as the command contract. Keep README focused on first success, user guides focused on AI-assisted community workflows, and terminal manuals focused on copyable commands and failure recovery.

**Tech Stack:** Markdown, Node.js, Commander CLI, Vitest.

## Global Constraints

- Do not include real API keys, user data, or authentication headers in documentation or examples.
- Preserve English and Chinese parity for user-facing setup and common read/write workflows.
- Keep the default setup path `apexcn auth set-token <token>` on the default production profile.
- Document destructive and write actions as preview-and-confirm workflows.
- Verify command shapes against `node dist/index.js` after `npm run build`.

---

### Task 1: Align First-Time Setup

**Files:**
- Modify: `README.md`
- Modify: `docs/user-guide.zh.md`
- Modify: `docs/user-guide.en.md`
- Modify: `docs/cli-manual.zh.md`
- Modify: `docs/cli-manual.en.md`

**Interfaces:**
- Consumes: `apexcn auth --help` and `apexcn auth set-token --help`.
- Produces: A consistent shortest setup command and a security-preserving environment-variable alternative.

- [x] Replace deprecated shortest-setup examples with `apexcn auth set-token "YOUR_API_KEY"`.
- [x] State that the short command selects `prod` and the official ORDS API address.
- [x] Retain the environment-variable method for shared devices and explain that it avoids saving the key value in CLI configuration.
- [x] Keep placeholder text explicit and prohibit copying it as a real key.

### Task 2: Clarify Community Workflows

**Files:**
- Modify: `README.md`
- Modify: `docs/user-guide.zh.md`
- Modify: `docs/user-guide.en.md`

**Interfaces:**
- Consumes: `topic recent`, `search`, `topic view`, `ask`, and workflow safety behavior.
- Produces: User prompts and command examples that lead from discovery to reading, drafting, preview, and confirmation.

- [x] Add a direct terminal path for recent topics using `apexcn topic recent --since-hours 168 --page-size 10 --json`.
- [x] Explain that no-keyword community browsing uses `topic recent`, not an empty search query.
- [x] Explain that content-changing actions are previewed and require confirmation; do not present previews as publication.
- [x] Retain source-link expectations and distinguish community URLs from original external URLs.

### Task 3: Make Troubleshooting Actionable

**Files:**
- Modify: `README.md`
- Modify: `docs/user-guide.zh.md`
- Modify: `docs/user-guide.en.md`
- Modify: `docs/cli-manual.zh.md`
- Modify: `docs/cli-manual.en.md`

**Interfaces:**
- Consumes: `apexcn doctor --json`, `apexcn auth audit --json`, and 401 remediation.
- Produces: A small ordered recovery path that avoids exposing credentials.

- [x] Use `auth audit` for local credential/profile diagnosis and `doctor --json` for API reachability checks.
- [x] State that a rejected token must be replaced with `apexcn auth set-token "NEW_API_KEY"` and then verified.
- [x] Preserve the distinction between API authentication and browser login.

### Task 4: Validate Documentation Against the CLI

**Files:**
- Test: `test/auth.test.ts`
- Test: `test/index.test.ts`

**Interfaces:**
- Consumes: Built `dist/index.js` help output and project quality gates.
- Produces: Evidence that documented setup and recent-topic command shapes remain valid.

- [x] Run `npm run build`.
- [x] Execute the documented help and read-only command shapes with a temporary configuration; do not use a real API key.
- [x] Run `npm test`, `npm run check:release`, and `git diff --check`.
- [x] Record any validation limitation without claiming an unrun online check: no live community read was needed for documentation command-shape validation.
