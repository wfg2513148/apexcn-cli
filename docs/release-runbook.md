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

Replace `v0.18.8` with the intended `0.x` version.

```bash
git tag v0.18.8
git push origin v0.18.8
gh release view v0.18.8 || gh release create v0.18.8 \
  artifacts/apexcn-cli.tgz \
  artifacts/install-agent.sh \
  artifacts/install-agent.ps1 \
  artifacts/checksums.txt \
  artifacts/apexcn-cli.tgz.sha256 \
  artifacts/install-agent.sh.sha256 \
  artifacts/install-agent.ps1.sha256 \
  --title v0.18.8 \
  --notes "apexcn-cli release v0.18.8"
```

The normal path is to push the tag and let `.github/workflows/release.yml` build and publish the assets.

## Post-Release Checks

```bash
gh release view v0.18.8 --json tagName,isDraft,isPrerelease,assets,url
curl -fsSL https://github.com/wfg2513148/apexcn-cli/releases/download/v0.18.8/checksums.txt
```

Confirm the release is not a draft, not a prerelease, and includes `checksums.txt` plus the three per-asset `.sha256` files.
