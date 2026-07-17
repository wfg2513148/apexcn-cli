# apexcn-cli Product Roadmap Design

## Status

- Design date: 2026-07-17
- Design status: approved in conversation
- Baseline release: `0.18.18`
- Product maturity target: `0.90.x` GA candidate
- Version policy: remain in `0.x`; routine iterations use patch versions

## Product Positioning

`apexcn-cli` is the local AI Agent operating layer for the APEX Chinese
community, a community knowledge CLI, and an auditable content workflow
engine.

The product serves three user groups:

| User | Primary need |
|---|---|
| Terminal user | Search, read, ask, manage personal community data, and safely publish content |
| Script and CI user | Stable JSON, schemas, exit codes, deterministic artifacts, and release guarantees |
| AI Agent | Structured readonly access and preview-only write planning under explicit safety policy |

CLI remains the primary product. MCP remains a local stdio thin adapter.
Real write execution remains governed by CLI workflow approval. Remote HTTP
MCP and MCP execute-write are outside this roadmap.

## Version Model

The user-facing maturity stages map to real release lines as follows:

| Product stage | Release line | Theme |
|---|---|---|
| `0.2` | `0.20.x` | Trustworthy novice CLI |
| `0.3` | `0.30.x` | Community knowledge retrieval |
| `0.4` | `0.40.x` | Personal community workbench |
| `0.5` | `0.50.x` | Auditable content operations |
| `0.6` | `0.60.x` | AI Agent standard adapter |
| `0.7` | `0.70.x` | Local knowledge assets and automation |
| `0.8` | `0.80.x` | Organizational governance and operations |
| `0.9` | `0.90.x` | GA candidate |

The current `0.18.x` line is the pre-roadmap baseline. Moving to product
stage `0.2` therefore means moving forward to `0.20.x`, not downgrading to a
literal `0.2.x` package version.

## Roadmap Artifacts

The roadmap uses three synchronized artifacts:

1. `/roadmap.json` is the machine-readable source of truth.
2. `/issues.json` contains unresolved defects and capability gaps only.
3. `/docs/roadmap.md` is the human-readable projection.

The Markdown document must not carry independent status or acceptance data.
Every milestone, capability, metric, and state shown in Markdown must be
derived from or checked against `roadmap.json`.

Each main implementation task reads the current `roadmap.json` and
`issues.json` before deciding what to do. It creates a just-in-time execution
plan for the current task only. The repository does not keep speculative
implementation plans for future milestones because actual validation findings
and server dependencies may change the required work.

### Roadmap Schema

`roadmap.json` uses `schemaVersion: 1` and contains:

```text
schemaVersion
product
baselineRelease
versionPolicy
testingBindings
statusDefinitions
milestones[]
```

Each milestone contains:

```text
id
releaseLine
title
objective
status
capabilities[]
acceptanceCriteria[]
validatorScenarios[]
dependencies[]
evidence[]
activationGate
completionReview
```

Each capability contains:

```text
id
title
userValue
scope[]
nonGoals[]
dependencies[]
status
acceptanceCriterionIds[]
validatorScenarioIds[]
evidenceIds[]
```

Each acceptance criterion contains:

```text
id
gate
description
metric
comparator
target
unit
measurementMethod
status
evidenceIds[]
```

`gate` is either `core` or `supporting`. All criteria listed in the milestone
definitions below are `core`. A core gate cannot be waived.

### Status Models

Milestone status:

```text
planned | in_progress | blocked | completed
```

Capability status:

```text
not_started | partial | implemented | validated
```

Acceptance status:

```text
pending | pass | fail
```

State transitions follow these rules:

- A capability may become `partial` or `implemented` from repository evidence.
- Only the independent validator may move a capability to `validated`.
- A milestone becomes `completed` only when every core criterion is `pass`,
  every required capability is `validated`, and active P0/P1 issues are zero.
- A failed first black-box attempt remains in immutable evidence. Repair
  revalidation closes the issue but does not rewrite the first-attempt result.
- A blocked milestone must record a blocking issue, its owner, and its recovery
  condition.
- A later milestone cannot become `in_progress` until the preceding
  milestone's `completionReview.status` is `approved`.

Completion review status:

```text
not_due | pending | approved | changes_requested
```

