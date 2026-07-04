# Issues

## Backlog

### Support pagination when search reports more results

- Date found: 2026-07-04
- Real-use scenario: A user asks "apexlang有哪些新文章" and wants to continue beyond the first page.
- Reproduction:
  - `apexcn search "ApexLang" --page-size 5 --json`
  - Result includes `"hasMore": true`.
  - `apexcn search "ApexLang" --page-size 5 --offset 5 --json`
  - Result fails with `Current search API does not support offset pagination`.
- Problem: The CLI reports that more results exist but offers no usable pagination path.
- Impact: Agents cannot reliably inspect all matching community posts, and must tell users only a lower bound or ask them to narrow the search.
- Proposed fix: Add supported pagination to search, or replace `hasMore` with a documented narrowing-only contract if pagination is not possible.
- Acceptance criteria:
  - When `page.hasMore` is true, the CLI exposes a documented way to fetch the next page.
  - Pagination works with `--json` and preserves `requestId`.
  - `apexcn commands --json` documents the pagination option and its support status.

### Include created date in search and research result items

- Date found: 2026-07-04
- Real-use scenario: A user asks "apexlang有哪些新文章，都更新了哪些内容？"
- Reproduction:
  - `apexcn search "ApexLang" --page-size 5 --json`
  - Items include `updatedDate` but not `createdDate`.
  - `apexcn topic view <id> --json` includes both `createdDate` and `updatedDate`.
- Problem: Search and research items cannot distinguish newly published posts from older posts that were recently updated.
- Impact: Agents can misclassify "new articles" by update time unless they fetch every topic individually.
- Proposed fix: Include `createdDate` in search and research item summaries.
- Acceptance criteria:
  - Search items include `createdDate` and `updatedDate`.
  - Research `items` and `links` preserve both dates when available.
  - Date semantics are documented as created, updated, imported, or source-published time.
