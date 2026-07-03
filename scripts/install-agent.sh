#!/usr/bin/env bash
set -euo pipefail

package_url="${APEXCN_CLI_PACKAGE_URL:-https://github.com/wfg2513148/apexcn-cli/releases/download/v0.6.0/apexcn-cli.tgz}"
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
install_agent_skills="${APEXCN_CLI_INSTALL_AGENT_SKILLS:-0}"
installed_agent_skill_dirs=""
current_agent_skill_installed=0
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
  --yes                       Allow automatic dependency installation and yes to prompts when possible.
  --dry-run                   Print actions without changing the system.
  --install-codex-skill       Install the Codex skill for apexcn-cli agent usage.
  --install-agent-skills      Install the skill into detected AI agent tools without prompting.
  --source-dir <path>         Use an existing local repository checkout.
  --package-url <url>         Source package URL. Defaults to the latest GitHub release package.
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
  APEXCN_CLI_INSTALL_AGENT_SKILLS=1
                              Same as --install-agent-skills.
  APEXCN_CLI_CURRENT_AGENT    Optional current AI agent override for advanced integrations.
                              Set to none to disable current-agent auto skill installation.
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

cli_root() {
  if [[ -f "$install_root/package.json" ]]; then
    printf '%s\n' "$install_root"
    return 0
  fi
  if [[ -f "$install_root/cli/package.json" ]]; then
    printf '%s\n' "$install_root/cli"
    return 0
  fi
  if [[ -f "$install_root/package/package.json" ]]; then
    printf '%s\n' "$install_root/package"
    return 0
  fi
  return 1
}

require_cli_root() {
  cli_root || die "Installed files do not contain package.json at $install_root, $install_root/cli, or $install_root/package."
}

skill_source_path() {
  if [[ "$dry_run" == "1" && -n "$source_dir" ]]; then
    if [[ -f "$source_dir/agent-skill/SKILL.md" ]]; then
      printf '%s\n' "$source_dir/agent-skill/SKILL.md"
      return 0
    fi
    if [[ -f "$source_dir/cli/agent-skill/SKILL.md" ]]; then
      printf '%s\n' "$source_dir/cli/agent-skill/SKILL.md"
      return 0
    fi
  fi
  local root=""
  root="$(require_cli_root)"
  printf '%s\n' "$root/agent-skill/SKILL.md"
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
      --install-agent-skills)
        install_agent_skills=1
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
    [[ -f "$source_dir/package.json" || -f "$source_dir/cli/package.json" ]] || die "--source-dir must point to apexcn-cli repo root"
    log "Using local source: $source_dir"
    run_cmd mkdir -p "$(dirname "$install_root")"
    if command_exists rsync; then
      if [[ "$dry_run" != "1" && -f "$source_dir/package.json" && ! -f "$source_dir/cli/package.json" && -d "$install_root/cli" ]]; then
        rm -rf "$install_root/cli"
      fi
      if [[ "$dry_run" != "1" && -f "$source_dir/package.json" && ! -f "$source_dir/package/package.json" && -d "$install_root/package" ]]; then
        rm -rf "$install_root/package"
      fi
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
    [[ "$dry_run" == "1" ]] || require_cli_root >/dev/null
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

  local cli_root_path="$install_root"
  if [[ "$dry_run" != "1" ]]; then
    cli_root_path="$(require_cli_root)"
  fi
  if [[ "$dry_run" == "1" ]]; then
    log "DRY-RUN: cd $cli_root_path && npm ci"
    log "DRY-RUN: cd $cli_root_path && npm run build"
    return
  fi

  if [[ -z "$source_dir" && "$use_git" != "1" && -f "$cli_root_path/dist/index.js" && -d "$cli_root_path/node_modules/commander" ]]; then
    log "Using bundled prebuilt apexcn-cli package."
    return
  fi

  (
    cd "$cli_root_path"
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
  local cli_root_path="$install_root"
  if [[ "$dry_run" != "1" ]]; then
    cli_root_path="$(require_cli_root)"
  fi
  if [[ "$dry_run" == "1" ]]; then
    log "Would create launcher: $bin_dir/apexcn"
    return
  fi

  write_launcher "$bin_dir/apexcn" "$cli_root_path"
}

