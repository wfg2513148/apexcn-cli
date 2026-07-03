import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..");
const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as { version: string };

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("documentation consistency", () => {
  test("release URLs use the package version", () => {
    const tag = `v${packageJson.version}`;
    const markdownFiles = execFileSync("git", ["ls-files", "README.md", "docs"], {
      cwd: repoRoot,
      encoding: "utf8"
    }).split("\n").filter((path) => path.endsWith(".md"));

    for (const path of markdownFiles) {
      const text = read(path);
      for (const match of text.matchAll(/releases\/download\/(v\d+\.\d+\.\d+)\//g)) {
        expect(match[1], path).toBe(tag);
      }
    }
  });

  test("quickstart source mode matches the current repository layout", () => {
    const quickstart = read("docs/quickstart.md");

    expect(quickstart).toContain("node dist/index.js <command>");
    expect(quickstart).toContain("alias apexcn='node dist/index.js'");
    expect(quickstart).not.toContain("cd cli");
    expect(quickstart).not.toContain("node cli/dist/index.js");
    expect(quickstart).not.toContain("--prefix cli");
  });

  test("documented common commands are registered by the CLI", () => {
    const commands = execFileSync("node", ["dist/index.js", "--help"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    for (const command of ["auth", "doctor", "draft", "me", "category", "search", "topic", "reply", "favorite", "subscription", "ask"]) {
      expect(commands).toContain(command);
    }
  });
});
