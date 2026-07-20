# apexcn-cli Terminal Manual

This manual is for users running commands directly in a terminal. Examples assume the CLI is installed and authenticated.

## Global

```bash
apexcn --help
apexcn --version
apexcn help search
apexcn commands --json
apexcn --config /tmp/apexcn-config.json auth show --json
```

Use `--json` in scripts and AI-agent workflows. Use root `--config <path>` or `APEXCN_CONFIG_PATH` when automation needs an isolated config file.

When an AI agent needs available commands, aliases, purposes, safety metadata, safe examples, and options, prefer `apexcn commands --json` instead of parsing `--help` text. The current structured manifest contract is `schemaVersion === 1`; if it is missing or unsupported, do not consume structured `safety` or `examples`, and upgrade the CLI or ask the user before continuing. In the manifest, `schema` lists available enum values, `safety.effects` describes command effects, `safety.preview` describes whether preview is available or required, `safety.confirmation` lists explicit confirmation flags, and `examples[].mode` separates read, preview, and execute examples. Additive `manifestVersion === 2` metadata includes `jsonContract`; JSON-capable commands point to their success schema, stable error schema, and contract test, while unsupported commands return `null`.

For unstable networks, set `APEXCN_HTTP_TIMEOUT_MS` to provide a default timeout for community API requests. `doctor --timeout-ms` overrides this default. Blank or non-positive values are ignored.

When scripts need parseable failures, prefer passing `--json` to the command. JSON-capable commands write Commander argument parsing, validation, config, network, and API errors as one-line JSON to stderr. You can also set `APEXCN_ERROR_FORMAT=json` to force structured errors; default output remains human-readable text.

## guide

Curated local task paths for novices. These commands do not read auth, call the API, deploy applications, or write community content:

```bash
apexcn guide learning --json
apexcn guide compatibility --apex-version 24.2 --ords-version 24.4 --json
apexcn guide deployment --format text
apexcn guide security --json
apexcn guide performance --json
```

Compatibility and deployment guides explicitly require verification against official Oracle documentation and the target environment; they are not compatibility certifications.

## auth

Save an API key:

```bash
apexcn auth set-token \
  --profile agent-prod \
  --base-url https://oracleapex.cn/ords/api \
  --token "$APEXCN_API_KEY"

apexcn auth set-token \
  --profile agent-env \
  --base-url https://oracleapex.cn/ords/api \
  --token-env APEXCN_API_KEY
```

The installer never accepts or configures an API key. Run these authentication commands only as a separate step after installation succeeds.

`--token-env <name>` stores only the environment variable name. Pass both `--token-env` and `--token` to use the environment credential first and the file credential as fallback. Invalid or missing environment credentials fall back to the file store; if neither backend supplies a usable token, API commands fail before making a request. Tokens must contain visible ASCII characters only, must not contain whitespace, and must not be example placeholders such as `YOUR_API_KEY`. `--base-url` must be an absolute `http` or `https` URL.
Add `--no-switch` when you want to save a profile without making it current.

Show current profile:

```bash
apexcn auth show
apexcn auth show --json
apexcn auth audit --json
apexcn auth list
apexcn auth list --json
apexcn auth use agent-prod
apexcn auth remove old-profile
```

`auth audit` is a local-only configuration audit and does not call the API. It prints `auth-audit` and checks the active profile, profile references, base URLs, tokens, HTTP profiles, and duplicate base URLs. Full tokens are never printed.

Log out:

```bash
apexcn auth logout
```

## me

Show current account:

```bash
apexcn me
apexcn me --json
apexcn me --json --redact
apexcn me --verbose --json
apexcn me --format text
```

`--redact` masks the account email for logs, audits, and support bundles.

## doctor

Check install, auth, and API reachability:

```bash
apexcn doctor
apexcn doctor --json
apexcn doctor --format json
apexcn doctor --format text
apexcn doctor snapshot --json
apexcn doctor snapshot --output ./support-snapshot.json --json
apexcn doctor --check-ask "How do I call a REST API from Oracle APEX?" --json
apexcn doctor --timeout-ms 10000 --json
```