write_launcher() {
  local launcher_path="$1"
  local cli_root_path="$2"

  cat >"$launcher_path" <<EOF
#!/usr/bin/env bash
if [[ -f "$cli_root_path/dist/index.js" ]]; then
  exec node "$cli_root_path/dist/index.js" "\$@"
fi
echo "apexcn-cli launcher cannot find dist/index.js under $cli_root_path" >&2
exit 127
EOF
  chmod +x "$launcher_path"
}

install_skill() {
  [[ "$install_codex_skill" == "1" ]] || return 0
  local codex_home="${CODEX_HOME:-$HOME/.codex}"
  local skill_dir="$codex_home/skills/apexcn-cli"
  run_cmd mkdir -p "$skill_dir"
  run_cmd cp "$(skill_source_path)" "$skill_dir/SKILL.md"
  installed_agent_skill_dirs="${installed_agent_skill_dirs}
  $skill_dir"
}

detect_agent_tool() {
  local tool="$1"
  shift
  if command_exists "$tool"; then
    return 0
  fi

  local marker=""
  for marker in "$@"; do
    [[ -e "$marker" ]] && return 0
  done
  return 1
}

has_installed_agent_skill_dir() {
  local skill_dir="$1"
  [[ "${installed_agent_skill_dirs}
" == *"
  ${skill_dir}
"* ]]
}

copy_agent_skill_to_dir() {
  local skill_dir="$1"

  has_installed_agent_skill_dir "$skill_dir" && return 0
  run_cmd mkdir -p "$skill_dir"
  run_cmd cp "$(skill_source_path)" "$skill_dir/SKILL.md"
  installed_agent_skill_dirs="${installed_agent_skill_dirs}
  $skill_dir"
}

prompt_install_agent_skill() {
  local tool="$1"
  local skill_dir="$2"

  if [[ "$install_agent_skills" == "1" || "$yes" == "1" ]]; then
    return 0
  fi

  if ! { : </dev/tty >/dev/tty; } 2>/dev/null; then
    log "Detected $tool. Re-run with --install-agent-skills to install the apexcn-cli skill to $skill_dir."
    return 1
  fi

  local answer=""
  printf '[apexcn-cli] Detected %s. Install apexcn-cli skill to %s? [y/N] ' "$tool" "$skill_dir" >/dev/tty || return 1
  read -r answer </dev/tty || return 1
  case "$answer" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

install_agent_skill_to_dir() {
  local tool="$1"
  local skill_dir="$2"

  prompt_install_agent_skill "$tool" "$skill_dir" || return 0
  copy_agent_skill_to_dir "$skill_dir"
}

install_current_agent_skill_to_dir() {
  local tool="$1"
  local skill_dir="$2"

  copy_agent_skill_to_dir "$skill_dir"
  current_agent_skill_installed=1
}

normalize_agent_name() {
  local agent="$1"
  agent="$(printf '%s' "$agent" | tr '[:upper:]' '[:lower:]')"
  case "$agent" in
    codex|claude|opencode|workbuddy|codebuddy|qcoder|qoder)
      printf '%s\n' "$agent"
      ;;
    *)
      return 1
      ;;
  esac
}

current_agent_opt_out() {
  [[ -n "${APEXCN_CLI_CURRENT_AGENT:-}" ]] || return 1
  local agent=""
  agent="$(printf '%s' "$APEXCN_CLI_CURRENT_AGENT" | tr '[:upper:]' '[:lower:]')"
  [[ "$agent" == "none" ]]
}

current_agent_from_process_tree() {
  local pid="$$"
  local command_name=""
  local parent_pid=""
  local depth=0

  while [[ -n "$pid" && "$pid" != "0" && "$depth" -lt 12 ]]; do
    command_name="$(ps -p "$pid" -o comm= 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)"
    case "$command_name" in
      *codex*) printf 'codex\n'; return 0 ;;
      *claude*) printf 'claude\n'; return 0 ;;
      *opencode*) printf 'opencode\n'; return 0 ;;
      *workbuddy*) printf 'workbuddy\n'; return 0 ;;
      *codebuddy*) printf 'codebuddy\n'; return 0 ;;
      *qcoder*) printf 'qcoder\n'; return 0 ;;
      *qoder*) printf 'qoder\n'; return 0 ;;
    esac
    parent_pid="$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d ' ' || true)"
    [[ -n "$parent_pid" && "$parent_pid" != "$pid" ]] || break
    pid="$parent_pid"
    depth=$((depth + 1))
  done

  return 1
}

