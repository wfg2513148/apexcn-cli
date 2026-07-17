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
- When a milestone is complete, stop and briefly summarize enhanced capabilities, unexpected problems, root causes, prevention actions, and the next milestone's measurable goal and expected result.
- Do not start the next milestone until the user gives explicit 手工确认 and the predecessor completion review is marked `approved`.
- Run `npm run check:roadmap` after changing roadmap or issue state.

## Fixed Validation Routing

- Independent CLI validation project: `/Users/kwang/Downloads/Works/66.Projects/apexcn-cli-test`
- Independent CLI validation thread: `019f6ed4-f811-7fd0-8111-241bb262c3ba`
- Validator model: `gpt-5.6-luna`, reasoning effort `high`
- ORDS API repository: `/Users/kwang/apexcn-forums`
- ORDS API thread: `019f2888-ef40-7b20-9af7-e4495f3a1091`
- Server model: `gpt-5.6-terra`, reasoning effort `high`
- Before accepting a delegated round, verify the target thread, working directory, model, reasoning effort, commit, and artifact checksum.
- Route missing or incorrect ORDS REST API capability to the fixed server thread before adapting the CLI. Do not hide server gaps with CLI-only workarounds.
- A dedicated minimum-privilege apexcn forums API key may be created and used in `dev@oci` for required validation. Never commit it, print it, include it in evidence, or use it for production community writes.
