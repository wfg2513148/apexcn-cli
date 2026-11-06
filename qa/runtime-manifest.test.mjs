import assert from "node:assert/strict";
import { linkSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runtimeManifest } from "./runtime-manifest.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "apexcn-runtime-manifest-"));
  for (const directory of ["dist/commands", "scripts", "node_modules/commander", "node_modules/lossless-json"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  for (const [name, content] of Object.entries({
    "package.json": "{}", "dist/index.js": "same entry", "dist/commands/content.js": "candidate code",
    "node_modules/commander/package.json": "{}", "node_modules/lossless-json/package.json": "{}",
    "scripts/lifecycle-agent.ps1": "candidate script", "scripts/lifecycle-agent.sh": "candidate script"
  })) writeFileSync(join(root, name), content);
  return root;
}

test("binds the complete runtime tree even when the entry file is unchanged", () => {
  const root = fixture();
  try {
    const before = runtimeManifest(root);
    assert.deepEqual(runtimeManifest(root), before);
    writeFileSync(join(root, "dist/commands/content.js"), "different candidate code");
    assert.notDeepEqual(runtimeManifest(root), before);
    writeFileSync(join(root, "dist/extra.js"), "unexpected");
    assert.ok(runtimeManifest(root).files.some((entry) => entry.path === "dist/extra.js"));
    const withExtra = runtimeManifest(root);
    writeFileSync(join(root, "scripts/lifecycle-agent.ps1"), "different lifecycle script");
    assert.notDeepEqual(runtimeManifest(root), withExtra);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejects symbolic links in the runtime tree", () => {
  const root = fixture();
  try {
    symlinkSync(join(root, "package.json"), join(root, "dist/link.js"));
    assert.throws(() => runtimeManifest(root), /unsupported runtime file type/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("rejects hard-linked runtime files", () => {
  const root = fixture();
  try {
    linkSync(join(root, "package.json"), join(root, "dist/hardlink.js"));
    assert.throws(() => runtimeManifest(root), /unsupported runtime file type/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
