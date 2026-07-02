#!/usr/bin/env bash
set -euo pipefail

package_url="${APEXCN_CLI_PACKAGE_URL:-https://oracleapex.cn/cli/apexcn-cli.tgz}"
repo_url="${APEXCN_CLI_REPO:-}"
repo_ref="${APEXCN_CLI_REF:-main}"
install_root="${APEXCN_CLI_INSTALL_ROOT:-$HOME/.apexcn/tools/apexcn-cli}"
bin_dir="${APEXCN_CLI_BIN_DIR:-$HOME/.local/bin}"
base_url="${APEXCN_CLI_BASE_URL:-https://oracleapex.cn/ords/api}"
profile="${APEXCN_CLI_PROFILE:-agent-prod}"
token="${APEXCN_API_KEY:-}"
source_dir=""
yes="${APEXCN_CLI_YES:-0}"
dry_run="${APEXCN_CLI_DRY_RUN:-0}"
install_codex_skill="${APEXCN_CLI_INSTALL_CODEX_SKILL:-0}"
use_git=0

if [[ -n "${APEXCN_CLI_REPO:-}" || -n "${APEXCN_CLI_REF:-}" ]]; then
  use_git=1
fi

usage() {
  cat <<'USAGE'
Install apexcn-cli for AI agents on macOS/Linux.

Usage:
  install-agent.sh [options]

Options:
  --yes                       Allow automatic dependency installation when possible.
  --dry-run                   Print actions without changing the system.
  --install-codex-skill       Install the Codex skill for apexcn-cli agent usage.
  --source-dir <path>         Use an existing local repository checkout.
  --package-url <url>         Source package URL. Defaults to https://oracleapex.cn/cli/apexcn-cli.tgz.
  --repo <url>                Use a Git repository URL instead of the package URL.
  --ref <name>                Git branch/tag/commit to install when --repo is used.
  --install-root <path>       Install root. Defaults to ~/.apexcn/tools/apexcn-cli.
  --bin-dir <path>            Directory for the apexcn launcher. Defaults to ~/.local/bin.
  --profile <name>            CLI auth profile. Defaults to agent-prod.
  --base-url <url>            ORDS API base URL. Defaults to production API URL.
  --token <token>             API key. Prefer APEXCN_API_KEY instead.
  -h, --help                  Show this help.

Environment:
  APEXCN_API_KEY              Optional API key used to configure auth.
  APEXCN_CLI_YES=1            Same as --yes.
  APEXCN_CLI_DRY_RUN=1        Same as --dry-run.
  APEXCN_CLI_INSTALL_CODEX_SKILL=1
                              Same as --install-codex-skill.
  APEXCN_CLI_PACKAGE_URL      Override source package URL.
USAGE
}

log() {
  printf '[apexcn-cli] %s\n' "$*"
}

die() {
  printf '[apexcn-cli] ERROR: %s\n' "$*" >&2
  exit 1
}

