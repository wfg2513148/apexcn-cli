# Migrating to 0.80.x

0.80.x adds organization policy, tamper-evident audit verification, explicit API compatibility negotiation, sanitized support snapshots, credential fallback, and cross-platform lifecycle helpers without redesigning existing commands.

## One-click installation

Starting with 0.80.1, the public one-click installer takes no arguments. It installs the CLI launcher and user-level agent skills, requires Node.js 20+, and always verifies `apexcn-cli.tgz` against `checksums.txt`. Installation never consumes or validates an API key; configure authentication only after installation succeeds.

```bash
bash -o pipefail -c 'curl -fsSL https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.sh | bash'
```

```powershell
irm "https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.ps1" | iex
```

## API compatibility

`apexcn me capabilities --json` now adds `clientCompatibility`. The supported window is `0.8.0-candidate`, `0.7.0-candidate`, and `0.6.0-candidate`. A malformed, future, older, or incomplete current contract exits nonzero. Use `--require-capability <ids...>` to fail closed before a dependent workflow.

## Workflow policy and audit

Regenerate the policy template to obtain `auditRetentionDays` and `minimumApprovers`. Unconfigured commands are denied. Delete policies require two distinct approvers by default:

```bash
apexcn workflow approve \
  --run-dir ./run \
  --approved-by reviewer-one \
  --second-approver reviewer-two \
  --json
```

Saved JSON or NDJSON audit logs can be verified against their workflow:

```bash
apexcn workflow audit-log --run-dir ./run --format ndjson > audit.ndjson
apexcn workflow audit-log --run-dir ./run --verify-file audit.ndjson --json
```

Pass `--policy apexcn-policy.json` to `workflow run --resume ... --execute --yes` to block the API write when the policy fails.

## Credentials and support

The supported credential-store matrix is file and env, including env-to-file fallback. Configure env-only or env-first fallback without storing the environment value:

```bash
apexcn auth set-token --profile agent-env --token-env APEXCN_API_KEY
apexcn auth set-token --profile agent-fallback --token-env APEXCN_API_KEY --token "<file-fallback>"
```

Native OS keychains are not claimed as supported in 0.80.x. Save a sanitized support snapshot with user-only permissions:

```bash
apexcn doctor snapshot --output ./support-snapshot.json --json
```

## Lifecycle

Release packages include `scripts/lifecycle-agent.sh` and `scripts/lifecycle-agent.ps1` for install, upgrade, rollback, and uninstall. Upgrade creates a rollback backup and restores it if installation fails. Rollback and uninstall require explicit confirmation; authentication configuration is preserved.
