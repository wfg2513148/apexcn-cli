# OCI CLI health monitoring

The OCI host already runs `apexcn-health.timer`, a separate API contract monitor.
This companion service executes the installed public CLI's Node entry point,
covering its runtime, credential loading, and the `profile`, `me`, `categories`, and `search`
checks provided by `apexcn doctor`. It makes only read-only community requests.

## Runtime

- Service: `apexcn-cli-health.service`; timer: `apexcn-cli-health.timer`.
- Interval: thirty minutes, with up to twenty seconds of jitter.
- A round uses a 15-second timeout per API request and a 60-second process limit.
- The first failure is `SUSPECT`, the second consecutive failure is `DOWN`.
  A successful round resets the counter and records recovery.
- Confirming a persistent failure can take about an hour at this interval.
- JSON state retains 288 samples and 144 state-change events. Credentials and raw
  CLI output are never included. State permissions are `0600`.
- Status older than sixty-one minutes, or more than a minute in the future, is
  `STALE`, including when scheduling stops or the clock moves backwards.
- systemd serializes rounds; `flock` also protects probes using the same lock.
- The service runs as the existing `apexcn-health` user, with a read-only filesystem,
  256 MB memory limit, 10% CPU quota, and no additional privileges.

The dedicated CLI is installed under `/opt/apexcn-cli-health/cli`. It is pinned to
an independently checksummed official release. Monitoring does not auto-upgrade
the CLI, change community data, or restart the application/database.

## Configuration

`/etc/apexcn-cli-health/profile.json` contains the non-secret API namespace and
`tokenEnv: "APEXCN_API_KEY"`. `/etc/apexcn-cli-health/monitor.json` contains:

```json
{
  "cliPath": "/opt/apexcn-cli-health/cli/package/dist/index.js",
  "profileFile": "/etc/apexcn-cli-health/profile.json",
  "credentialsFile": "/etc/apexcn-health/prod-credentials.json",
  "stateDir": "/var/lib/apexcn-cli-health",
  "timeoutMs": 15000,
  "processTimeoutMs": 60000,
  "failureThreshold": 2,
  "staleAfterSeconds": 3660,
  "notifyFeishu": false
}
```

The existing private store supplies `api_key`; the value is passed only in the
child process environment. Do not place a key in profile JSON, unit arguments,
source control, shell commands, or logs.

With explicit notification authorization, `notifyFeishu` can use the existing
API monitor's Feishu transport and recipient. Failure/recovery event IDs survive
retries. There are at most two delivery attempts per round; initial success and
single transient failures do not send messages. Turning notifications off clears
pending deliveries. Logs and status remain available with notifications disabled.

## Operations

### Deployment and rollback

Stage these monitor files, the two units, and `deploy.sh` alongside the official
`apexcn-cli.tgz` on the OCI host. Obtain the expected SHA-256 independently from
the official GitHub release asset metadata and verify it before uploading. Never
reuse a checksum supplied only by an untrusted archive. No credentials belong in
the staging bundle.

```bash
sudo bash /path/to/stage/deploy.sh install /path/to/stage 1.2.2 EXPECTED_SHA256 true
```

The final argument enables Feishu; use `false` without recipient authorization.
Deployment validates the archive, backs up only this companion service's units,
configuration and symlinks, then checks a healthy round before enabling the timer.
Failure triggers automatic rollback; `ROLLBACK_FAILED` requires operator action.
The printed `ROLLBACK_COMMAND` restores the previous installation later; immutable releases and diagnostic state
are retained. Existing API monitoring and its secrets are never changed.

### Status and logs

```bash
sudo systemctl status apexcn-cli-health.timer
sudo systemctl start apexcn-cli-health.service
sudo -u apexcn-health /usr/bin/node /opt/apexcn-cli-health/current/monitor.mjs status --config /etc/apexcn-cli-health/monitor.json
sudo journalctl -u apexcn-cli-health.service --since '1 hour ago' --no-pager
```

The oneshot service being `inactive (dead)` between checks is normal. Inspect the
timer, last service result, and freshness of the state together. A failed probe
exits nonzero; the enabled timer continues checking and clears the failure when
the next healthy round succeeds. A notification delivery failure leaves its event
pending and also returns nonzero. Use `systemctl start` for manual probes;
invoking the monitor's `run` mode directly bypasses the service's lock.

For rollback, execute the exact `ROLLBACK_COMMAND` printed by the deployment.
It restores the backed-up units, configuration, both `current` and `cli` targets,
and prior timer state. Check its result before retrying a failed deployment. Do not
modify the existing `apexcn-health` API service, its credential store, or the
application containers.

## Verification

```bash
npx vitest run test/cli-health-monitor.test.ts
node ops/cli-health/acceptance.mjs
npm run build
```

The isolated acceptance runner creates a private temporary directory, exercises
failure confirmation, recovery, notification queuing, output redaction, missing
CLI, malformed output and process timeouts, then removes its fixtures. It uses a
synthetic key and notification stub: it does not call community APIs or send real
messages. Run it with the target host's Node runtime as well as locally.

Real acceptance separately requires a healthy service run with all four doctor
checks, an enabled and active timer, a marked TEST notification confirmed by
Feishu, private state/log inspection, and rollback/reinstallation without changing
the API monitor. See [the dated deployment record](VERIFICATION-2026-10-14.md).

## Coverage limits

Ask/RAG latency, browser rendering, writes, uploads, and complete OCI host loss
are not covered by this probe. The existing API monitor retains its own scope;
host-loss detection needs a monitor outside this host. A broken monitor config or
state file fails closed in journald and requires operator intervention; the
service does not overwrite corrupt evidence or guarantee delivery while its
credential store or Feishu is unavailable. Pending notifications retry next round.
