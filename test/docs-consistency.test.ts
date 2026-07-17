import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { COMMAND_DESCRIPTORS } from "../src/core/command-registry.js";
import { allMcpTools } from "../src/mcp/tool-registry.js";

const repoRoot = join(__dirname, "..");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("documentation consistency", () => {
  test("Markdown and workflow files stay multiline and maintainable", () => {
    const minimumLines: Record<string, number> = {
      "README.md": 30,
      "docs/roadmap.md": 20,
      "docs/api-contract.md": 20,
      "docs/security-model.md": 20,
      "docs/workflow-policy.md": 20
    };

    for (const [path, minLines] of Object.entries(minimumLines)) {
      expect(read(path).trimEnd().split("\n").length, path).toBeGreaterThanOrEqual(minLines);
    }

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
    const docs = ["README.md", "docs/quickstart.md", "scripts/install-agent.sh", "scripts/install-agent.ps1"].map(read).join("\n");

    expect(docs).toContain("/releases/latest/download/apexcn-cli.tgz");
    expect(docs).toContain("/releases/latest/download/install-agent.sh");
    expect(docs).toContain("/releases/latest/download/install-agent.ps1");
    expect(docs).not.toMatch(/\/releases\/download\/v\d+\.\d+\.\d+\//);
    expect(docs).not.toMatch(/\/v0\.17\.0\//);
  });

  test("macOS and Linux one-line install docs fail when the download pipe fails", () => {
    for (const path of ["README.md", "docs/quickstart.md"]) {
      const doc = read(path);

      expect(doc).toContain("bash -o pipefail -c");
      expect(doc).toContain("curl -fsSL --retry 5 --retry-delay 2 --connect-timeout 20 --max-time 300");
      expect(doc).not.toContain("install-agent.sh | APEXCN_API_KEY");
    }
  });

  test("README-linked docs files exist", () => {
    const readme = read("README.md");
    const docs = [...readme.matchAll(/\((docs\/[^)]+\.md)\)/g)].map((match) => match[1]);

    for (const doc of docs) {
      expect(existsSync(join(repoRoot, doc))).toBe(true);
    }
  });

  test("MCP docs list every registered MCP tool", () => {
    const doc = read("docs/mcp.md");

    for (const tool of allMcpTools()) {
      expect(doc).toContain(tool.name);
    }
  });

  test("capability matrix references all command groups from registry", () => {
    const matrix = read("docs/capability-matrix.md");
    const groups = [...new Set(COMMAND_DESCRIPTORS.map((descriptor) => descriptor.path[0]))];
    const missing = groups.filter((group) => !matrix.includes(group));

    expect(missing).toEqual([]);
  });

  test("workflow policy docs list commands that exist in the command registry", () => {
    const doc = read("docs/workflow-policy.md");
    const paths = new Set(COMMAND_DESCRIPTORS.map((descriptor) => descriptor.path.join(" ")));

    for (const command of ["workflow policy init", "workflow verify", "workflow diff", "workflow audit-log"]) {
      expect(doc).toContain(command);
      expect(paths.has(command)).toBe(true);
    }
  });

  test("api contract docs list schema files that exist", () => {
    const doc = read("docs/api-contract.md");
    const schemaFiles = [
      "src/schemas/common.ts",
      "src/schemas/error.ts",
      "src/schemas/guide.ts",
      "src/schemas/command-manifest.ts",
      "src/schemas/search.ts",
      "src/schemas/topic.ts",
      "src/schemas/ask.ts",
      "src/schemas/research.ts",
      "src/schemas/doctor.ts",
      "src/schemas/workflow.ts",
      "src/schemas/collection.ts",
      "src/schemas/mcp.ts",
      "src/schemas/index.ts"
    ];

    for (const file of schemaFiles) {
      expect(doc).toContain(file);
      expect(existsSync(join(repoRoot, file))).toBe(true);
    }
  });

  test("security docs release assets match release workflow", () => {
    const security = read("docs/security-model.md");
    const workflow = read(".github/workflows/release.yml");

    for (const asset of ["apexcn-cli.tgz", "install-agent.sh", "install-agent.ps1", "checksums.txt", "apexcn-cli.tgz.sha256", "install-agent.sh.sha256", "install-agent.ps1.sha256"]) {
      expect(security).toContain(asset);
      expect(workflow).toContain(`artifacts/${asset}`);
    }
  });
});
