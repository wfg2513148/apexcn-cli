# apexcn-cli Release Runbook

Use this runbook for `0.x` releases. Do not publish `1.0.0` unless the product maturity threshold is explicitly redefined.

## Local Verification

```bash
npm ci
npm run build
npm test
npm run check:release
npm run eval:rag
node scripts/baseline-report.mjs
```

## Build Release Assets

```bash
rm -rf artifacts
npm run check:release
ls -la artifacts
cat artifacts/checksums.txt
```

Required assets:

- `artifacts/apexcn-cli.tgz`
- `artifacts/install-agent.sh`
- `artifacts/install-agent.ps1`
- `artifacts/checksums.txt`
- `artifacts/apexcn-cli.tgz.sha256`
- `artifacts/install-agent.sh.sha256`
- `artifacts/install-agent.ps1.sha256`

The checksum generator writes both aggregate `checksums.txt` and per-asset `.sha256` files. The GitHub Release uploads all checksum files.

## Publish

The normal goal-mode closure path publishes directly with GitHub CLI. It does not dispatch a GitHub Actions workflow.

```bash
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

git commit -m "release: $TAG [skip ci]"
git push origin main
git tag "$TAG"
git push origin "$TAG"
gh release create "$TAG" \
  artifacts/apexcn-cli.tgz \
  artifacts/install-agent.sh \
  artifacts/install-agent.ps1 \
  artifacts/checksums.txt \
  artifacts/apexcn-cli.tgz.sha256 \
  artifacts/install-agent.sh.sha256 \
  artifacts/install-agent.ps1.sha256 \
  --title "$TAG" \
  --notes "apexcn-cli release $TAG"
```

The release commit must end with `[skip ci]`. Do not run `gh workflow run`. `.github/workflows/release.yml` is a manual fallback only and is not triggered by tag pushes.

## Post-Release Checks

```bash
RELEASE_URL=$(gh release view "$TAG" --json url --jq .url)
gh release view "$TAG" --json tagName,isDraft,isPrerelease,assets,url
gh release download "$TAG" --pattern checksums.txt --dir /tmp/apexcn-release-check
cat /tmp/apexcn-release-check/checksums.txt
```

Confirm the release is not a draft, not a prerelease, and includes `checksums.txt` plus the three per-asset `.sha256` files.

## Compact Iteration Context

Create a JSON summary with these required fields:

```json
{
  "milestoneId": "0.2",
  "enhancedCapabilities": ["..."],
  "unexpectedProblems": ["none observed"],
  "rootCauses": ["..."],
  "preventionActions": ["..."],
  "nextMilestoneGoal": "...",
  "expectedResults": ["..."],
  "majorRisks": ["..."]
}
```

Then write and verify the bounded handoff:

```bash
npm run context:compact -- \
  --summary /tmp/apexcn-iteration-summary.json \
  --release-url "$RELEASE_URL"
```

The command requires a clean synchronized `main`, a tag at `HEAD`, a final GitHub Release, and all required release assets. It writes at most 12 KiB to `reports/iteration-context.json`. End the current goal after this step; the next main session reads that file before `roadmap.json` and `issues.json`.