When a milestone first reaches `completed`, its completion review becomes
`pending` and the main task must stop. It presents a concise handoff containing:

1. capabilities added or materially strengthened;
2. problems that were not anticipated before implementation;
3. root causes and concrete prevention actions;
4. the next milestone's objective;
5. measurable expected results and major risks.

Only an explicit user confirmation may change the completion review to
`approved`. An agent must not infer approval from silence or from automated
test success.

Every completed goal-mode patch iteration also has a release closure:

1. Bump the patch version and pass all local quality gates.
2. Commit with a message ending in `[skip ci]`.
3. Push `main` and the release tag.
4. Create the GitHub Release directly with `gh release create`.
5. Do not activate GitHub Actions or run `gh workflow run`.
6. Verify the published tag, assets, checksums, and release URL.
7. Write a compact durable handoff to `reports/iteration-context.json`.
8. End the current goal so the next goal starts from the compact handoff,
   `roadmap.json`, and `issues.json`.

The Codex runtime does not expose a repository-callable API that can mutate the
platform's current context window on demand. The required durable handoff is
therefore the enforceable compaction boundary: it is size-limited, verified
after release, and is the first context source for the next main task.

## Testing And Feedback Architecture

### Fixed Execution Bindings

| Role | Project or repository | Codex thread | Model | Reasoning |
|---|---|---|---|---|
| CLI builder | `/Users/kwang/apexcn-cli` | Current implementation task | Current builder model | Current task setting |
| Independent validator | `/Users/kwang/Downloads/Works/66.Projects/apexcn-cli-test` | `019f6ed4-f811-7fd0-8111-241bb262c3ba` | `gpt-5.6-luna` | `high` |
| ORDS REST API server | `/Users/kwang/apexcn-forums` | `019f2888-ef40-7b20-9af7-e4495f3a1091` | `gpt-5.6-terra` | `high` |

No replacement validator project or thread may be created unless the user
explicitly changes this binding.

Real API validation may create and use a dedicated apexcn forums API key in the
`dev@oci` environment. The key must use the minimum required permissions,
must never be committed or included in logs, fixtures, `issues.json`, roadmap
evidence, doctor output, or support bundles, and must be rotated or revoked
when the validation policy requires it. Production community writes remain
prohibited.

Every CLI write-back scenario requires two evidence layers: API or database
evidence that the mutation persisted, and visual recognition in the real Codex
in-app browser from the end-user perspective. The browser review must inspect
the rendered title, body, formatting, visibility/status, accessibility, and a
screenshot. Backend-only verification is insufficient. The validator reuses
the existing dedicated test account instead of creating a new account per run;
credentials remain outside the repository and evidence artifacts.

### Execution Handshake

Before a validation or server round starts, the target task must report:

```json
{
  "threadId": "...",
  "cwd": "...",
  "model": "...",
  "reasoningEffort": "high",
  "gitSha": "...",
  "artifactSha256": "..."
}
```

The validator must report `gpt-5.6-luna`; the server task must report
`gpt-5.6-terra`. A model, reasoning, thread, working-directory, commit, or
artifact mismatch blocks the round. Evidence from a mismatched round is not
accepted.

### Validation Flow

1. The builder produces an immutable package or release artifact and checksum.
2. The validator installs and exercises only the public `apexcn` interface.
3. The validator uses natural-language tasks, records first-attempt outcomes,
   and writes active defects to `issues.json`.
4. The builder classifies root ownership before changing code.
5. CLI defects are fixed in `apexcn-cli`.
6. Missing or incorrect ORDS REST API capability is fixed in
   `apexcn-forums`, released with an updated API contract, and then integrated
   by the CLI.
7. The same validator task re-runs the affected scenario and the relevant
   regression set.
8. A fixed issue is removed from active `issues.json`; its first failure and
   closure evidence remain in immutable validation history.
9. After all milestone exit gates pass, the main task produces the required
   concise completion review and stops for explicit user approval.

### Issue Ownership

Every issue uses one owner:

```text
cli | server | cross_repo | test_environment | external
```

Server and cross-repository issues additionally record:

```text
rootCauseStatus
serverThreadId
serverCommit
apiContractVersion
cliCommit
validatorRound
```

A server-owned issue closes only after:

1. The fixed server task implements the API correction.
2. OpenAPI, API release notes, and contract fixtures are updated.
3. A live or isolated real readonly/write-test API request passes as
   applicable.
