import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

const repoRoot = join(__dirname, "..");
const enhancementId = "TEST-CURRENT-RELEASE-ENHANCEMENT";

test("readiness accepts only enhancements bound to the current release contract", () => {
  const fixture = mkdtempSync(join(tmpdir(), "apexcn-readiness-enhancement-"));
  try {
    for (const path of ["scripts", "qualification", "eval", "dist", "src"]) {
      cpSync(join(repoRoot, path), join(fixture, path), { recursive: true });
    }
    for (const path of ["package.json", "roadmap.json", "issues.json"]) {
      cpSync(join(repoRoot, path), join(fixture, path));
    }
    mkdirSync(join(fixture, "test"));
    cpSync(join(repoRoot, "test/rag.test.ts"), join(fixture, "test/rag.test.ts"));
    mkdirSync(join(fixture, "node_modules"));
    for (const dependency of ["commander", "lossless-json"]) {
      cpSync(join(repoRoot, "node_modules", dependency), join(fixture, "node_modules", dependency), { recursive: true });
    }
    mkdirSync(join(fixture, "git-template"));
    mkdirSync(join(fixture, "git-hooks"));
    execFileSync("git", ["-c", `init.templateDir=${join(fixture, "git-template")}`, "init", "-q"], { cwd: fixture });
    execFileSync("git", [
      "-c", "user.name=Readiness Test",
      "-c", "user.email=readiness-test@example.invalid",
      "-c", "commit.gpgSign=false",
      "-c", `core.hooksPath=${join(fixture, "git-hooks")}`,
      "commit", "-q", "--allow-empty", "-m", "fixture"
    ], { cwd: fixture });

    const version = JSON.parse(readFileSync(join(fixture, "package.json"), "utf8")).version;
    const issuesPath = join(fixture, "issues.json");
    const contractPath = join(fixture, `qualification/releases/${version}/qualification-contract-v1.json`);
    const issues = JSON.parse(readFileSync(issuesPath, "utf8"));
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    issues.issues = [];
    issues.enhancementRequests = [{ id: enhancementId, targetVersion: version }];
    contract.enhancementRequestIds = [enhancementId];
    const writeFixture = () => {
      writeFileSync(issuesPath, `${JSON.stringify(issues, null, 2)}\n`);
      writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    };
    const audit = () => {
      const result = spawnSync(process.execPath, ["scripts/check-ga-readiness.mjs"], { cwd: fixture, encoding: "utf8" });
      return { status: result.status, report: JSON.parse(result.stdout) };
    };

    writeFixture();
    const bound = audit();
    expect(bound.status, JSON.stringify(bound.report.problems)).toBe(0);
    expect(bound.report.problems).toEqual([]);

    contract.enhancementRequestIds = [];
    writeFixture();
    const unbound = audit();
    expect(unbound.status).toBe(1);
    expect(unbound.report.problems).toContain("1.1 readiness contains an unrelated enhancement request");

    contract.enhancementRequestIds = [enhancementId];
    issues.enhancementRequests[0].targetVersion = "999.0.0";
    writeFixture();
    const wrongVersion = audit();
    expect(wrongVersion.status).toBe(1);
    expect(wrongVersion.report.problems).toContain("1.1 readiness contains an unrelated enhancement request");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
