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

When an AI agent needs available commands, aliases, purposes, safety metadata, safe examples, and options, prefer `apexcn commands --json` instead of parsing `--help` text. The current structured manifest contract is `schemaVersion === 1`; if it is missing or unsupported, do not consume structured `safety` or `examples`, and upgrade the CLI or ask the user before continuing. In the manifest, `schema` lists available enum values, `safety.effects` describes command effects, `safety.preview` describes whether preview is available or required, `safety.confirmation` lists explicit confirmation flags, and `examples[].mode` separates read, preview, and execute examples.

For unstable networks, set `APEXCN_HTTP_TIMEOUT_MS` to provide a default timeout for community API requests. `doctor --timeout-ms` overrides this default. Blank or non-positive values are ignored.

When scripts need parseable failures, set `APEXCN_ERROR_FORMAT=json`. Content and account API commands write one-line JSON errors to stderr; default output remains human-readable text.

## auth

Save an API key:

```bash
apexcn auth set-token \
  --profile agent-prod \
  --base-url https://oracleapex.cn/ords/api \
  --token "$APEXCN_API_KEY"
```

`--token`, `--profile`, and `--base-url` cannot be blank or whitespace-only. `--base-url` must be an absolute `http` or `https` URL. If you pass environment variables, make sure they are set first.
Add `--no-switch` when you want to save a profile without making it current.

Show current profile:

```bash
apexcn auth show
apexcn auth show --json
apexcn auth list
apexcn auth list --json
apexcn auth use agent-prod
apexcn auth remove old-profile
```

Log out:

```bash
apexcn auth logout
```

## me

Show current account:

```bash
apexcn me
apexcn me --json
apexcn me --verbose --json
apexcn me --format text
```

## doctor

Check install, auth, and API reachability:

```bash
apexcn doctor
apexcn doctor --json
apexcn doctor --format json
apexcn doctor --format text
apexcn doctor --check-ask "How do I call a REST API from Oracle APEX?" --json
apexcn doctor --timeout-ms 10000 --json
```

`doctor` defaults to text output. `--format json` prints compact JSON; `--json` and `--format pretty` print pretty JSON. JSON output includes diagnostics such as CLI version, user agent, config path, Node.js version, platform, and architecture. By default it checks only the profile, account, categories, and search. It checks the RAG ask endpoint only when you explicitly pass `--check-ask <question>`. `--timeout-ms` sets a per-check request timeout in milliseconds.

## category

List categories:

```bash
apexcn category list
apexcn category list --json
apexcn category list --format text
```

## search

Basic search:

```bash
apexcn search "Oracle APEX" --json
apexcn search "Oracle APEX" --format text
```

Limit result count:

```bash
apexcn search "REST API" --page-size 5 --json
```

Search within a category:

```bash
apexcn search "ORDS" --category-id 4 --page-size 10 --json
```

Search by updated date range:

```bash
apexcn search "JSON" --from-date 2026-01-01 --to-date 2026-12-31 --json
```

`--page-size` accepts 1 to 50. The current search API does not support offset pagination. Narrow large result sets with `--category-id`, `--from-date`, and `--to-date`.

## research

Search and fetch the top topics in one read-only research bundle for AI-agent summarization and citation:

```bash
apexcn research "REST API" --limit 3 --json
apexcn research "ORDS" --category-id 4 --from-date 2026-01-01 --format text
```