4. `apexcn-cli` adapts to the released contract.
5. The independent validator passes the original natural-language scenario.
6. The issue is removed from active `issues.json`.

CLI-only fallback behavior must not conceal a missing server capability.

## Milestone Definitions

## Stage 0.2: Trustworthy Novice CLI

Release line: `0.20.x`

Objective: a first-time user can install, authenticate, discover commands,
diagnose failures, and complete core readonly tasks without knowing the
implementation.

Capabilities:

- Versionless one-command installation, checksums, upgrade guidance, and
  cross-platform installer checks.
- Stable command manifest, JSON Schema, exit codes, and error envelope.
- Authentication profiles, doctor diagnostics, and recursive secret
  redaction.
- Actionable empty-result, permission, rate-limit, timeout, and server-error
  guidance.
- Builder, validator, `issues.json`, and immutable evidence workflow.

Core acceptance criteria:

- Public command registry coverage is 100%.
- Public JSON command contract-test coverage is 100%.
- `401`, `403`, `404`, `409`, `429`, `5xx`, network, and timeout failures
  produce stable and actionable output.
- Secret leakage across CLI, JSON, doctor, MCP, workflow, logs, and fixtures
  is zero.
- macOS/Linux installation tests and PowerShell static installation gates pass.
- At least 60 L0/L1 natural-language first-attempt tasks pass at a rate of at
  least 95%.
- Active P0 and P1 issues are zero.

## Stage 0.3: Community Knowledge Retrieval

Release line: `0.30.x`

Objective: users can reliably discover, retrieve, summarize, and cite current
community knowledge.

Capabilities:

- Unified search, filters, cursor pagination, recent topics, and topic detail.
- `ask` and `research` with traceable references, freshness, filters, and
  confidence signals.
- Real readonly API retrieval evaluation in addition to offline fixture
  integrity checks.
- Low-confidence refusal and query-narrowing guidance.

Core acceptance criteria:

- The Chinese retrieval evaluation set contains at least 50 questions.
- Top-5 expected-reference hit rate is at least 85%.
- Citation coverage is at least 90%.
- At least 10 intentionally unanswerable questions receive a correct
  limitation or refusal response in 100% of cases.
- Five consecutive cursor pages contain no duplicate or missing records.
- Search latency is at most 5 seconds at P95; `ask` and `research` latency is
  at most 15 seconds at P95 under the recorded reference environment.
- At least 40 independent natural-language retrieval tasks have a
  first-attempt success rate of at least 90%.
- Every result contains a real URL, request ID when supplied by the server,
  and provenance.

## Stage 0.4: Personal Community Workbench

Release line: `0.40.x`

Objective: authenticated users can manage their own community activity and
knowledge without profile confusion or privacy leakage.

Capabilities:

- Unified profile, topics, replies, favorites, subscriptions, and statistics.
- Notifications, inbox, community rules, and privacy controls when supported
  by explicit server contracts.
- Favorites-to-collection, saved queries, and personal digest generation.
- Profile isolation and redacted output.
- Preview for reversible personal write actions.

Core acceptance criteria:

- Personal list pagination contains no duplicate or missing records.
- Three configured profiles remain fully isolated in credentials, cache,
  output, and actions.
- Secret and private-field leakage is zero.
- Favorite-to-collection conversion preserves content, URL, and topic ID in
  100% of cases.
- Missing server capabilities return an explicit unavailable result and never
  fabricated data.
- At least 30 natural-language personal-workbench tasks have a first-attempt
  success rate of at least 95%.
- Every reversible action preview matches the eventual approved request.

## Stage 0.5: Auditable Content Operations

Release line: `0.50.x`

Objective: authorized users can prepare and execute content changes through a
recoverable, hash-bound, auditable workflow.

Capabilities:

- Topic and reply create, update, and delete.
- Draft and review checks for content quality, privacy, and secrets.
- Workflow plan, run, approve, verify, diff, audit, and export.
- Hash-bound approval, expiry, policy, recovery, and idempotence.
- Isolated write-test environment or category; production writes are excluded
  from automated testing.

Core acceptance criteria:

- At least 20 complete write-workflow first-attempt samples pass.
- Preview, approval, and execute request hashes match in 100% of successful
  executions.
