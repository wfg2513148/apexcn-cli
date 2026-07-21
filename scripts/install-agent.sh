#!/usr/bin/env bash
set -euo pipefail

[[ "$#" -eq 0 ]] || {
  printf '[apexcn-cli] install-agent.sh takes no arguments.\n' >&2
  exit 2
}

package_url="${APEXCN_CLI_PACKAGE_URL:-https://github.com/wfg2513148/apexcn-cli/releases/latest/download/apexcn-cli.tgz}"
checksums_url="${APEXCN_CLI_CHECKSUMS_URL:-${package_url%/*}/checksums.txt}"
default_install_root="$HOME/.apexcn/tools/apexcn-cli"
default_bin_dir="$HOME/.local/bin"
install_root="${APEXCN_CLI_INSTALL_ROOT:-$default_install_root}"
bin_dir="${APEXCN_CLI_BIN_DIR:-$default_bin_dir}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

log() {
  printf '[apexcn-cli] %s\n' "$1"
}

die() {
  printf '[apexcn-cli] %s\n' "$1" >&2
  exit 1
}

download() {
  curl -fsSL --retry 5 --retry-delay 2 --connect-timeout 20 --max-time 300 "$1" -o "$2"
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{print $NF}'
  else
    die "A SHA-256 tool is required."
  fi
}

command -v node >/dev/null 2>&1 || die "Node.js 20 or newer is required."
command -v curl >/dev/null 2>&1 || die "curl is required."
command -v tar >/dev/null 2>&1 || die "tar is required."
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || die "Node.js 20 or newer is required."

archive="$tmp_dir/apexcn-cli.tgz"
checksums="$tmp_dir/checksums.txt"
log "Downloading apexcn-cli package: $package_url"
download "$package_url" "$archive" || die "Unable to download apexcn-cli.tgz."
download "$checksums_url" "$checksums" || die "Unable to download checksums.txt."
expected="$(awk '$2 == "apexcn-cli.tgz" || $2 == "*apexcn-cli.tgz" { print $1; exit }' "$checksums" | tr '[:upper:]' '[:lower:]')"
[[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || die "checksums.txt has no valid apexcn-cli.tgz checksum."
actual="$(sha256 "$archive" | tr '[:upper:]' '[:lower:]')"
[[ "$actual" == "$expected" ]] || die "Checksum verification failed for apexcn-cli.tgz."
log "Verified package checksum."

rm -rf "$install_root"
mkdir -p "$install_root"
tar -xzf "$archive" -C "$install_root"
cli_root="$install_root"
[[ -f "$cli_root/package.json" ]] || cli_root="$install_root/package"
[[ -f "$cli_root/package.json" ]] || die "Downloaded package is missing package.json."
[[ -f "$cli_root/dist/index.js" ]] || die "Downloaded package is missing dist/index.js."
[[ -d "$cli_root/node_modules/commander" ]] || die "Downloaded package is missing runtime dependencies."

mkdir -p "$bin_dir"
launcher="$bin_dir/apexcn"
printf '#!/usr/bin/env bash\nexec node "%s/dist/index.js" "$@"\n' "$cli_root" >"$launcher"
chmod +x "$launcher"

for skill_root in "$HOME/.agents/skills" "$HOME/.codex/skills" "$HOME/.config/opencode/skills"; do
  skill_target="$skill_root/apexcn-cli"
  rm -rf "$skill_target"
  mkdir -p "$skill_root"
  cp -R "$cli_root/agent-skill" "$skill_target"
done

resolved=""
if [[ "$install_root" == "$default_install_root" && "$bin_dir" == "$default_bin_dir" ]]; then
  resolved="$(command -v apexcn 2>/dev/null || true)"
fi
if [[ -n "$resolved" && "$resolved" != "$launcher" ]]; then
  if [[ -f "$resolved" ]] && grep -q 'dist/index.js' "$resolved" && [[ -w "$(dirname "$resolved")" ]]; then
    cp "$launcher" "$resolved"
    chmod +x "$resolved"
    log "Updated shell-resolved launcher: $resolved"
  else
    printf '[apexcn-cli] Add %s to PATH before older apexcn launchers.\n' "$bin_dir" >&2
  fi
fi

version="$("$launcher" --version)" || die "Installed launcher verification failed."
log "Installed apexcn-cli $version."
printf '\n'
printf 'apexcn-cli installation complete.\n\n'
printf 'Launcher:\n  %s\n\n' "$launcher"
printf 'Installed source:\n  %s\n\n' "$cli_root"
printf 'Authentication is configured after installation:\n'
printf '  apexcn -apikey "YOUR_API_KEY"\n'
printf '  apexcn me --json\n'
printf '\nIf your shell cannot find apexcn:\n  export PATH="%s:$PATH"\n' "$bin_dir"