`doctor` defaults to text output. `--format json` prints compact JSON; `--json` and `--format pretty` print pretty JSON. JSON output includes diagnostics such as CLI version, user agent, config path, Node.js version, platform, and architecture. By default it checks only the profile, account, categories, and search. It checks the RAG ask endpoint only when you explicitly pass `--check-ask <question>`. `--timeout-ms` sets a per-check request timeout in milliseconds.

`doctor snapshot` is a local-only support snapshot and does not call the community API. It reads the config file directly and outputs `kind: "doctor-snapshot"`, `schemaVersion: 1`, `diagnostics`, `environment`, `config`, `agentSkill`, and stable `checks[].code` values. Hard issue codes include `config-unreadable`, `config-invalid-json`, `no-active-profile`, `missing-current-profile`, `invalid-base-url`, and `invalid-timeout-env`; warning codes include `api-key-env-missing`, `missing-token`, and `agent-skill-missing`. Environment variables are reported only as present/valid, and tokens are reported only as presence plus redacted length. `--output <file>` writes the same sanitized snapshot with user-only permissions.

## category

List categories:

```bash
apexcn category list
apexcn category list --json
apexcn category list --format text
```

## stats

Read aggregate statistic endpoints. Since 0.4.0-candidate, they support date windows and top-list sizing:

```bash
apexcn stats category --json
apexcn stats category --from 2026-07-01 --to 2026-07-05 --json
apexcn stats topic --json
apexcn stats topic --tag "ORDS" --from 2026-07-01 --top 10 --json
apexcn stats tag --format text
apexcn stats tag --from 2026-07-01 --top 20 --json
```

`stats category` returns topic, reply, and featured-topic counts per category. `stats topic` returns global or exact-tag-filtered topic counts, and includes `tagCounts` when `--tag` is not provided. `stats tag` returns exact tag usage counts.

## admin

Read the public admin directory:

```bash
apexcn admin list --json
apexcn admin list --format text
```

`admin list` returns only server-approved public admin fields and public contact entries; private contact data is not exposed.

## me activity

Read aggregate statistics and activity lists for the current account:

```bash
apexcn me stats --json
apexcn me capabilities --json
apexcn me capabilities --require-capability personal-community favorite-topic-export --json
apexcn me notifications --json
apexcn me inbox --json
apexcn me rules --json
apexcn me privacy --json
apexcn me topics --page-size 10 --json
apexcn me replies --page-size 10 --cursor "<page.nextCursor>" --json
apexcn me favorites --format text
apexcn me subscriptions --json
```

`me` recursively redacts email, phone, IP, address, and secret-like fields by default. Only explicit `me --include-private` prints private account fields returned by the server. `me topics`, `me replies`, `me favorites`, and `me subscriptions` should continue with the server's opaque `page.nextCursor`. Numeric `offset/page.nextOffset` remains available for older servers, but `--cursor` and `--offset` cannot be combined.

`me capabilities` reads the server `contractVersion` and capability inventory, then adds `clientCompatibility`. 0.80.x accepts only the declared 0.8, 0.7, and 0.6 candidate contract window; malformed, newer, or older contracts fail closed. The current 0.8 contract must advertise that full supported window. `--require-capability <ids...>` also exits nonzero when any requested capability is unavailable. `me notifications`, `me inbox`, `me rules`, and `me privacy` only relay authoritative readonly contracts. When a capability is missing, the CLI preserves `available: false`, `status: "UNAVAILABLE"`, `unavailableReason`, and `requestId`; it never fabricates empty messages, rules, or policy content.

## search

Basic search:

```bash
apexcn search "Oracle APEX" --json
apexcn search "Oracle APEX" --format text
apexcn search "ORDS" --tags APEX,ORDS --has-useful-reply --source-type external --json
```

Limit result count:

```bash
apexcn search "REST API" --page-size 5 --json
```

Search within a category:

```bash
apexcn search "performance" --category-id 4 --json
```