run_cmd() {
  if [[ "$dry_run" == "1" ]]; then
    printf '[apexcn-cli] DRY-RUN:'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

as_root() {
  if [[ "$(id -u)" == "0" ]]; then
    "$@"
  elif command_exists sudo; then
    sudo "$@"
  else
    die "Need root privileges to run: $*"
  fi
}

install_with_manager() {
  local package="$1"
  if [[ "$yes" != "1" ]]; then
    die "$package is missing. Re-run with --yes to allow automatic installation, or install it manually first."
  fi

  if command_exists brew; then
    run_cmd brew install "$package"
  elif command_exists apt-get; then
    run_cmd as_root apt-get update
    run_cmd as_root apt-get install -y "$package"
  elif command_exists dnf; then
    run_cmd as_root dnf install -y "$package"
  elif command_exists yum; then
    run_cmd as_root yum install -y "$package"
  elif command_exists pacman; then
    run_cmd as_root pacman -Sy --noconfirm "$package"
  elif command_exists apk; then
    run_cmd as_root apk add "$package"
  else
    die "No supported package manager found to install $package. Install it manually, then rerun this script."
  fi
}

ensure_command() {
  local command_name="$1"
  local package_name="${2:-$1}"
  if command_exists "$command_name"; then
    return
  fi
  install_with_manager "$package_name"
  if [[ "$dry_run" != "1" ]] && ! command_exists "$command_name"; then
    die "$command_name is still missing after installation attempt."
  fi
}

download_file() {
  local url="$1"
  local target="$2"
  if command_exists curl; then
    run_cmd curl -fsSL "$url" -o "$target"
  elif command_exists wget; then
    run_cmd wget -q "$url" -O "$target"
  else
    ensure_command curl curl
    run_cmd curl -fsSL "$url" -o "$target"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes)
        yes=1
        shift
        ;;
      --dry-run)
        dry_run=1
        shift
        ;;
      --install-codex-skill)
        install_codex_skill=1
        shift
        ;;
      --source-dir)
        source_dir="${2:-}"
        [[ -n "$source_dir" ]] || die "--source-dir requires a value"
        shift 2
        ;;
      --package-url)
        package_url="${2:-}"
        [[ -n "$package_url" ]] || die "--package-url requires a value"
        use_git=0
        shift 2
        ;;
      --repo)
        repo_url="${2:-}"
        [[ -n "$repo_url" ]] || die "--repo requires a value"
        use_git=1
        shift 2
        ;;
      --ref)
        repo_ref="${2:-}"
        [[ -n "$repo_ref" ]] || die "--ref requires a value"
        use_git=1
        shift 2
        ;;
      --install-root)
        install_root="${2:-}"
        [[ -n "$install_root" ]] || die "--install-root requires a value"
        shift 2
        ;;
      --bin-dir)
        bin_dir="${2:-}"
        [[ -n "$bin_dir" ]] || die "--bin-dir requires a value"
        shift 2
        ;;
      --profile)
        profile="${2:-}"
        [[ -n "$profile" ]] || die "--profile requires a value"
        shift 2
        ;;
      --base-url)
        base_url="${2:-}"
        [[ -n "$base_url" ]] || die "--base-url requires a value"
        shift 2
        ;;
      --token)
        token="${2:-}"
        [[ -n "$token" ]] || die "--token requires a value"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done
}

prepare_source() {
  if [[ -n "$source_dir" ]]; then
    [[ -f "$source_dir/package.json" ]] || die "--source-dir must point to apexcn-cli repo root"
    log "Using local source: $source_dir"
    run_cmd mkdir -p "$(dirname "$install_root")"
    if command_exists rsync; then
      run_cmd rsync -a --delete --exclude .git --exclude node_modules --exclude dist "$source_dir"/ "$install_root"/
    else
      [[ "$dry_run" == "1" ]] || rm -rf "$install_root"
      run_cmd mkdir -p "$install_root"
      run_cmd cp -R "$source_dir"/. "$install_root"/
      [[ "$dry_run" == "1" ]] || rm -rf "$install_root/.git" "$install_root/node_modules" "$install_root/dist"
    fi
    return
  fi

  if [[ "$use_git" != "1" ]]; then
    ensure_command tar tar
    local tmp_dir=""
    tmp_dir="$(mktemp -d)"
    local archive_path="$tmp_dir/apexcn-cli.tgz"
    log "Downloading apexcn-cli package: $package_url"
    download_file "$package_url" "$archive_path"
    run_cmd mkdir -p "$(dirname "$install_root")"
    [[ "$dry_run" == "1" ]] || rm -rf "$install_root"
    run_cmd mkdir -p "$install_root"
    run_cmd tar -xzf "$archive_path" -C "$install_root"
    [[ "$dry_run" == "1" ]] || rm -rf "$tmp_dir"
    [[ "$dry_run" == "1" || -f "$install_root/package.json" ]] || die "Downloaded package does not contain package.json."
    return
  fi

  [[ -n "$repo_url" ]] || repo_url="https://github.com/wfg2513148/apexcn-cli.git"
  ensure_command git git
  run_cmd mkdir -p "$(dirname "$install_root")"
  if [[ -d "$install_root/.git" ]]; then
    log "Updating existing checkout: $install_root"
    run_cmd git -C "$install_root" fetch --all --tags --prune
    run_cmd git -C "$install_root" checkout "$repo_ref"
    run_cmd git -C "$install_root" pull --ff-only
  elif [[ -e "$install_root" ]]; then
    die "$install_root exists but is not a git checkout. Move it away or pass --install-root."
  else
    log "Cloning $repo_url#$repo_ref into $install_root"
    run_cmd git clone --depth 1 --branch "$repo_ref" "$repo_url" "$install_root"
  fi
}

