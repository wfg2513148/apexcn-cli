#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli=(node "$repo_root/dist/index.js")
base_url="${APEXCN_CLI_BASE_URL:-https://oracleapex.cn/ords/api}"
profile="${APEXCN_E2E_PROFILE:-e2e-readonly}"
timeout_ms="${APEXCN_E2E_TIMEOUT_MS:-10000}"
keyword="${APEXCN_E2E_SEARCH_KEYWORD:-APEX}"
category_id="${APEXCN_E2E_PREVIEW_CATEGORY_ID:-1}"

if [[ -z "${APEXCN_API_KEY:-}" ]]; then
  echo "Skipping readonly e2e: APEXCN_API_KEY is not set."
  exit 0
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
config_path="$tmp_dir/config.json"

"${cli[@]}" --config "$config_path" auth set-token \
  --profile "$profile" \
  --base-url "$base_url" \
  --token "$APEXCN_API_KEY" >/dev/null

"${cli[@]}" --config "$config_path" doctor --timeout-ms "$timeout_ms" --json >/dev/null
"${cli[@]}" --config "$config_path" me --json >/dev/null
"${cli[@]}" --config "$config_path" category list --json >/dev/null
"${cli[@]}" --config "$config_path" search "$keyword" --page-size 1 --json >/dev/null
"${cli[@]}" --config "$config_path" ask "$keyword" --top-k 1 --json >/dev/null

if [[ "${APEXCN_E2E_CHECK_DOCTOR_ASK:-0}" == "1" ]]; then
  "${cli[@]}" --config "$config_path" doctor --check-ask "$keyword" --timeout-ms "$timeout_ms" --json >/dev/null
fi

"${cli[@]}" --config "$config_path" topic create \
  --category-id "$category_id" \
  --title "apexcn-cli e2e preview" \
  --content "preview only" \
  --preview >/dev/null

echo "Readonly e2e passed."