List topics with server-side filters:

```bash
apexcn topic list --view unanswered --page-size 20 --json
apexcn topic list --source-domain example.com --sort updated --json
```

`search` and `topic list` support server-side filters: `--tag`, `--tags`, `--author`, `--author-id`, `--source-domain`, `--original-url`, `--content-type`, `--source-type`, `--status`, `--view`, `--sort`, `--featured`, `--pinned`, `--locked`, `--unanswered`, `--has-useful-reply`, `--from/--to`, `--from-date/--to-date`, `--category-id`, `--page-size`, `--cursor`, and `--offset`. Prefer `page.nextCursor` for pagination; keep `--offset` only for compatibility.

```bash
apexcn search "ORDS" --category-id 4 --page-size 10 --json
```

Search by updated date range:

```bash
apexcn search "JSON" --from-date 2026-01-01 --to-date 2026-12-31 --json
apexcn search "ApexLang" --page-size 5 --cursor "next-cursor" --json
```

`--page-size` accepts 1 to 50. Common variants `ApexLang`, `APEXLang`, and `APEX Lang` are normalized to `ApexLang` before searching; JSON output includes `query.normalizedKeyword` when normalization happens. `--cursor` uses the backend `page.nextCursor` and is the preferred pagination contract starting with 0.2.0-candidate; `--offset` remains available for compatibility. Backend `createdDate` is the original topic creation timestamp, and `updatedDate` is the latest update timestamp. Narrow large result sets with `--category-id`, `--from-date`, and `--to-date`.

When a search returns no rows, JSON output includes `emptyResult`, and text output suggests broader keywords, removing filters, and trying `search`, `research`, or `topic recent`.

## topic recent

Read recently updated topics:

```bash
apexcn topic recent --json
apexcn topic recent --since-hours 48 --page-size 10 --json
apexcn topic recent --category-id 4 --from-date 2026-07-01 --to-date 2026-07-04 --cursor "next-cursor" --format text
```

`topic recent` is read-only and defaults to topics updated in the last 48 hours. It prefers the 0.2.0-candidate `GET /api/v1/topics` endpoint, whose items should include `createdDate` and `updatedDate`. If the runtime server has not promoted that endpoint yet, the command falls back to wildcard search and topic detail fetches to preserve fields such as `createdDate`, `originalUrl`, `tags`, and `viewCount` where possible. JSON output contains `kind: "topic-recent"`, `source`, `query`, `items`, `page`, `requestIds`, and `errors`. When `page.hasMore` is true, pass `page.nextCursor` back with `--cursor`.

## research

Search and fetch the top topics in one read-only research bundle for AI-agent summarization and citation:

```bash
apexcn research "REST API" --limit 3 --json
apexcn research "ORDS" --category-id 4 --from-date 2026-01-01 --format text
```

`--limit` accepts 1 to 10 and defaults to 3. JSON output always contains `query`, `searchAttempts`, `items`, `topics`, `links`, `requestIds`, `provenance`, and `errors`. When the original natural-language phrase returns no results, the command makes at most three readonly retries using explainable technical keywords; `query.attemptedKeywords`, `query.selectedKeyword`, and `searchAttempts` preserve each query and request ID. `links` are deduplicated by topic id or URL and preserve `createdDate`, `updatedDate`, and `originalUrl` when the backend returns them. If one topic fetch fails, the command still prints the completed portion of the research bundle, records the failure in `errors`, and exits non-zero.

## collection

Build a reusable offline collection from multiple searches and explicit topics:

```bash
apexcn collection build \
  --query "REST API" \
  --query "ORDS" \
  --topic-id 30549 \
  --limit 3 \
  --output-dir collection \
  --json

apexcn collection verify --dir collection --json
apexcn collection sync --dir collection --json
apexcn collection index --dir collection --incremental --json
```

`collection build` and `collection sync` are GET-only and never perform API writes. Sync fails before refresh when the active profile base URL differs from the collection source. Collection manifest v2 records a canonical content hash plus a canonical hash per topic; request IDs and generation timestamps do not affect those hashes. `index --incremental` reuses index records whose canonical topic hash is unchanged.

