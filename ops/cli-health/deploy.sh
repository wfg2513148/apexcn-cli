#!/usr/bin/env bash
set -euo pipefail
umask 077

BASE=/opt/apexcn-cli-health
CONFIG=/etc/apexcn-cli-health
UNITS=/etc/systemd/system
SERVICE=apexcn-cli-health.service
TIMER=apexcn-cli-health.timer

[[ $EUID == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
install -d -m 0755 "$BASE"
exec 9>"$BASE/deploy.lock"
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }

restore() {
  local backup=$1 file
  [[ $backup == "$BASE"/backups/* && -f $backup/complete ]] || return 1
  if [[ -f $UNITS/$TIMER ]]; then systemctl disable --now "$TIMER" >/dev/null 2>&1 || return 1; fi
  if [[ -f $UNITS/$SERVICE ]]; then systemctl stop "$SERVICE" >/dev/null 2>&1 || return 1; fi
  for file in "$SERVICE" "$TIMER"; do
    if [[ -f $backup/$file ]]; then install -m 0644 "$backup/$file" "$UNITS/$file" || return 1;
    else rm -f "$UNITS/$file" || return 1; fi
  done
  rm -f "$BASE/current" "$BASE/cli" "$BASE/current.next" "$BASE/cli.next" || return 1
  if [[ -f $backup/current-target ]]; then ln -s "$(<"$backup/current-target")" "$BASE/current" || return 1; fi
  if [[ -f $backup/cli-target ]]; then ln -s "$(<"$backup/cli-target")" "$BASE/cli" || return 1; fi
  if [[ -d $backup/config ]]; then
    install -d -o root -g apexcn-health -m 0750 "$CONFIG" || return 1
    for file in monitor.json profile.json; do
      if [[ -f $backup/config/$file ]]; then cp -p "$backup/config/$file" "$CONFIG/$file" || return 1;
      else rm -f "$CONFIG/$file" || return 1; fi
    done
  else rm -f "$CONFIG/monitor.json" "$CONFIG/profile.json" || return 1; fi
  systemctl daemon-reload || return 1
  if [[ $(<"$backup/timer-enabled") == enabled ]]; then systemctl enable "$TIMER" >/dev/null || return 1; fi
  if [[ $(<"$backup/timer-active") == active ]]; then systemctl start "$TIMER" || return 1; fi
  echo "ROLLED_BACK=$backup"
}

abort() {
  local code=$1
  trap - ERR INT HUP TERM
  if ! restore "$BACKUP"; then echo "ROLLBACK_FAILED=$BACKUP; inspect companion units before retrying" >&2; fi
  exit "$code"
}

if [[ ${1:-} == rollback && $# == 2 ]]; then restore "$2"; exit; fi
[[ ${1:-} == install && $# == 5 ]] || {
  echo 'Usage: deploy.sh install <bundle-directory> <version> <archive-sha256> <true|false>' >&2
  echo '       deploy.sh rollback <backup-directory>' >&2
  exit 1
}
STAGE=$(realpath "$2")
VERSION=$3
SHA=$4
NOTIFY=$5
[[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && $SHA =~ ^[a-f0-9]{64}$ && $NOTIFY =~ ^(true|false)$ ]] || exit 1
id apexcn-health >/dev/null
test -x /usr/bin/node
test -x /usr/bin/python3.11
test -f /opt/apexcn-health/current/apexcn_health_notify.py
test -f /etc/apexcn-health/prod.json
test -f /etc/apexcn-health/prod-credentials.json
[[ $(sha256sum "$STAGE/apexcn-cli.tgz" | cut -d' ' -f1) == "$SHA" ]] || {
  echo 'CLI archive checksum mismatch.' >&2; exit 1;
}

# Inspect original archive paths/types before allowing root extraction.
/usr/bin/python3.11 - "$STAGE/apexcn-cli.tgz" <<'PY'
import sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    members = archive.getmembers()
    assert len(members) < 10000 and sum(m.size for m in members) < 100_000_000
    for member in members:
        name = member.name
        assert name.startswith('package/') and not any(ord(c) < 32 or ord(c) == 127 for c in name)
        assert '\\' not in name and ':' not in name and '..' not in name.split('/')
        assert member.isfile() or member.isdir()
PY

BACKUP="$BASE/backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 0700 "$BACKUP"
for file in "$SERVICE" "$TIMER"; do
  [[ ! -e $UNITS/$file ]] || cp -p "$UNITS/$file" "$BACKUP/$file"
done
[[ ! -d $CONFIG ]] || cp -a "$CONFIG" "$BACKUP/config"
for link in current cli; do
  [[ ! -e $BASE/$link || -L $BASE/$link ]] || { echo "Refusing non-symlink $link" >&2; exit 1; }
  [[ ! -L $BASE/$link ]] || readlink "$BASE/$link" >"$BACKUP/$link-target"
done
{ systemctl is-enabled "$TIMER" || true; } >"$BACKUP/timer-enabled"
{ systemctl is-active "$TIMER" || true; } >"$BACKUP/timer-active"
touch "$BACKUP/complete"
trap 'abort $?' ERR
trap 'abort 130' INT
trap 'abort 129' HUP
trap 'abort 143' TERM

install -d -m 0755 "$BASE/releases" "$BASE/cli-releases"
RELEASE=$(mktemp -d "$BASE/releases/monitor.XXXXXX")
CLI=$(mktemp -d "$BASE/cli-releases/$VERSION.XXXXXX")
chmod 0755 "$RELEASE" "$CLI"
install -m 0644 "$STAGE/monitor.mjs" "$STAGE/notify.py" "$RELEASE/"
install -m 0700 "$STAGE/deploy.sh" "$BACKUP/deploy.sh"
tar --no-same-owner --no-same-permissions -xzf "$STAGE/apexcn-cli.tgz" -C "$CLI"
chmod -R a+rX,go-w "$CLI"
/usr/bin/node --check "$RELEASE/monitor.mjs"
[[ $(/usr/bin/node "$CLI/package/dist/index.js" --version) == "$VERSION" ]]
systemd-analyze verify "$STAGE/$SERVICE" "$STAGE/$TIMER"

if [[ -f $UNITS/$TIMER ]]; then systemctl stop "$TIMER"; fi
if [[ -f $UNITS/$SERVICE ]]; then systemctl stop "$SERVICE"; fi
install -d -o root -g apexcn-health -m 0750 "$CONFIG"
install -d -o apexcn-health -g apexcn-health -m 0700 /var/lib/apexcn-cli-health
/usr/bin/node --input-type=module - "$NOTIFY" <<'JS'
import { readFileSync, writeFileSync, chmodSync, chownSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const existing = JSON.parse(readFileSync('/etc/apexcn-health/prod.json', 'utf8'));
const url = new URL(existing.api_root);
if (url.protocol !== 'https:' || url.hostname !== 'oracleapex.cn' || url.username || url.password
  || url.search || url.hash || !url.pathname.endsWith('/api/v1')) throw new Error('Unexpected API namespace');
url.pathname = url.pathname.slice(0, -7);
const group = Number(execFileSync('id', ['-g', 'apexcn-health'], { encoding: 'utf8' }).trim());
const documents = {
  'profile.json': { current: 'prod', profiles: { prod: { baseUrl: url.href.replace(/\/$/, ''), token: '', tokenEnv: 'APEXCN_API_KEY' } } },
  'monitor.json': { cliPath: '/opt/apexcn-cli-health/cli/package/dist/index.js',
    profileFile: '/etc/apexcn-cli-health/profile.json', credentialsFile: existing.credentials_file,
    stateDir: '/var/lib/apexcn-cli-health', timeoutMs: 15000, processTimeoutMs: 60000,
    failureThreshold: 2, staleAfterSeconds: 3660, notifyFeishu: process.argv[2] === 'true' }
};
for (const [name, document] of Object.entries(documents)) {
  const path = '/etc/apexcn-cli-health/' + name;
  writeFileSync(path, JSON.stringify(document, null, 2) + '\n', { mode: 0o640 });
  chmodSync(path, 0o640); chownSync(path, 0, group);
}
JS
ln -s "$RELEASE" "$BASE/current.next"
mv -Tf "$BASE/current.next" "$BASE/current"
ln -s "$CLI" "$BASE/cli.next"
mv -Tf "$BASE/cli.next" "$BASE/cli"
install -m 0644 "$STAGE/$SERVICE" "$STAGE/$TIMER" "$UNITS/"
systemctl daemon-reload
PROBE_STARTED=$(/usr/bin/node -e 'console.log(Date.now())')
systemctl start "$SERVICE"
[[ $(systemctl show "$SERVICE" -p ExecMainStatus --value) == 0 ]]
/usr/bin/node --input-type=module - "$VERSION" "$PROBE_STARTED" <<'JS'
import { readFileSync } from 'node:fs';
const state = JSON.parse(readFileSync('/var/lib/apexcn-cli-health/state.json', 'utf8'));
if (state.status !== 'HEALTHY' || Date.parse(state.checkedAt) < Number(process.argv[3])
  || state.probe.version !== process.argv[2] || state.probe.checks.length !== 4
  || !state.probe.checks.every(check => check.ok)) throw new Error('New CLI probe did not pass');
JS
sudo -u apexcn-health /usr/bin/node "$BASE/current/monitor.mjs" status --config "$CONFIG/monitor.json"
systemctl enable --now "$TIMER"
trap - ERR INT HUP TERM
echo "DEPLOYED_VERSION=$VERSION"
echo "ROLLBACK_COMMAND=sudo bash $BACKUP/deploy.sh rollback $BACKUP"
