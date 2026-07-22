#!/usr/bin/env bash
set -euo pipefail

operation="${1:-}"
[[ -n "$operation" ]] || {
  printf 'Usage: lifecycle-agent.sh <install|upgrade|rollback|uninstall> [options]\n' >&2
  exit 2
}
shift

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
installer="$script_dir/install-agent.sh"
install_root="${APEXCN_CLI_INSTALL_ROOT:-$HOME/.apexcn/tools/apexcn-cli}"
bin_dir="${APEXCN_CLI_BIN_DIR:-$HOME/.local/bin}"
backup_root="${APEXCN_CLI_BACKUP_ROOT:-$HOME/.apexcn/backups/apexcn-cli}"
backup_path=""
yes="${APEXCN_CLI_YES:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-root)
      install_root="${2:-}"
      shift 2
      ;;
    --bin-dir)
      bin_dir="${2:-}"
      shift 2
      ;;
    --backup-root)
      backup_root="${2:-}"
      shift 2
      ;;
    --backup)
      backup_path="${2:-}"
      shift 2
      ;;
    --yes)
      yes=1
      shift
      ;;
    *)
      printf 'Unknown lifecycle option: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

cli_root() {
  for candidate in "$install_root" "$install_root/cli" "$install_root/package"; do
    [[ -f "$candidate/package.json" ]] && {
      printf '%s\n' "$candidate"
      return 0
    }
  done
  return 1
}

installed_version() {
  local root
  root="$(cli_root)" || return 1
  node -e 'const p=require(process.argv[1]); process.stdout.write(p.version)' "$root/package.json"
}

write_launcher() {
  local root entrypoint
  root="$(cli_root)"
  entrypoint="$root/dist/index.js"
  [[ -f "$entrypoint" ]] || { printf 'Installed apexcn-cli is missing dist/index.js.\n' >&2; exit 1; }
  chmod +x "$entrypoint"
  mkdir -p "$bin_dir"
  ln -sfn "$entrypoint" "$bin_dir/apexcn"
}

create_backup() {
  local version stamp target
  version="$(installed_version)"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  target="$backup_root/${version}-${stamp}"
  mkdir -p "$backup_root"
  cp -a "$install_root" "$target"
  printf '%s\n' "$target"
}

restore_backup() {
  local source="$1"
  [[ -f "$source/package.json" || -f "$source/cli/package.json" || -f "$source/package/package.json" ]] \
    || { printf 'Invalid apexcn-cli backup: %s\n' "$source" >&2; exit 1; }
  rm -rf "$install_root"
  mkdir -p "$(dirname "$install_root")"
  cp -a "$source" "$install_root"
  write_launcher
  "$bin_dir/apexcn" --version >/dev/null
}

case "$operation" in
  install)
    APEXCN_CLI_INSTALL_ROOT="$install_root" APEXCN_CLI_BIN_DIR="$bin_dir" exec bash "$installer"
    ;;
  upgrade)
    cli_root >/dev/null || { printf 'No existing apexcn-cli installation at %s\n' "$install_root" >&2; exit 1; }
    backup_path="$(create_backup)"
    if APEXCN_CLI_INSTALL_ROOT="$install_root" APEXCN_CLI_BIN_DIR="$bin_dir" bash "$installer"; then
      printf '[apexcn-cli] Upgrade complete. Rollback backup: %s\n' "$backup_path"
    else
      printf '[apexcn-cli] Upgrade failed; restoring %s\n' "$backup_path" >&2
      restore_backup "$backup_path"
      exit 1
    fi
    ;;
  rollback)
    [[ "$yes" == "1" ]] || { printf 'Rollback requires --yes.\n' >&2; exit 1; }
    [[ -n "$backup_path" ]] || { printf 'Rollback requires --backup <path>.\n' >&2; exit 1; }
    restore_backup "$backup_path"
    printf '[apexcn-cli] Rollback complete: %s\n' "$(installed_version)"
    ;;
  uninstall)
    [[ "$yes" == "1" ]] || { printf 'Uninstall requires --yes.\n' >&2; exit 1; }
    launcher="$bin_dir/apexcn"
    root="$(cli_root 2>/dev/null || true)"
    if [[ -L "$launcher" && -n "$root" && "$(readlink "$launcher")" == "$root/dist/index.js" ]]; then
      rm -f "$launcher"
    elif [[ -f "$launcher" ]] && grep -q 'dist/index.js' "$launcher"; then
      rm -f "$launcher"
    fi
    rm -rf "$install_root"
    printf '[apexcn-cli] Uninstall complete. Auth configuration was preserved.\n'
    ;;
  *)
    printf 'Unknown lifecycle operation: %s\n' "$operation" >&2
    exit 2
    ;;
esac
