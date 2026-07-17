import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseNpmPackResult } from "../scripts/npm-pack-json.mjs";

const repoRoot = join(__dirname, "..");
const script = join(repoRoot, "scripts/check-release-version.mjs");
const artifactScript = join(repoRoot, "scripts/check-release-artifacts.mjs");
const baselineScript = join(repoRoot, "scripts/baseline-report.mjs");
const sourceLayoutScript = join(repoRoot, "scripts/check-source-layout.mjs");
const workflowScript = join(repoRoot, "scripts/check-workflows.mjs");

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

function execNpm(args: string[]): string {
  if (process.env.npm_execpath) {
    return execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
      cwd: repoRoot,
      encoding: "utf8"
    });
  }
  return execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    cwd: repoRoot,
    encoding: "utf8"
  });
}

describe("release version check", () => {
  test("accepts array and object npm pack JSON response shapes", () => {
    const metadata = {
      filename: "apexcn-cli-0.18.18.tgz",
      files: [{ path: "package.json" }]
    };

    expect(parseNpmPackResult(JSON.stringify([metadata]))).toEqual(metadata);
    expect(parseNpmPackResult(JSON.stringify({ "apexcn-cli": metadata }))).toEqual(metadata);
    expect(() => parseNpmPackResult("{}")).toThrow("npm pack --json returned no package metadata");
  });

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
    expect(result.stderr).toContain("package.json version: expected 0.0.0");
    expect(result.stderr).toContain("npm pack filename: expected apexcn-cli-0.0.0.tgz");
  }, 30000);

  test("baseline report exposes release consistency as stable JSON", () => {
    const packageVersion = JSON.parse(readRepoFile("package.json")).version;
    const report = JSON.parse(execFileSync("node", [baselineScript], {
      cwd: repoRoot,
      encoding: "utf8"
    }));

    expect(report).toEqual(expect.objectContaining({
      kind: "apexcn-baseline-report",
      schemaVersion: 1,
      version: packageVersion,
      packageVersion,
      packageLockVersion: packageVersion,
      releaseWorkflowUploadsChecksums: true,
      ciRunsRagEval: true,
      mcpExecuteWriteDisabled: true,
      issuesBacklogAccurate: true,
      problems: [],
      commands: expect.objectContaining({
        total: expect.any(Number),
        readonly: expect.any(Number),
        previewOnly: expect.any(Number),
        destructive: expect.any(Number)
      }),
      mcp: expect.objectContaining({
        readonlyTools: expect.any(Number),
        previewTools: expect.any(Number),
        executeWriteSupported: false
      }),
      schemas: expect.arrayContaining(["src/schemas/mcp.ts", "src/schemas/workflow.ts"]),
      releaseAssets: expect.arrayContaining(["apexcn-cli.tgz", "checksums.txt", "install-agent.ps1.sha256"])
    }));
    expect(report.readmeReleaseUrls).toEqual(["latest"]);
    expect(report.commands.total).toBeGreaterThan(40);
    expect(report.git.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  test("baseline report can be written to an output file", () => {
    const dir = mkdtempSync(join(tmpdir(), "apexcn-baseline-output-"));
    const outputPath = join(dir, "baseline.json");
    try {
      execFileSync("node", [baselineScript, "--output", outputPath], {
        cwd: repoRoot,
        encoding: "utf8"
      });
      expect(existsSync(outputPath)).toBe(true);
      const report = JSON.parse(readFileSync(outputPath, "utf8"));
      expect(report.kind).toBe("apexcn-baseline-report");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("npm package contains only runtime and user-facing assets", () => {
    const output = execNpm(["pack", "--dry-run", "--json"]);
    const files = (parseNpmPackResult(output).files as Array<{ path: string }>)
      .map((file) => file.path)
      .sort();

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
    const artifactsDir = mkdtempSync(join(tmpdir(), "apexcn-test-release-"));
    try {
      const output = execFileSync("node", [artifactScript, "--artifacts-dir", artifactsDir], {
        cwd: repoRoot,
        encoding: "utf8"
      });
      const entries = execFileSync("tar", ["-tzf", join(artifactsDir, "apexcn-cli.tgz")], {
        cwd: repoRoot,
        encoding: "utf8"
      }).split("\n").map((entry) => entry.trim()).filter(Boolean).map((entry) => entry.replace(/^\.\//, ""));

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
      rmSync(artifactsDir, { recursive: true, force: true });
    }
  }, 30000);

  test("workflow check enforces CI and release quality gates", () => {
    const output = execFileSync("node", [workflowScript], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(output).toContain("Workflow check passed");
  });

  test("source layout check rejects minified or single-line source files", () => {
    const output = execFileSync("node", [sourceLayoutScript], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(output).toContain("Source layout check passed");
  });

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
