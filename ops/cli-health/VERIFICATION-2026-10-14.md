# OCI CLI health monitoring acceptance - 2026-10-14

This is dated deployment evidence, not a guarantee of subsequent live status.
The initial five-minute configuration was later changed to thirty minutes at the
user's request; see the interval-adjustment record below.

## Scope and authority

- Target: OCI host `apexcn-forums-new`; Node `v22.22.0`; systemd `239`.
- Existing `apexcn-health.timer` checks API contracts every 30 minutes but does
  not execute the installed CLI. No existing CLI monitor was found.
- Add a separate read-only CLI monitor; do not modify ORDS, database, containers,
  community records, or existing API monitoring. No CLI release is implied.
- The user explicitly authorized reusing the existing Feishu group. The original
  private credential store is reused, not copied into code or configuration.

## Initial artifact and live results

- Official CLI: `wfg2513148/apexcn-cli`, GitHub release `v1.2.1`, `apexcn-cli.tgz`.
- SHA-256 verified against GitHub release asset metadata:
  `7804d0f65f0aff908afe37c95675f87e316537be4c0dde9cfb60903f3526a286`.
- Installed Node entry point: `/opt/apexcn-cli-health/cli/package/dist/index.js`.
- Service: `apexcn-cli-health.service`; timer: `apexcn-cli-health.timer`.
- Timer verified `enabled` and `active`, with five-minute repeat and jitter.
- Initial probe at `2026-10-14T13:54:27.948Z`: HEALTHY, all four checks passed.
- Fresh-install rollback was actually executed. Companion units and symlinks
  were removed; the existing API timer remained active and successful.
- Reinstalled probe at `2026-10-14T13:55:44.558Z`: HEALTHY, version `1.2.1`,
  profile/me/categories/search all passed; process duration 3750 ms.
- Timer activation independently ran a further successful probe at
  `2026-10-14T13:55:48.901Z`; pending notifications: zero.
- The next normal five-minute round at `2026-10-14T14:01:07.501Z` also passed
  all four checks in 4897 ms; service result `success`, exit status `0`.
- A single clearly marked TEST message used the actual Feishu transport.
  Its confirmed-delivery response was `{"delivered":true}`. Synthetic failures
  did not send fake production alarms.
- The deployed production configuration was separately read back and verified
  `notifyFeishu: true`; notification activation is not inferred from the TEST.
- State permissions verified `0600`; neither state nor scoped journal contained
  the actual API key. No secret values appear in this evidence.
- API service/timer SHA-256 remained identical before/after; its current release
  remained `7994a417d6f30492007fd73863d55253a04fcb17`.
- Installed monitor, Python bridge and both units matched the local reviewed
  source checksums. Monitor SHA-256:
  `2c1dc823cd723109dddf2a29e7ccc0017419dcf40ec94825de6ce329f8430f2b`.
- Community container remained `running healthy`, restart count zero.

## Initial code and isolated acceptance

- Independent read-only reviewer found timeout and deployment rollback/acceptance
  risks. All reported blocking findings were fixed and independently rechecked.
- Focused Vitest suite: 18/18 passed, including inherited descendant pipes,
  process limits, malformed output, authentication errors, notification retry IDs,
  corrupt state preservation, private credentials and freshness boundaries.
- `acceptance.mjs` passed locally and on OCI as `apexcn-health`; synthetic fixtures
  covered HEALTHY -> SUSPECT -> DOWN -> HEALTHY, one failure/recovery event each,
  secret redaction, public-key-file rejection, missing CLI, invalid JSON and hangs.
- Linux unit verification, JavaScript/Python/shell syntax, `npm run build`, and
  `npm run check:source-layout` passed.
- Full `npm test`: 876 passed, 3 failed, 1 skipped, across 58 files. The failures
  are unchanged README assertions in `test/docs-consistency.test.ts` (two) and
  `test/install-agent.test.ts` (one), which still expect Chinese text in the
  English README. These documents/tests have no diff from HEAD in this task.
  Full-suite acceptance is therefore **not** claimed; those assertions need a
  separate documentation/test-consistency repair.

## Handoff and limits

- Status: `sudo -u apexcn-health node /opt/apexcn-cli-health/current/monitor.mjs status --config /etc/apexcn-cli-health/monitor.json`.
- Logs: `sudo journalctl -u apexcn-cli-health.service --no-pager`.
- Diagnostic evidence: `/var/lib/apexcn-cli-health/deployment-evidence-20261014.json`.
- Rollback: `sudo bash /opt/apexcn-cli-health/backups/20261014T135540Z-709955/deploy.sh rollback /opt/apexcn-cli-health/backups/20261014T135540Z-709955`.
- Synthetic fixtures were removed; no community test records were created.
- The private remote staging and acceptance directories were removed after
  verification. Immutable installation releases and rollback assets were retained.
- Probe covers the installed CLI's Node entry point, not a global PATH launcher.
  Ask/RAG, rendered pages, write operations and whole-host loss are outside scope.
  External host-loss detection remains a separate requirement.

## Interval adjustment - 22:07 CST

- User requested changing CLI monitoring from five to thirty minutes.
- Updated the source timer and loaded systemd timer to `OnUnitActiveSec=30min`.
  Live read-back confirmed `OnUnitActiveUSec=30min`, timer enabled and active;
  next scheduled run at the time of inspection: `2026-10-14 22:36:33 CST`.
- Increased the stale-state threshold to 3660 seconds (61 minutes), retaining
  two scheduled intervals plus one minute of grace. Failure confirmation still
  requires two consecutive failed rounds and can now take about one hour.
- Production config read-back confirmed `staleAfterSeconds: 3660` and
  `notifyFeishu: true`; the existing API monitor unit hashes remained unchanged.
- New live probe at `2026-10-14T14:06:26.845Z`: HEALTHY, all four checks passed.
- Updated focused suite: 19/19 passed, including schedule/default alignment and
  the 61-minute freshness boundary. Isolated acceptance and build also passed.
  The full suite was not rerun for this scheduling-only adjustment.
- Current monitor SHA-256:
  `e699c6c556bfb755f2a34f7ea730817bf87e14bd58613e0e7fadb08857f1d7cf`.
- Current evidence: `/var/lib/apexcn-cli-health/interval-evidence-20261014.json`.
- Adjustment rollback (restores the previous five-minute configuration):
  `sudo bash /opt/apexcn-cli-health/backups/20261014T140616Z-712922/deploy.sh rollback /opt/apexcn-cli-health/backups/20261014T140616Z-712922`.
