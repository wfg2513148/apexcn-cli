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

When an AI agent needs available commands, aliases, and options, prefer `apexcn commands --json` instead of parsing `--help` text.

For unstable networks, set `APEXCN_HTTP_TIMEOUT_MS` to provide a default timeout for community API requests. `doctor --timeout-ms` overrides this default. Blank or non-positive values are ignored.

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