`--limit` accepts 1 to 10 and defaults to 3. JSON output always contains `query`, `items`, `topics`, `links`, `requestIds`, and `errors`. If one topic fetch fails, the command still prints the completed portion of the research bundle, records the failure in `errors`, and exits non-zero.

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
```

`collection build` is read-only and never performs API writes. It collects topics in query input order, search result order within each query, and explicit `--topic-id` order last, deduplicating by `id/topicId/threadId`. The output directory contains `collection.json`, `index.md`, and `topics/<id>.json`. Each topic artifact uses a stable wrapper: `kind: "collection-topic"`, `schemaVersion: 1`, `id`, `sources`, `request`, `requestId`, and `result`. `collection.json.files` records `path`, `sha256`, and `size` for the index and topic files so `collection verify` can validate the collection locally. If one topic fetch fails, the error is recorded in `errors`, successful artifacts are kept, and the command exits non-zero.

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

Choose one input mode: `--title` + `--content-file <path|->`, or `--draft-file <path|->`. `--draft-file` only accepts v2 draft JSON where `kind === "question-draft"`, `schemaVersion === 1`, and `title` and `content` are strings.

JSON output always contains `kind`, `schemaVersion`, `ok`, `issues`, `warnings`, `metrics`, `requestPlan`, and `suggestedCommand`. `issues[].severity` is `issue` and causes `ok=false` plus a non-zero exit code. `warnings[].severity` is `warning` and does not fail the review by itself. Hard issues include blank title, blank content, content under 80 characters, remaining `待补充` placeholders, and possible `Authorization: Bearer ...`, `Bearer ...`, `APEXCN_API_KEY=`, `token=`, or `password=` secrets. When possible secrets are detected, `requestPlan.body.content` is redacted.

`suggestedCommand` is generated only when the input came from a reusable Markdown file. For stdin or draft JSON input, the command does not inline content into the shell and does not treat draft JSON as `--content-file`; `suggestedCommand` is `null`, and you should save the Markdown body to a file before running `topic create --content-file`. `review topic` does not replace `topic create --preview`; it is a local quality and safety gate before API preview.

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

`--goal` accepts `ask-question`, `reply`, `research-only`, and `publish-topic`. JSON output always contains `kind: "workflow-plan"`, `schemaVersion: 1`, `goal`, `steps`, `checkpoints`, `files`, and `safetySummary`. Missing required inputs do not fail the command; they are listed in `checkpoints.missingInputs[]`. `ask-question` needs `--keyword`, `--title`, `--problem`, and `--category-id`; `reply` needs `--topic-id` and `--answer`; `publish-topic` needs `--title`, `--category-id`, and the only body source, `--content-file`.

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

The default run reads the API, generates local Markdown drafts, and writes `run.json`, `research.json`, `review.json`, and `preview.json`; it does not send the final POST. After reviewing `preview.json`, use `workflow approve` to write `approval.json` with a SHA-256 hash of the preview request. Only when the approval `runId` and hash match the current preview will `--resume <run-dir> --execute --yes` perform the final write and record `execute.json`. Resume skips completed steps when their artifacts exist and reruns completed steps whose artifacts are missing.

`workflow verify` is a local-only verification command. It outputs a `workflow-verification` report that checks artifact file hashes, approval-to-preview consistency, and whether a completed run's execute request equals the approved preview request. `--write-report` writes `verification.json` without modifying `run.json`.

`workflow export` is a local-only export command that runs the same verification first. By default it exports only `ok=true` workflows; use `--allow-invalid` when you need to archive failure evidence. A normal file output writes a `workflow-bundle` and prints an export summary to stdout; `--output -` prints the full bundle to stdout.

`workflow verify-bundle` is a local-only bundle verification command and does not need the original run directory. It checks the bundle schema, artifact content hash/size, embedded verification-to-artifact consistency, and independently replays the preview, approval, and execute evidence chain from bundled content.

Plans use file paths only and never generate commands that inline long content or secrets. `ask-question` plans `research -> draft question -> review topic -> topic create --preview`; `reply` plans `topic view -> draft reply -> reply create --preview`; `publish-topic` plans `review topic -> topic create --preview`. Real API execute steps appear only with `--include-execute`, and those steps are marked `requiresConfirmation: true`.

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

After the preview looks correct, execute it:

```bash
apexcn topic create \
  --category-id 4 \
  --title "How do I call a REST API from APEX?" \
  --content-file ./post.md \
  --tags "APEX,ORDS,REST" \
  --json
```

Create a topic from an inline body:

```bash
apexcn topic create \
  --category-id 4 \
  --title "APEX REST API example" \
  --content "I have a question about calling REST APIs from APEX." \
  --json
```

Create a topic from stdin:

```bash
printf 'Body from stdin\n' | apexcn topic create --category-id 4 --title "stdin example" --content-file - --json
```

Choose exactly one body source: `--content-file`, `--content`, or stdin. The CLI rejects `--content` and `--content-file` when both are supplied. `--content-file -` reads stdin explicitly; use `--content-file ./-` for a file literally named `-`.

Edit a topic:

```bash
apexcn topic update 30549 --content "Updated body." --json
apexcn topic edit 30549 --title "Updated title" --content-file ./updated-post.md --json
apexcn thread edit 30549 --tags "APEX,REST" --json
```

Delete a topic:

```bash
apexcn topic delete 30549 \
  --yes \
  --force \
  --confirm-title "Full title" \
  --json
```

## reply / post

`post` is an alias of `reply`.

Create a reply:

```bash
apexcn reply create 30549 --content "This approach works." --json
apexcn reply create 30549 --content-file ./reply.md --json
printf 'Body from stdin\n' | apexcn reply create 30549 --content-file - --json
```

Create a nested reply:

```bash
apexcn reply create 30549 --parent-post-id 201480 --content "One more detail." --json
```

Edit a reply:

```bash
apexcn reply update 201480 --content "Updated reply." --json
apexcn reply edit 201480 --content-file ./reply-updated.md --json
apexcn post edit 201480 --content "Updated through the post alias." --json
```

Delete a reply:

```bash
apexcn reply delete 201480 --yes --force --json
apexcn post delete 201480 --yes --force --json
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
apexcn ask "How do I call a REST API from Oracle APEX?" --format text
```

## Common Flows

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
apexcn topic create --category-id 4 --title "Title" --content-file ./post.md --json
```

Confirm title before deleting:

```bash
apexcn topic view 30549 --json
apexcn topic delete 30549 --yes --force --confirm-title "Full title" --json
```

## API write dry-run classification

Installer `--dry-run` is separate from CLI API command preview. Installer dry-run checks installation actions; CLI API `--preview` / `--dry-run` prints the community API write request that would be sent without executing it. API write preview is available only for `topic create/update/edit/delete`, `reply create/update/edit/delete`, `favorite add/remove`, and `subscription add/remove`; aliases `thread` and `post` inherit the same classification. `ask` uses POST but is a read-like RAG command and is excluded. Preview does not require a prior `category list` or `topic view`; topic creation still requires `--category-id`, and topic deletion still requires `--yes --force --confirm-title`.
