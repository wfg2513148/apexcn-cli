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
