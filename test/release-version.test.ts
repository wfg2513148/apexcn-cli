import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");
const script = join(repoRoot, "scripts/check-release-version.mjs");

describe("release version check", () => {
  test("passes for the current repository version", () => {
    const output = execFileSync("node", [script], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(output).toContain("Release version check passed for");
  }, 30000);

  test("reports useful mismatches for an incorrect expected version", () => {
    const result = spawnSync("node", [script, "--expected-version", "0.0.0"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Release version check failed for expected version 0.0.0");
    expect(result.stderr).toContain("package.json version: expected 0.0.0");
    expect(result.stderr).toContain("src/version.ts CLI_VERSION: expected 0.0.0");
    expect(result.stderr).toContain("src/version.ts DEFAULT_USER_AGENT: expected apexcn-cli/0.0.0");
    expect(result.stderr).toContain("scripts/install-agent.sh default package URL");
    expect(result.stderr).toContain("docs/quickstart.md release URL tag");
    expect(result.stderr).toContain("npm pack filename: expected apexcn-cli-0.0.0.tgz");
  }, 30000);
});
