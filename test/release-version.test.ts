import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");
const script = join(repoRoot, "scripts/check-release-version.mjs");
const artifactScript = join(repoRoot, "scripts/check-release-artifacts.mjs");
const baselineScript = join(repoRoot, "scripts/baseline-report.mjs");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

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

  test("baseline report exposes release consistency as stable JSON", () => {
    const report = JSON.parse(execFileSync("node", [baselineScript], {
      cwd: repoRoot,
      encoding: "utf8"
    }));

    expect(report).toEqual(expect.objectContaining({
      kind: "apexcn-baseline-report",
      schemaVersion: 1,
      packageVersion: "0.18.0",
      packageLockVersion: "0.18.0",
      releaseWorkflowUploadsChecksums: true,
      ciRunsRagEval: true,
      mcpExecuteWriteDisabled: true,
      issuesBacklogAccurate: true,
      problems: []
    }));
    expect(report.readmeReleaseUrls).toEqual(["v0.18.0"]);
  });

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
      "scripts/baseline-report.mjs",
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

  test("release artifact check builds installable GitHub assets", () => {
    const artifactsDir = `artifacts/test-release-${process.pid}`;
    try {
      const output = execFileSync("node", [artifactScript, "--artifacts-dir", artifactsDir], {
        cwd: repoRoot,
        encoding: "utf8"
      });
      const entries = execFileSync("tar", ["-tzf", join(artifactsDir, "apexcn-cli.tgz")], {
        cwd: repoRoot,
        encoding: "utf8"
      }).split("\n").filter(Boolean).map((entry) => entry.replace(/^\.\//, ""));

      expect(output).toContain("Release artifact check passed for");
      expect(entries).toEqual(expect.arrayContaining([
        "package/package.json",
        "package/dist/index.js",
        "package/dist/version.js",
        "package/node_modules/commander/package.json",
        "package/agent-skill/SKILL.md",
        "package/docs/quickstart.md",
        "package/scripts/baseline-report.mjs",
        "package/scripts/install-agent.ps1",
        "package/scripts/install-agent.sh"
      ]));
      expect(entries.some((entry) => entry.startsWith("package/.github/"))).toBe(false);
      expect(entries.some((entry) => entry.startsWith("package/artifacts/"))).toBe(false);
      expect(entries.some((entry) => entry.startsWith("package/coverage/"))).toBe(false);
      expect(entries.some((entry) => entry.startsWith("package/src/"))).toBe(false);
      expect(entries.some((entry) => entry.startsWith("package/test/"))).toBe(false);
      expect(entries).not.toEqual(expect.arrayContaining([
        "package/scripts/check-release-version.mjs",
        "package/scripts/check-release-artifacts.mjs",
        "package/tsconfig.json",
        "package/vitest.config.ts"
      ]));
    } finally {
      rmSync(join(repoRoot, artifactsDir), { recursive: true, force: true });
    }
  }, 30000);

  test("CI runs Windows installer coverage", () => {
    const workflow = readRepoFile(".github/workflows/ci.yml");

    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("test/install-agent.test.ts test/release-version.test.ts");
  });

  test("CI runs release checks after the full test suite", () => {
    const workflow = readRepoFile(".github/workflows/ci.yml");
    const testIndex = workflow.indexOf("npm test");
    const releaseCheckIndex = workflow.indexOf("npm run check:release");

    expect(testIndex).toBeGreaterThan(-1);
    expect(releaseCheckIndex).toBeGreaterThan(testIndex);
  });

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
