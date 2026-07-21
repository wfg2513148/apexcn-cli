#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

checkWorkflowFiles();
checkScripts();
checkMarkdown();
checkTypeScript();

if (failures.length > 0) {
  console.error("Source layout check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Source layout check passed");

function checkWorkflowFiles() {
  for (const path of gitFiles(".github/workflows/*.yml")) {
    const text = readText(path);
    const lines = splitLines(text);
    if (lines.length < 20) {
      failures.push(`${path}: expected multiline workflow, got ${lines.length} lines`);
    }
    for (const required of ["name:", "on:", "jobs:"]) {
      if (!new RegExp(`^${escapeRegExp(required)}`, "m").test(text)) {
        failures.push(`${path}: missing top-level ${required}`);
      }
    }
  }
}

function checkScripts() {
  for (const path of gitFiles("scripts/*.mjs")) {
    const text = readText(path);
    const firstLine = (splitLines(text)[0] ?? "").replace(/\r$/, "");
    if (firstLine.startsWith("#!") && firstLine !== "#!/usr/bin/env node") {
      failures.push(`${path}: shebang must be exactly '#!/usr/bin/env node' on its own line`);
    }
  }
}

function checkMarkdown() {
  for (const path of gitFiles("README.md", "docs/*.md")) {
    const lines = splitLines(readText(path));
    if (lines.length <= 1) {
      failures.push(`${path}: Markdown file must not be a single line`);
    }
  }
}

function checkTypeScript() {
  const allowedLongLines = new Set([
    "src/core/command-registry.ts",
    "test/natural-language-scenarios.test.ts"
  ]);
  for (const path of gitFiles("src/**/*.ts", "test/**/*.ts")) {
    const lines = splitLines(readText(path));
    if (lines.length <= 1) {
      failures.push(`${path}: TypeScript file must not be a single line`);
      continue;
    }
    if (allowedLongLines.has(path)) {
      continue;
    }
    const longLine = lines.findIndex((line) => line.length > 500);
    if (longLine !== -1) {
      failures.push(`${path}:${longLine + 1}: line exceeds 500 characters`);
    }
  }
}

function gitFiles(...pathspecs) {
  const output = execFileSync("git", ["ls-files", ...pathspecs], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return output.split("\n")
    .filter((path) => path && existsSync(join(repoRoot, path)))
    .sort();
}

function readText(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function splitLines(text) {
  return text.trimEnd().split("\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
