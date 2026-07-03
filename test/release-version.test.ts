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

  test("npm package contains only runtime and user-facing assets", () => {
    const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: repoRoot,
      encoding: "utf8"
    });
    const files = JSON.parse(output)[0].files.map((file: { path: string }) => file.path).sort();

    expect(files).toEqual(expect.arrayContaining([
      "README.md",
      "agent-skill/SKILL.md",
      "dist/index.js",
      "docs/cli-manual.zh.md",
      "docs/user-guide.en.md",
      "node_modules/commander/package.json",
      "package.json",
      "scripts/e2e-readonly.sh",
      "scripts/install-agent.ps1",
      "scripts/install-agent.sh"
    ]));
    expect(files).not.toEqual(expect.arrayContaining([
      ".github/workflows/ci.yml",
      "scripts/check-release-version.mjs",
      "src/index.ts",
      "test/content.test.ts",
      "tsconfig.json",
      "vitest.config.ts"
    ]));
    expect(files.some((path: string) => path.startsWith("src/"))).toBe(false);
    expect(files.some((path: string) => path.startsWith("test/"))).toBe(false);
    expect(files.some((path: string) => path.startsWith(".github/"))).toBe(false);
  }, 30000);

  test("readonly e2e script skips when no API key is configured", () => {
    const result = spawnSync("bash", ["scripts/e2e-readonly.sh"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, APEXCN_API_KEY: "" }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Skipping readonly e2e");
    expect(result.stderr).toBe("");
  }, 30000);
});