current_agent_tool() {
  if current_agent_opt_out; then
    return 1
  fi

  if [[ -n "${APEXCN_CLI_CURRENT_AGENT:-}" ]]; then
    normalize_agent_name "$APEXCN_CLI_CURRENT_AGENT" && return 0
  fi

  if [[ -n "${CODEX_SHELL:-}" || -n "${CODEX_HOME:-}" || "${__CFBundleIdentifier:-}" == "com.openai.codex" ]]; then
    printf 'codex\n'
    return 0
  fi
  if [[ -n "${CLAUDE_HOME:-}" || -n "${CLAUDECODE:-}" || -n "${CLAUDE_CODE:-}" ]]; then
    printf 'claude\n'
    return 0
  fi
  if [[ -n "${OPENCODE_HOME:-}" || -n "${OPENCODE:-}" ]]; then
    printf 'opencode\n'
    return 0
  fi
  if [[ -n "${WORKBUDDY_HOME:-}" ]]; then
    printf 'workbuddy\n'
    return 0
  fi
  if [[ -n "${CODEBUDDY_HOME:-}" ]]; then
    printf 'codebuddy\n'
    return 0
  fi
  if [[ -n "${QODER_HOME:-}" || -n "${QCODER_HOME:-}" ]]; then
    printf 'qcoder\n'
    return 0
  fi

  current_agent_from_process_tree
}

install_current_agent_skill() {
  local agent=""
  agent="$(current_agent_tool)" || return 0

  log "Detected current AI tool: $agent. Installing apexcn-cli skill for this user."
  case "$agent" in
    codex)
      install_current_agent_skill_to_dir codex "${CODEX_HOME:-$HOME/.codex}/skills/apexcn-cli"
      install_current_agent_skill_to_dir codex "$HOME/.agents/skills/apexcn-cli"
      ;;
    claude)
      install_current_agent_skill_to_dir claude "${CLAUDE_HOME:-$HOME/.claude}/skills/apexcn-cli"
      ;;
    opencode)
      install_current_agent_skill_to_dir opencode "${XDG_CONFIG_HOME:-$HOME/.config}/opencode/skills/apexcn-cli"
      ;;
    workbuddy)
      install_current_agent_skill_to_dir workbuddy "${WORKBUDDY_HOME:-$HOME/.workbuddy}/skills/apexcn-cli"
      ;;
    codebuddy)
      install_current_agent_skill_to_dir codebuddy "${CODEBUDDY_HOME:-$HOME/.codebuddy}/skills/apexcn-cli"
      ;;
    qcoder|qoder)
      install_current_agent_skill_to_dir qcoder "${QODER_HOME:-${QCODER_HOME:-$HOME/.qoder-cn}}/skills/apexcn-cli"
      ;;
  esac
}