Build directly from the authenticated user's favorite-topic export, then create and move a deterministic offline bundle:

```bash
apexcn collection favorites --output-dir favorites --json
apexcn collection export --dir favorites --output favorites.bundle.json --json
apexcn collection verify-bundle --bundle favorites.bundle.json --json
apexcn collection import --bundle favorites.bundle.json --output-dir restored --json
apexcn collection restore --bundle favorites.bundle.json --dir favorites --json
```

`collection favorites` traverses the server's authenticated readonly cursor and preserves full content, URL, topic ID, relation time, update time, and provenance. Bundle import requires an empty directory; restore overwrites only managed bundle files and leaves unrelated files untouched.

Offline automation plans call no network and cannot send community writes:

```bash
apexcn collection automation plan --dir favorites --query "ORDS auth" --output plan.json --json
apexcn collection automation run --plan plan.json --output result.json --json
```

The plan/run pair is scheduler-agnostic: invoke `automation run` from the local scheduler of your choice. Replaying the same plan and content hash suppresses duplicate output.

The result records `networkRequests: 0` and `unattendedWriteRequests: 0`. Re-running the same plan against the same collection content suppresses duplicate output.

## draft

Generate a local reviewable question draft. This command does not read auth config, call the community API, or publish content:

```bash
apexcn draft question \
  --title "APEX REST API returns 403" \
  --problem "A page process gets 403 when calling a REST API." \
  --environment "APEX 24.1 / ORDS 24" \
  --tried "Confirmed the URL opens in a browser." \
  --expected "Return JSON data." \
  --actual "Returns 403." \
  --json
```

The JSON contract is stable: `kind`, `schemaVersion`, `title`, `content`, `sections`, and `references`. `content` is the complete Markdown body. `sections` always contains `problem`, `environment`, `tried`, `expected`, and `actual`; blank fields stay as empty strings in JSON and render as `待补充` in Markdown.

Use a `research` bundle as citation input:

```bash
apexcn research "REST API" --limit 3 --json > research.json
apexcn draft question \
  --title "APEX REST API returns 403" \
  --problem "A page process gets 403 when calling a REST API." \
  --research-file research.json \
  --format text > question.md
apexcn topic create --category-id 4 --title "APEX REST API returns 403" --content-file question.md --preview
```

`--research-file <path>` accepts `research --json` output, or `--research-file -` to read stdin. References are deduped by `url`, `originalUrl`, then `id`, and are extracted in `links`, `items`, `topics` order from `id`, `title`, `url`, and `originalUrl`. Only `--format text` is intended as Markdown body input for `topic create --content-file`; JSON output is for review and scripts.

Draft a local reply:

```bash
apexcn draft reply \
  --topic-id 30549 \
  --answer "Check the Web Credential first, then inspect the ORDS logs." \
  --topic-file topic.json \
  --research-file research.json \
  --format text > reply.md
apexcn reply create 30549 --content-file reply.md --preview
```

`draft reply` defaults to JSON and always contains `kind: "reply-draft"`, `schemaVersion: 1`, `topicId`, `parentPostId`, `content`, `references`, and `metadata`. When `--parent-post-id` is omitted, `parentPostId` is `null`. `--topic-id` is required. If `topic.id`, root `id`, `topicId`, or `threadId` in `--topic-file` does not match `--topic-id`, the command fails. Markdown output always contains `## 简短回应`, `## 建议步骤`, and `## 参考链接`; when there are no references it prints `无参考链接。`, never `待补充`. `--tone concise|friendly|technical` selects deterministic opening text, and JSON `metadata.tone` records the selected value.

Add `--save --json` to `draft question` or `draft reply` when the draft should enter a durable local inventory. Saving requires an active profile; plain draft generation still does not read auth config. The profile name is hashed for the storage directory and saved draft files use mode `0600`:

```bash
apexcn draft question --title "Title" --problem "Symptom" --save --json
apexcn draft list --json
apexcn draft restore <draft-id> --format text
apexcn draft export --output ./drafts.json --json
apexcn auth use another-profile
apexcn draft import --input ./drafts.json --json
apexcn draft delete <draft-id> --yes --json
```

`export/import` is the profile migration path. Import preserves draft ids, timestamps, and all content fields while binding ownership to the active profile. Matching ids fail unless `--replace` is explicit. Existing export files fail unless `--force` is explicit.

## review

Review a local topic draft before publishing. This command does not read auth config, call the community API, or publish content. Use it between `draft question` and `topic create --preview`:

```bash
apexcn review topic \
  --title "APEX REST API returns 403" \
  --content-file question.md \
  --category-id 4 \
  --tags "APEX,REST" \
  --json
```

You can also review inline Markdown directly:

```bash
apexcn review topic --title "APEX REST API returns 403" --content "## Problem..." --json
```

Choose one input mode: `--title` + `--content <markdown>`, `--title` + `--content-file <path|->`, or `--draft-file <path|->`. `--draft-file` only accepts v2 draft JSON where `kind === "question-draft"`, `schemaVersion === 1`, and `title` and `content` are strings.

JSON output always contains `kind`, `schemaVersion`, `ok`, `issues`, `warnings`, `metrics`, `requestPlan`, and `suggestedCommand`. `issues[].severity` is `issue` and causes `ok=false` plus a non-zero exit code. `warnings[].severity` is `warning` and does not fail the review by itself. Hard issues include blank title, blank content, content under 80 characters, remaining `待补充` placeholders, and possible `Authorization: Bearer ...`, `Bearer ...`, `APEXCN_API_KEY=`, `token=`, or `password=` secrets. When possible secrets are detected, `requestPlan.body.content` is redacted.

`suggestedCommand` is generated only when the input came from a reusable Markdown file. For inline content, stdin, or draft JSON input, the command does not inline content into the shell and does not treat draft JSON as `--content-file`; `suggestedCommand` is `null`, and you should save the Markdown body to a file before running `topic create --content-file`. `review topic` does not replace `topic create --preview`; it is a local quality and safety gate before API preview.

Replies have a separate local gate between `draft reply` and `reply create --dry-run`:

```bash
apexcn review reply --topic-id 30549 --content-file reply.md --json
```

`review reply` accepts `--content-file <path|->` or `--draft-file <path|->`. `--draft-file` only accepts draft JSON with `kind === "reply-draft"` and `schemaVersion === 1`; if explicit `--topic-id` or `--parent-post-id` values disagree with the draft, the mismatch is reported in `reply-review.issues[]`. Missing input, conflicting input, invalid topic ids, blank replies, too-short replies, placeholders, and possible secrets all produce stable `reply-review` JSON instead of sending an API request. `suggestedCommand` is generated only for normal Markdown file input and uses `apexcn reply create <topic-id> --content-file <file> --dry-run --json`.

## workflow

Generate an auditable local execution plan. This command does not read auth config, call the API, or execute any planned command:

```bash
apexcn workflow plan \
  --goal ask-question \
  --keyword "REST API" \
  --title "APEX REST API returns 403" \
  --problem "A page process gets 403 when calling a REST API." \
  --category-id 4 \
  --output-dir work \
  --json
```

`--goal` accepts `ask-question`, `reply`, `research-only`, `publish-topic`, and `topic-create/update/delete` or `reply-create/update/delete`. CRUD plans explicitly include preview, hash-bound approval, and execute; an MCP plan call never executes those steps.

Run a resumable workflow:

```bash
apexcn workflow run \
  --goal ask-question \
  --keyword "REST API" \
  --title "APEX REST API returns 403" \
  --problem "A page process gets 403 when calling a REST API." \
  --category-id 4 \
  --output-dir run \
  --json

apexcn workflow approve --run-dir run --approved-by reviewer --note "preview reviewed" --json
apexcn workflow verify --run-dir run --write-report --json
apexcn workflow export --run-dir run --output workflow-bundle.json --json
apexcn workflow verify-bundle --bundle workflow-bundle.json --json
apexcn workflow run --resume run --execute --yes --json
```

