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
  test("release URLs use the package version", () => {
    const version = JSON.parse(read("package.json")).version;
    const docs = ["README.md", "docs/quickstart.md", "scripts/install-agent.sh", "scripts/install-agent.ps1"].map(read).join("\n");

    expect(docs).toContain(`/v${version}/apexcn-cli.tgz`);
    expect(docs).not.toMatch(/\/v0\.17\.0\//);
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

    for (const asset of ["apexcn-cli.tgz", "install-agent.sh", "install-agent.ps1", "checksums.txt"]) {
      expect(security).toContain(asset);
      expect(workflow).toContain(`artifacts/${asset}`);
    }
  });
});