install_agent_skills() {
  local codex_home="${CODEX_HOME:-$HOME/.codex}"
  local claude_home="${CLAUDE_HOME:-$HOME/.claude}"
  local claude_skill_dir="${CLAUDE_HOME:-$HOME/.claude}/skills/apexcn-cli"
  local opencode_home="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  local opencode_skill_dir="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/skills/apexcn-cli"
  local workbuddy_home="$HOME/.workbuddy"
  local workbuddy_skill_dir="$HOME/.workbuddy/skills/apexcn-cli"
  local codebuddy_home="$HOME/.codebuddy"
  local codebuddy_skill_dir="$HOME/.codebuddy/skills/apexcn-cli"
  local qoder_home="$HOME/.qoder-cn"
  local qoder_skill_dir="$HOME/.qoder-cn/skills/apexcn-cli"

  if detect_agent_tool codex "$codex_home"; then
    install_agent_skill_to_dir codex "$codex_home/skills/apexcn-cli"
    install_agent_skill_to_dir codex "$HOME/.agents/skills/apexcn-cli"
  fi
  if detect_agent_tool claude "$claude_home"; then
    install_agent_skill_to_dir claude "$claude_skill_dir"
  fi
  if detect_agent_tool opencode "$opencode_home"; then
    install_agent_skill_to_dir opencode "$opencode_skill_dir"
  fi
  if detect_agent_tool workbuddy "$workbuddy_home"; then
    install_agent_skill_to_dir workbuddy "$workbuddy_skill_dir"
  fi
  if detect_agent_tool codebuddy "$codebuddy_home"; then
    install_agent_skill_to_dir codebuddy "$codebuddy_skill_dir"
  fi
  if detect_agent_tool qcoder "$qoder_home" || detect_agent_tool qoder "$qoder_home"; then
    install_agent_skill_to_dir qcoder "$qoder_skill_dir"
  fi
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
    repair_shell_launcher
    check_shell_launcher
    if [[ -n "$token" ]]; then
      log "DRY-RUN: would run $bin_dir/apexcn me --json"
    fi
    return
  fi

  "$bin_dir/apexcn" --help >/dev/null
  repair_shell_launcher
  check_shell_launcher
  if [[ -n "$token" ]]; then
    "$bin_dir/apexcn" auth show --json >/dev/null
    if ! "$bin_dir/apexcn" me --json >/dev/null 2>&1; then
      log "Auth profile saved, but account check failed. Run: apexcn me --json"
    fi
  fi
}

repair_shell_launcher() {
  local expected="$bin_dir/apexcn"
  local resolved=""
  resolved="$(command -v apexcn 2>/dev/null || true)"
  [[ -n "$resolved" && "$resolved" != "$expected" ]] || return 0

  if [[ "$yes" != "1" || ! -w "$(dirname "$resolved")" ]]; then
    return 0
  fi
  if launcher_looks_like_apexcn_cli "$resolved"; then
    return 0
  fi
  if [[ ! -L "$resolved" ]] && ! launcher_file_looks_like_apexcn_cli "$resolved"; then
    return 0
  fi

  local cli_root_path="$install_root"
  if [[ "$dry_run" != "1" ]]; then
    cli_root_path="$(require_cli_root)"
  fi

  log "Replacing shadowing apexcn launcher: $resolved"
  if [[ "$dry_run" == "1" ]]; then
    log "DRY-RUN: would replace $resolved with launcher for $cli_root_path"
    return 0
  fi
  rm -f "$resolved"
  write_launcher "$resolved" "$cli_root_path"
}

check_shell_launcher() {
  local expected="$bin_dir/apexcn"
  local resolved=""
  resolved="$(command -v apexcn 2>/dev/null || true)"
  if [[ -z "$resolved" ]]; then
    log "apexcn is not on PATH yet. Run this before README examples: export PATH=\"$bin_dir:\$PATH\""
    return
  fi
  if [[ "$resolved" != "$expected" ]]; then
    if launcher_looks_like_apexcn_cli "$resolved"; then
      log "Your shell currently resolves apexcn to an existing apexcn-cli launcher: $resolved"
      return
    fi
    log "WARNING: your shell currently resolves apexcn to $resolved, not $expected."
    log "Run this before README examples: export PATH=\"$bin_dir:\$PATH\""
  fi
}

launcher_looks_like_apexcn_cli() {
  local launcher_path="$1"
  "$launcher_path" --help 2>/dev/null | grep -q 'topic|thread'
}

launcher_file_looks_like_apexcn_cli() {
  local launcher_path="$1"
  [[ -f "$launcher_path" ]] || return 1
  grep -q 'apexcn-cli' "$launcher_path" 2>/dev/null && grep -q 'dist/index.js' "$launcher_path" 2>/dev/null
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
  if [[ -n "$installed_agent_skill_dirs" ]]; then
    printf '\nAgent skill installed under:%s\n' "$installed_agent_skill_dirs"
  fi
}

main() {
  parse_args "$@"
  log "Installing apexcn-cli for AI agent use."
  prepare_source
  build_cli
  install_launcher
  install_skill
  install_current_agent_skill
  if [[ "$install_agent_skills" == "1" ]]; then
    install_agent_skills
  elif ! current_agent_opt_out && { [[ "$current_agent_skill_installed" != "1" ]] || [[ "$yes" == "1" ]]; }; then
    install_agent_skills
  fi
  configure_auth
  verify_install
  print_summary
}

main "$@"
