import { readFileSync } from "node:fs";
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
});