- Missing confirmation, expired approval, mutated content, and insufficient
  permission are blocked in 100% of cases.
- Delete-confirmation bypasses are zero.
- Resume and retry behavior creates no duplicate write.
- `401`, `409`, `429`, and timeout recovery never creates an uncertain
  duplicate write.
- Secret leakage is zero.
- Test-resource cleanup leaves zero residual resources.
- Active P0 and P1 issues are zero.

## Stage 0.6: AI Agent Standard Adapter

Release line: `0.60.x`

Objective: AI clients can discover and use community capabilities through a
predictable, safe, local stdio adapter.

Capabilities:

- Readonly and preview-only MCP tools with execute-write permanently disabled
  for this roadmap.
- Shared core services, HTTP client, safety policy, redaction, and schemas
  between CLI and MCP.
- Verified compatibility records for Claude Desktop, Cursor, and VS Code Agent.
- Stable MCP startup, inspection, tool manifest, JSON-RPC errors, and protocol
  behavior.

Core acceptance criteria:

- All intentionally exposed readonly commands map to a shared-core MCP tool.
- Readonly and preview-only modes issue zero real write requests.
- Every preview-only response contains `willExecute: false`.
- Claude Desktop, Cursor, and VS Code Agent each have dated evidence recording
  client version, configuration, scenarios, and outcome.
- One hundred consecutive JSON-RPC calls complete without protocol failure.
- At least 40 natural-language Agent tasks have a first-attempt success rate
  of at least 95%.
- MCP startup latency is at most 2 seconds at P95 in the recorded reference
  environment.
- Secret leakage is zero.

## Stage 0.7: Local Knowledge Assets And Automation

Release line: `0.70.x`

Objective: users can build reproducible local knowledge assets and automate
readonly knowledge workflows without unattended writes.

Capabilities:

- Incremental collection sync, deduplication, integrity checks, provenance,
  and staleness tracking.
- Offline search, versioned import/export, and reproducible knowledge bundles.
- Readonly scheduled digests and automation plans.
- Explicit prevention of unattended real writes.

Core acceptance criteria:

- A 10,000-document collection indexes in at most 5 minutes in the recorded
  reference environment.
- Query latency is at most 500 milliseconds at P95 for that collection.
- Reindexing a 1% document change takes no more than 20% of full-index time.
- Top-10 expected-reference hit rate is at least 90% on the local benchmark.
- Duplicate and missing documents are zero after sync.
- Identical canonical inputs produce identical content hashes.
- Export, verify, import, and restore preserve 100% of documents and
  provenance.
- At least 50 natural-language offline tasks have a first-attempt success rate
  of at least 95%.
- Offline mode makes zero network requests; automation makes zero unattended
  write requests.

## Stage 0.8: Organizational Governance And Operations

Release line: `0.80.x`

Objective: teams can govern policy, credentials, compatibility, audit, support,
and lifecycle operations across supported platforms.

Capabilities:

- Policy packs, approval levels, audit retention, and tamper-evident evidence.
- Server capability negotiation and CLI/API compatibility matrix.
- Cross-platform credential-store strategy, support bundles, observability,
  installation, upgrade, rollback, and uninstall.
- Root-owner routing between CLI and ORDS REST API work.

Core acceptance criteria:

- Policy allow and deny matrix tests are 100% correct.
- Required audit-event completeness and tamper detection are 100%.
- The current and two preceding supported API contract versions pass the
  compatibility suite.
- Installation, upgrade, rollback, and uninstall pass on supported macOS,
  Linux, and Windows environments.
- Ten thousand redaction and secret-fuzz cases produce zero leaks.
- Seeded CLI, server, cross-repository, test-environment, and external defects
  are classified and routed with 100% accuracy.
- A seven-day readonly soak reaches at least 99.5% successful operations and
  records all failed operations with actionable diagnostics.

## Stage 0.9: GA Candidate

Release line: `0.90.x`

Objective: freeze the supported public surface and prove release, upgrade,
security, reliability, recovery, and documentation readiness for a later GA
decision.

Capabilities:

- Public CLI, JSON, MCP, workflow, and API compatibility freeze.
- Migration, deprecation, rollback, disaster recovery, and support policy.
- Release supply-chain evidence including checksums, SBOM, and provenance.
- Independent black-box qualification and real-user beta evidence.

