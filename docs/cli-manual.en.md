# apexcn-cli Terminal Manual

This manual is for users running commands directly in a terminal. Examples assume the CLI is installed and authenticated.

## Global

```bash
apexcn --help
apexcn --version
apexcn help search
```

Use `--json` in scripts and AI-agent workflows.

## auth

Save an API key:

```bash
apexcn auth set-token \
  --profile agent-prod \
  --base-url https://oracleapex.cn/ords/api \
  --token "$APEXCN_API_KEY"
```

Show current profile:

```bash
apexcn auth show
apexcn auth show --json
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
```

## doctor

Check install, auth, and API reachability:

```bash
apexcn doctor
apexcn doctor --json
```

## category

List categories:

```bash
apexcn category list
apexcn category list --json
```

## search

Basic search:

```bash
apexcn search "Oracle APEX" --json
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

The current search API does not support offset pagination. Narrow large result sets with `--category-id`, `--from-date`, and `--to-date`.

## topic / thread

`thread` is an alias of `topic`.

View a topic:

```bash
apexcn topic view 30549 --json
apexcn thread view 30549 --json
```

Create a topic from a file:

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
printf 'Body from stdin\n' | apexcn topic create --category-id 4 --title "stdin example" --json
```

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
printf 'Body from stdin\n' | apexcn reply create 30549 --json
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
```

## Common Flows

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