The default run generates a Markdown draft or copies the supplied content file, then writes `run.json`, `review.json`, and `preview.json`; it sends no final write request. After reviewing `preview.json`, use `workflow approve` to bind the target, full request, SHA-256 hash, reviewer, and expiry in `approval.json`. Execute succeeds only while the runId, target, request, hash, and expiry remain valid. After 401 or 429, repair the condition and resume the same run. Timeout or 5xx has an uncertain outcome and must reuse the same run and operation key. A 409 requires a fresh object version and a new preview and approval.

`workflow verify` is a local-only verification command. It outputs a `workflow-verification` report that checks artifact file hashes, approval-to-preview consistency, and whether a completed run's execute request equals the approved preview request. `--write-report` writes `verification.json` without modifying `run.json`.

`workflow export` is a local-only export command that runs the same verification first. By default it exports only `ok=true` workflows; use `--allow-invalid` when you need to archive failure evidence. A normal file output writes a `workflow-bundle` and prints an export summary to stdout; `--output -` prints the full bundle to stdout.

`workflow verify-bundle` is a local-only bundle verification command and does not need the original run directory. It checks the bundle schema, artifact content hash/size, embedded verification-to-artifact consistency, and independently replays the preview, approval, and execute evidence chain from bundled content.

Plans use content file paths and never inline long bodies or secrets. `--include-execute` is the only way to add `workflow approve` and the final execute step; both are marked `requiresConfirmation: true`.

## topic / thread

`thread` is an alias of `topic`.

View a topic:

```bash
apexcn topic view 30549 --json
apexcn thread view 30549 --json
apexcn topic view 30549 --format text
```

Create a topic from a file:

```bash
apexcn topic create \
  --category-id 4 \
  --title "How do I call a REST API from APEX?" \
  --content-file ./post.md \
  --tags "APEX,ORDS,REST" \
  --preview
```

Starting with 0.60.x, direct topic/reply commands are preview-only. Execute the reviewed content through a workflow:

```bash
apexcn workflow run \
  --goal topic-create \
  --category-id 4 \
  --title "How do I call a REST API from APEX?" \
  --content-file ./post.md \
  --output-dir ./topic-create-run \
  --json
```

Create a topic from an inline body:

```bash
apexcn topic create \
  --category-id 4 \
  --title "APEX REST API example" \
  --content "I have a question about calling REST APIs from APEX." \
  --preview
```

Create a topic from stdin:

```bash
printf 'Body from stdin\n' | apexcn topic create --category-id 4 --title "stdin example" --content-file - --preview
```

Choose exactly one body source: `--content-file`, `--content`, or stdin. The CLI rejects `--content` and `--content-file` when both are supplied. `--content-file -` reads stdin explicitly; use `--content-file ./-` for a file literally named `-`.

Edit a topic:

```bash
apexcn topic update 30549 --content "Updated body." --preview
apexcn topic edit 30549 --title "Updated title" --content-file ./updated-post.md --preview
apexcn thread edit 30549 --tags "APEX,REST" --preview
```

Delete a topic:

```bash
apexcn topic delete 30549 \
  --yes \
  --force \
  --confirm-title "Full title" \
  --preview
```

## reply / post

`post` is an alias of `reply`.

Create a reply:

```bash
apexcn reply create 30549 --content "This approach works." --preview
apexcn reply create 30549 --content-file ./reply.md --preview
printf 'Body from stdin\n' | apexcn reply create 30549 --content-file - --preview
```

Create a nested reply:

```bash
apexcn reply create 30549 --parent-post-id 201480 --content "One more detail." --preview
```

Edit a reply:

```bash
apexcn reply update 201480 --content "Updated reply." --preview
apexcn reply edit 201480 --content-file ./reply-updated.md --preview
apexcn post edit 201480 --content "Updated through the post alias." --preview
```

