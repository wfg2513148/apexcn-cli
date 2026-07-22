import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");
const publicDocs = [
  "README.md",
  "docs/cli-manual.en.md",
  "docs/cli-manual.zh.md",
  "docs/security-model.md",
  "docs/user-guide.en.md",
  "docs/user-guide.zh.md"
];

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("documentation consistency", () => {
  test("public documentation stays concise and maintainable", () => {
    for (const path of publicDocs) {
      expect(existsSync(join(repoRoot, path)), path).toBe(true);
      expect(read(path).trimEnd().split("\n").length, path).toBeGreaterThanOrEqual(20);
    }

    const removedInternalDocs = [
      "docs/api-contract.md",
      "docs/capability-matrix.md",
      "docs/migration-v0.30.md",
      "docs/migration-v0.40.md",
      "docs/quickstart.md",
      "docs/release-runbook.md",
      "docs/roadmap.md",
      "docs/testing-feedback-loop.zh.md",
      "docs/workflow-policy.md"
    ];
    for (const path of removedInternalDocs) {
      expect(existsSync(join(repoRoot, path)), path).toBe(false);
    }
  });

  test("workflow files stay multiline and release remains manual-only", () => {
    const ci = read(".github/workflows/ci.yml");
    const release = read(".github/workflows/release.yml");
    expect(ci).toMatch(/^name: CI$/m);
    expect(ci).toMatch(/^on:$/m);
    expect(ci).toMatch(/^jobs:$/m);
    expect(release).toMatch(/^name: Release$/m);
    expect(release).toMatch(/^on:$/m);
    expect(release).toMatch(/^jobs:$/m);
    expect(release).toMatch(/^\s+workflow_dispatch:$/m);
    expect(release).not.toMatch(/^\s+push:$/m);
    expect(release).toMatch(/^\s+gh release create "\$RELEASE_TAG" \\$/m);
  });

  test("install URLs use the latest release endpoint", () => {
    const docs = ["README.md", "scripts/install-agent.sh", "scripts/install-agent.ps1"].map(read).join("\n");

    expect(docs).toContain("/releases/latest/download/apexcn-cli.tgz");
    expect(docs).toContain("/releases/latest/download/install-agent.sh");
    expect(docs).toContain("/releases/latest/download/install-agent.ps1");
    expect(docs).not.toMatch(/\/releases\/download\/v\d+\.\d+\.\d+\//);
  });

  test("README keeps the minimal fail-closed install command", () => {
    const readme = read("README.md");
    expect(readme).toContain("bash -o pipefail -c");
    expect(readme).toContain("curl -fsSL https://github.com/wfg2513148/apexcn-cli/releases/latest/download/install-agent.sh | bash");
    expect(readme).not.toContain("curl -fsSL --retry");
    expect(readme).not.toContain("install-agent.sh | APEXCN_API_KEY");
  });

  test("README-linked documentation files exist", () => {
    const readme = read("README.md");
    const docs = [...readme.matchAll(/\((docs\/[^)]+\.md)\)/g)].map((match) => match[1]);

    for (const doc of docs) {
      expect(existsSync(join(repoRoot, doc))).toBe(true);
    }
  });

  test("README community onboarding uses real screenshot assets", () => {
    const readme = read("README.md");
    const screenshots = [
      "docs/assets/readme/apexcn-community-home.jpg",
      "docs/assets/readme/apexcn-api-key-management.png"
    ];

    expect(readme).toContain("## APEX 中文社区是什么");
    expect(readme).toContain("## 如何获取 API Key");

    for (const screenshot of screenshots) {
      expect(readme).toContain(`](${screenshot})`);
      expect(existsSync(join(repoRoot, screenshot))).toBe(true);
      expect(readFileSync(join(repoRoot, screenshot)).byteLength).toBeGreaterThan(10_000);
    }
  });

  test("user-facing documentation uses professional audience language", () => {
    const docs = publicDocs.map(read).join("\n");
    expect(docs).not.toContain("小白");
    expect(docs).not.toMatch(/\bnovices?\b/i);
    expect(docs).not.toContain("Beginner Guide");
  });

  test("user-facing examples do not present stale fixed content ids as live", () => {
    const readme = read("README.md");
    const userGuides = [read("docs/user-guide.zh.md"), read("docs/user-guide.en.md")].join("\n");
    const manuals = [read("docs/cli-manual.zh.md"), read("docs/cli-manual.en.md")].join("\n");

    expect(readme).not.toContain("30549");
    expect(userGuides).not.toContain("30549");
    expect(userGuides).not.toContain("201480");
    expect(readme).toContain("不要把示例编号当作当前线上内容");
    expect(manuals).toContain("示例中的帖子和回复编号只用于说明命令格式");
    expect(manuals).toContain("ids in examples only demonstrate command syntax");
  });

  test("security documentation matches public release assets", () => {
    const security = read("docs/security-model.md");
    const workflow = read(".github/workflows/release.yml");

    for (const asset of ["apexcn-cli.tgz", "install-agent.sh", "install-agent.ps1", "checksums.txt"]) {
      expect(security).toContain(asset);
    }
    for (const asset of ["apexcn-cli.tgz", "install-agent.sh", "install-agent.ps1", "checksums.txt", "apexcn-cli.tgz.sha256", "install-agent.sh.sha256", "install-agent.ps1.sha256"]) {
      expect(workflow).toContain(`artifacts/${asset}`);
    }
  });

  test("security documentation exposes standalone lifecycle scripts without implying CLI subcommands", () => {
    const security = read("docs/security-model.md");

    expect(security).toContain("生命周期脚本是独立脚本，不是 `apexcn` 子命令");
    expect(security).toContain('bash "$CLI_SOURCE/scripts/lifecycle-agent.sh" upgrade');
    expect(security).toContain('rollback --backup "<升级输出的备份路径>" --yes');
    expect(security).toContain('uninstall --yes');
    expect(security).toContain('lifecycle-agent.ps1" upgrade');
  });
});
