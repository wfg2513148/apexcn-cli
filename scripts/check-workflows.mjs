#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

checkCiWorkflow();
checkReleaseWorkflow();

if (failures.length > 0) {
  console.error("Workflow check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Workflow check passed");

function checkCiWorkflow() {
  const path = ".github/workflows/ci.yml";
  const text = readText(path);
  checkMultiline(path, text, 20);
  checkTopLevel(path, text, ["name: CI", "on:", "jobs:"]);
  checkContains(path, text, [
    "npm ci",
    "npm run build",
    "npm test",
    "npm run check:release",
    "npm run eval:rag",
    "actions/upload-artifact@v4",
    "windows-latest",
    "test/install-agent.test.ts test/release-version.test.ts"
  ]);
  checkOrder(path, text, "npm test", "npm run check:release");
}

function checkReleaseWorkflow() {
  const path = ".github/workflows/release.yml";
  const text = readText(path);
  checkMultiline(path, text, 25);
  checkTopLevel(path, text, ["name: Release", "on:", "permissions:", "jobs:"]);
  checkContains(path, text, [
    "workflow_dispatch:",
    "inputs:",
    "tag:",
    "contents: write",
    "ref: ${{ inputs.tag }}",
    "npm ci",
    "npm run build",
    "npm test",
    "npm run check:release",
    "scripts/check-release-artifacts.mjs",
    "RELEASE_TAG: ${{ inputs.tag }}",
    "gh release create \"$RELEASE_TAG\"",
    "artifacts/checksums.txt",
    "artifacts/apexcn-cli.tgz.sha256",
    "artifacts/install-agent.sh.sha256",
    "artifacts/install-agent.ps1.sha256"
  ]);
  checkOrder(path, text, "npm run check:release", "gh release create \"$RELEASE_TAG\"");
  checkOrder(path, text, "scripts/check-release-artifacts.mjs", "gh release create \"$RELEASE_TAG\"");
}

function checkMultiline(path, text, minimumLines) {
  const lineCount = text.trimEnd().split("\n").length;
  if (lineCount < minimumLines) {
    failures.push(`${path}: expected at least ${minimumLines} lines, got ${lineCount}`);
  }
}

function checkTopLevel(path, text, requiredLines) {
  for (const line of requiredLines) {
    if (!new RegExp(`^${escapeRegExp(line)}$`, "m").test(text)) {
      failures.push(`${path}: missing top-level line ${line}`);
    }
  }
}

function checkContains(path, text, requiredSnippets) {
  for (const snippet of requiredSnippets) {
    if (!text.includes(snippet)) {
      failures.push(`${path}: missing ${snippet}`);
    }
  }
}

function checkOrder(path, text, before, after) {
  const beforeIndex = text.indexOf(before);
  const afterIndex = text.indexOf(after);
  if (beforeIndex === -1 || afterIndex === -1) {
    return;
  }
  if (beforeIndex > afterIndex) {
    failures.push(`${path}: ${before} must appear before ${after}`);
  }
}

function readText(path) {
  return readFileSync(join(repoRoot, path), "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