Delete a reply:

```bash
apexcn reply delete 201480 --yes --force --preview
apexcn post delete 201480 --yes --force --preview
```

## favorite

Favorite a topic:

```bash
apexcn favorite add 30549 --json
```

Remove favorite:

```bash
apexcn favorite remove 30549 --json
```

## subscription

Subscribe to a topic:

```bash
apexcn subscription add 30549 --json
```

Unsubscribe:

```bash
apexcn subscription remove 30549 --json
```

## ask

Ask against community content:

```bash
apexcn ask "How do I call a REST API from Oracle APEX?" --json
apexcn ask "How do I generate an ORDS OAuth2 Bearer token?" --top-k 3 --json
apexcn ask "What changed in the recent ORDS API?" --tag ORDS --from 2026-07-01 --to 2026-07-05 --top-k 5 --json
apexcn ask "How do I call a REST API from Oracle APEX?" --format text
```

Filtered ask requests with `--category-id`, `--from/--to`, or `--tag` return scoped references, `confidence`, `limitations`, and `filters`. Until the server contract changes, do not treat filtered ask as full RAG generation.

Ask references try to derive clickable `https://oracleapex.cn/t/<id>` links from backend topic ids, `card_link`, `doc_id`, `url`, or `threadUrl`. Original backend URLs are preserved as `originalUrl`.

## Common Flows

Contracts and MCP manifests:

```bash
apexcn commands --json
apexcn commands --json-schema
apexcn mcp tools --json
apexcn mcp tools --json --allow-preview-write
apexcn mcp inspect --json
```

Local collection BM25 search:

```bash
apexcn collection index --dir ./collection --json
apexcn collection query --dir ./collection "ORDS auth failed" --top-k 5 --explain --json
apexcn collection stats --dir ./collection --json
```

Workflow policy, diff, and audit log:

```bash
apexcn workflow policy init --output apexcn-policy.json
apexcn workflow verify --run-dir ./run --policy apexcn-policy.json --json
apexcn workflow diff --run-dir ./run --json
apexcn workflow audit-log --run-dir ./run --format ndjson
apexcn workflow audit-log --run-dir ./run --format ndjson > audit.ndjson
apexcn workflow audit-log --run-dir ./run --verify-file audit.ndjson --json
```

The default policy denies unconfigured commands, requires one distinct approver for create/update and two for delete, and retains audit evidence for 90 days. Add `--second-approver <name>` to `workflow approve` when the selected policy requires two people. Pass `--policy <file>` to the resumed execute command to enforce the policy before any API write. Audit events include a SHA-256 hash chain; `--verify-file` rejects missing, reordered, modified, or extra events.

Readonly real-environment acceptance. The script skips when `APEXCN_API_KEY` is not set. With a key, it checks `doctor`, `me`, `category list`, `search`, and `ask`; write paths only run with `--preview`:

```bash
npm run test:e2e:readonly
```

Search, then view a result:

```bash
apexcn search "REST API" --page-size 5 --json
apexcn topic view 30354 --json
```

Check categories before posting:

```bash
apexcn category list --json
apexcn topic create --category-id 4 --title "Title" --content-file ./post.md --preview
```

Confirm title before deleting:

```bash
apexcn topic view 30549 --json
apexcn topic delete 30549 --yes --force --confirm-title "Full title" --preview
```

## API write dry-run classification

The one-click installer takes no arguments and has no dry-run mode. CLI API `--preview` / `--dry-run` prints the community API write request that would be sent without executing it, including `dryRun`, `preview`, and `mode` so agents can distinguish preview from dry-run. API write preview is available only for `topic create/update/edit/delete`, `reply create/update/edit/delete`, `favorite add/remove`, and `subscription add/remove`; aliases `thread` and `post` inherit the same classification. `ask` uses POST but is a read-like RAG command and is excluded. Preview does not require a prior `category list` or `topic view`; topic creation still requires `--category-id`, and topic deletion still requires `--yes --force --confirm-title`.