Core acceptance criteria:

- Active P0 and P1 issues are zero.
- At least 200 cross-persona natural-language tasks have a first-attempt
  success rate of at least 97%.
- Public command contract and scenario coverage are 100%.
- Upgrade from every supported roadmap release line to `0.90.x` succeeds in
  100% of tested paths.
- Release checksums, SBOM, and provenance verify for 100% of release assets.
- The current supported versions of Claude Desktop, Cursor, and VS Code Agent
  are revalidated.
- Isolated write-workflow tests pass in 100% of cases and leave zero residual
  test resources.
- A 30-day qualification soak passes the documented reliability target.
- Independent security review has no unresolved critical or high-severity
  findings.
- Recovery and rollback exercises pass in 100% of documented scenarios.

## Measurement And Evidence

Every `pass` acceptance criterion references immutable evidence such as:

- test report path and SHA-256;
- command and exit code;
- source commit and package checksum;
- validator round and scenario IDs;
- server commit and API contract version when applicable;
- environment record for performance and compatibility measurements.

Performance claims are invalid without a recorded CPU, memory, operating
system, Node version, dataset hash, sample count, warm-up policy, and percentile
calculation.

Natural-language first-attempt success means the first submitted instruction
completes the intended user outcome without hidden manual command correction.
Follow-up clarification requested by the product counts as success only when
the scenario explicitly tests an ambiguity that should require clarification.

## Error Handling And Recovery

- Invalid roadmap state fails validation with a path-specific error.
- Evidence missing for a `pass` criterion changes validation to failure.
- Model or thread mismatch blocks the corresponding validation round.
- Missing server capability creates a server or cross-repository issue instead
  of fabricated CLI output.
- A failed server dependency records the blocking API contract and resumes only
  after server release evidence exists.
- Test-environment failures remain distinct from product failures and require
  environment recovery followed by a fresh first-attempt round.
- Active `issues.json` contains unresolved issues only. Closed issue evidence is
  append-only and remains available for regression and first-attempt metrics.

## Validation Tooling

The initial implementation adds:

- `roadmap.json`;
- `issues.json`;
- a generated or consistency-checked `docs/roadmap.md`;
- a lightweight Node validator with no production dependency;
- Vitest contract tests for schema, IDs, status transitions, core gates,
  evidence requirements, version mapping, and documentation parity;
- a package script that CI and release checks can run.

The validator must reject:

- duplicate milestone, capability, criterion, scenario, or evidence IDs;
- product-stage/release-line mapping errors;
- unknown dependency or evidence references;
- unsupported status values;
- `completed` milestones with incomplete capabilities, failed/pending core
  gates, missing evidence, or active P0/P1 issues;
- `validated` capabilities without independent-validator evidence;
- model or fixed-thread binding drift;
- a later `in_progress` milestone whose predecessor lacks explicit completion
  review approval;
- Markdown milestones, themes, or status values that differ from
  `roadmap.json`.

## Non-Goals

- No `1.0.0` release is implied by this roadmap.
- No MCP execute-write or remote HTTP MCP server.
- No automated production community write tests.
- No CLI-only workaround for a missing ORDS REST API contract.
- No claim that offline RAG fixture evaluation measures live answer quality.
- No claim of client compatibility without dated real-client evidence.
- No mandatory native dependency for local indexing.
- No automatic implementation of all stages in one change.

## Delivery Boundaries

This design delivers the roadmap contract and governance mechanism. Each
milestone is implemented in a separate goal cycle:

1. Audit the repository and prior milestone evidence.
2. Read current `roadmap.json` and unresolved `issues.json`.
3. Select the next incomplete milestone only and create an in-session,
   just-in-time plan based on current evidence.
4. Implement and run repository quality gates.
5. Hand the immutable artifact to the fixed independent validator.
6. Route server dependencies through the fixed server task when required.
7. Revalidate until all expected issues are resolved.
8. Mark the milestone complete only after its exit gates pass.
9. Summarize capabilities, unexpected problems, prevention actions, and the
   next milestone's measurable target.
10. Stop until the user explicitly approves starting the next milestone.

Later milestones must be replanned from the actual validated state left by the
previous milestone. The roadmap defines outcomes and gates; it does not
pre-author speculative implementation plans for future milestones.