build_cli() {
  ensure_command node node
  ensure_command npm npm

  local cli_root="$install_root"
  if [[ "$dry_run" == "1" ]]; then
    log "DRY-RUN: cd $cli_root && npm ci"
    log "DRY-RUN: cd $cli_root && npm run build"
    return
  fi

  (
    cd "$cli_root"
    if [[ -f package-lock.json ]]; then
      npm ci || npm install
    else
      npm install
    fi
    npm run build
  )
}

install_launcher() {
  run_cmd mkdir -p "$bin_dir"
  if [[ "$dry_run" == "1" ]]; then
    log "Would create launcher: $bin_dir/apexcn"
    return
  fi

  cat >"$bin_dir/apexcn" <<EOF
#!/usr/bin/env bash
exec node "$install_root/dist/index.js" "\$@"
EOF
  chmod +x "$bin_dir/apexcn"
}

install_skill() {
  [[ "$install_codex_skill" == "1" ]] || return
  local codex_home="${CODEX_HOME:-$HOME/.codex}"
  local skill_dir="$codex_home/skills/apexcn-cli"
  run_cmd mkdir -p "$skill_dir"
  run_cmd cp "$install_root/agent-skill/SKILL.md" "$skill_dir/SKILL.md"
}

configure_auth() {
  if [[ -z "$token" ]]; then
    log "APEXCN_API_KEY not provided; skipping auth configuration."
    return
  fi

  log "Configuring apexcn auth profile '$profile' without printing the API key."
  if [[ "$dry_run" == "1" ]]; then
    log "DRY-RUN: $bin_dir/apexcn auth set-token --profile $profile --base-url $base_url --token [redacted]"
    return
  fi

  "$bin_dir/apexcn" auth set-token \
    --profile "$profile" \
    --base-url "$base_url" \
    --token "$token" >/dev/null
}

verify_install() {
  if [[ "$dry_run" == "1" ]]; then
    run_cmd "$bin_dir/apexcn" --help
    if [[ -n "$token" ]]; then
      log "DRY-RUN: would run $bin_dir/apexcn me --json"
    fi
    return
  fi

  "$bin_dir/apexcn" --help >/dev/null
  if [[ -n "$token" ]]; then
    "$bin_dir/apexcn" me --json >/dev/null
  fi
}

print_summary() {
  cat <<EOF

apexcn-cli installation complete.

Launcher:
  $bin_dir/apexcn

Installed source:
  $install_root

Recommended next check:
  apexcn auth show --json
  apexcn me --json

If your shell cannot find apexcn, add this to PATH:
  export PATH="$bin_dir:\$PATH"
EOF

  if [[ "$install_codex_skill" == "1" ]]; then
    printf '\nCodex skill installed under: %s\n' "${CODEX_HOME:-$HOME/.codex}/skills/apexcn-cli"
  fi
}

main() {
  parse_args "$@"
  log "Installing apexcn-cli for AI agent use."
  prepare_source
  build_cli
  install_launcher
  install_skill
  configure_auth
  verify_install
  print_summary
}

main "$@"
