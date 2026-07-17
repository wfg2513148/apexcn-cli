# Agent Instructions

## Versioning Policy

- Iterations at the same capability level as the recent collection/auth governance/content quality/diagnostics upgrades count as `0.x` releases only.
- Routine daily iterations count as `0.0.x` patch releases only.
- Do not use `1.0.0` or higher unless the user explicitly redefines the product maturity threshold.

## Roadmap Execution Protocol

- At the start of every main implementation session, read `roadmap.json` and active `issues.json`.
- Build only a just-in-time plan for the current milestone from current code, evidence, and active issues. Do not pre-generate implementation plans for later milestones.
- Keep at most one milestone `in_progress`.
- Remove fixed issues from active `issues.json`; preserve first-attempt failures in independent validation history.
- Run one dedicated Codex goal for each roadmap milestone. The goal may end only after 100% of milestone acceptance, independent validation, issue closure, push, release, and context handoff are complete.
- Starting with milestone `0.4`, create a fresh user-visible Codex Desktop task for every milestone's main implementation goal. Its session `cwd` must be exactly `/Users/kwang/apexcn-cli`; never continue the next milestone in the predecessor task.
- When a milestone is complete, stop and briefly summarize enhanced capabilities, unexpected problems, root causes, prevention actions, and the next milestone's measurable goal and expected result.
- After that summary, release verification, and context compaction, automatically mark the predecessor completion review `approved`, activate the next planned milestone, and create its dedicated Codex goal. Do not wait for additional user confirmation.
- Run `npm run check:roadmap` after changing roadmap or issue state.

## Goal-Mode Patch Closure

- Every completed small-version goal-mode iteration must bump the patch version, pass local quality gates, commit, push `main`, push the release tag, and publish a GitHub Release.
- Do not activate GitHub Actions for this closure path. The release commit must end with `[skip ci]`, and the release must be created directly with `gh release create`; do not run `gh workflow run`.
- After release verification, run `npm run context:compact -- --summary <summary.json> --release-url <url>` to write `reports/iteration-context.json`.
- The compact summary must include enhanced capabilities, unexpected problems, root causes, prevention actions, the next milestone goal, expected results, and major risks.
- End the current goal after context compaction. The next main session must read `reports/iteration-context.json` when present, then re-read `roadmap.json` and `issues.json` before planning.

## Independent Validation Routing

- Independent CLI validation project: `/Users/kwang/Downloads/Works/66.Projects/apexcn-cli-test`
- Every validation round creates a fresh independent novice task thread in that project. Never reuse a prior validator thread; historical thread IDs are evidence only.
- The validator must be a user-visible Codex Desktop task whose session `cwd` is exactly the validation project above, so it appears under `apexcn-cli-test` in the sidebar. Hidden subagents do not satisfy this requirement.
- The main session dynamically assigns a structured scope contract from the active milestone and current risks. Every round runs the complete applicable fixed baseline suite plus a separately scored dynamic milestone/adverse suite.
- The scope contract records the tested CLI version, commit/tag/checksum, baseline dataset and scorer versions, environment hash, allowed public materials, prohibited actions, evidence format, and assigned scenarios.
- `issues.json` accepts actual validator findings only. Each issue must cite its fresh validator thread, assignment, scenario or exploration task, first-attempt evidence, actual output, expected user result, and responsibility assessment. Planning gaps belong in `roadmap.readinessRisks`.
- Validator model: `gpt-5.6-luna`, reasoning effort `high`
- ORDS API repository: `/Users/kwang/apexcn-forums`
- ORDS API thread: `019f2888-ef40-7b20-9af7-e4495f3a1091`
- Server model: `gpt-5.6-terra`, reasoning effort `high`
- Before accepting a delegated round, verify the new thread, working directory, novice persona, model, reasoning effort, tested commit/tag, artifact checksum, and scope contract.
- Every CLI write-back validation must include both backend/API evidence and visual recognition in the real Codex in-app browser. Review the rendered title, body, formatting, visibility/status, and end-user accessibility; a database-only success check is insufficient.
- Reuse the existing dedicated test account for write-back validation. Do not create a new account for each run; only maintain or replace it when it is unavailable or lacks the required minimum permissions.
- Route missing or incorrect ORDS REST API capability to the fixed server thread before adapting the CLI. Do not hide server gaps with CLI-only workarounds.
- A dedicated minimum-privilege apexcn forums API key may be created and used in `dev@oci` for required validation. Never commit it, print it, include it in evidence, or use it for production community writes.
