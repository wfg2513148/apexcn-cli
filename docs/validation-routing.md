# Independent validation routing

The execution address is `roadmap.json.testingBindings.validator.project`.
`issues.json.sourcePolicy.validatorProject` must agree. A `null` address with
`projectStatus: unconfigured` means no usable independent project is currently
configured; it is not permission to skip validation.

The previous project `/Users/kwang/Downloads/Works/66.Projects/apexcn-cli-test`
was absent when inspected on 2026-09-06. Preserve its historical evidence paths.
Do not recreate an empty directory and call it a recovered harness.

Before a real validation round:

1. Resolve a suitable existing independent project from the saved project list or
   a user-specified location. It must be separate from the builder repository and
   contain the required baseline/scorer/harness. Do not use an unrelated project.
2. Record the chosen absolute path in both current binding fields and set
   `projectStatus` to `configured`; keep previousProject as history. Model and
   reasoning settings remain in testingBindings, rather than repeated in AGENTS.
3. Run `node scripts/check-roadmap.mjs --validator-readiness`. This checks local
   routing/directory readiness only. Verify the baseline/scorer versions and
   frozen candidate contract before issuing the actual assignment.
4. Use a fresh independent novice, user-visible task with the exact resolved cwd,
   preserve first-attempt results, and follow agent-roadmap-workflow.md. Create a
   user-visible task only when the user explicitly requested a new task or has
   already authorized creating these validation tasks. Selecting a workflow alone
   is not task-creation authorization; if it is absent, pause only that dispatch.

If no valid harness can be located, report the missing harness as a validation
blocker. Continue independent source/document work, but do not mark release or
independent validation complete. Routine `check:roadmap` verifies structural
consistency; it is not live validator-readiness evidence.

## Candidate and acceptance binding

Validate the version and SHA-256 of the exact archive before running it. Read
the current contract and dataset from that archive, not a hard-coded historical
release directory. The current release contract's cwd must match the configured
validator project; published historical contracts remain unchanged.

Report scoped regression acceptance separately from full qualification. Passing
version, HTTP 555, HTTP 503 and response-timeout scenarios proves those scenarios
only. Full qualification requires evidence for every assigned baseline and dynamic
scenario, plus applicable API, Chrome and cleanup checks. Missing, failed or
unexecuted evidence must remain blocked or failed, never become a pass merely by
changing an acceptance flag. Preserve first-attempt results when rerunning.
